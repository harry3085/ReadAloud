// ScoreSnap 채점 API — Gemini Vision 으로 학생 답안지 사진 채점
// 정책 (No-Storage MVP):
//   - testId + 이미지 base64 받아 채점 결과만 응답 (Firestore/Storage 저장 X)
//   - quota: generator 재사용 (베타 동안 AI 호출 통합 카운터)
//   - 폴백 체인: 2.5-flash → 2.5-flash-lite → 3.1-flash-lite-preview
//     (Vision 우선이라 generate-quiz 와 순서 다름 — flash 가 이미지 인식 강함)

const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');
const { buildGradingPrompt, postProcessGradingResult } = require('./_lib/scoresnap-prompt');
const { setCors } = require('./_lib/cors');

function _ensureAdminApp() {
  if (getApps().length > 0) return;
  try {
    if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
      const creds = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
      initializeApp({ credential: cert(creds) });
    } else {
      initializeApp({ credential: applicationDefault() });
    }
  } catch (e) {
    console.error('[scoresnap-grade] firebase-admin init 실패:', e.message);
    throw e;
  }
}

const GEMINI_MODELS = [
  'gemini-2.5-flash',           // Vision 우선 (이미지 인식 강함)
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function _callVision(model, apiKey, prompt, base64, mimeType) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.2,       // 채점은 보수적 — 환각 최소화
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[scoresnap-grade] ${model} HTTP ${res.status}:`, errText.slice(0, 300));
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '').join('');
  const finishReason = data.candidates?.[0]?.finishReason;
  if (!text) {
    return { ok: false, error: `Empty response (finishReason: ${finishReason || 'unknown'})` };
  }
  if (finishReason === 'MAX_TOKENS') {
    return { ok: false, error: 'AI 응답이 잘렸어요 (문항 수가 너무 많을 수 있음)' };
  }
  return { ok: true, text, usage: data.usageMetadata || null };
}

// JSON 파싱 + 마크다운 펜스 제거 폴백
function _parseJSON(text) {
  if (!text) return null;
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try { return JSON.parse(s); } catch (_) {}
  // 첫 { ~ 마지막 } 구간 추출 폴백
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });

  let idToken, testId, studentImageBase64, studentImageMimeType;
  try {
    ({ idToken, testId, studentImageBase64, studentImageMimeType } = req.body || {});
  } catch (_) { return res.status(400).json({ error: '요청 형식 오류' }); }

  if (!idToken) return res.status(401).json({ error: '인증 토큰 필요' });
  if (!testId) return res.status(400).json({ error: 'testId 필요' });
  if (!studentImageBase64 || typeof studentImageBase64 !== 'string') {
    return res.status(400).json({ error: '이미지 데이터 필요' });
  }
  // 4.5MB Vercel 한도 안전 — base64 는 원본의 ~133%
  if (studentImageBase64.length > 6 * 1024 * 1024) {
    return res.status(413).json({ error: '이미지가 너무 큼 (4MB 이하로)' });
  }

  _ensureAdminApp();
  const db = getFirestore();
  const auth = getAuth();

  // ── 1. 인증 + 할당량 (generator 재사용) ──
  const q = await verifyAndCheckQuota({ idToken, quotaKind: 'generator' });
  if (q.error) return res.status(q.status || 401).json({ error: q.error });
  if (!q.academyId) return res.status(403).json({ error: '학원 식별 실패' });

  // ── 2. 시험 정보 로드 + academyId 검증 ──
  let testDoc;
  try {
    testDoc = await db.doc('genTests/' + testId).get();
  } catch (e) {
    return res.status(500).json({ error: '시험 조회 실패: ' + e.message });
  }
  if (!testDoc.exists) return res.status(404).json({ error: '시험을 찾을 수 없어요' });
  const testData = testDoc.data();
  if (testData.academyId !== q.academyId) {
    return res.status(403).json({ error: '다른 학원의 시험이에요' });
  }
  const questions = Array.isArray(testData.questions) ? testData.questions : [];
  if (questions.length === 0) {
    return res.status(400).json({ error: '시험에 문제가 없어요' });
  }

  // ── 3. 프롬프트 생성 ──
  const prompt = buildGradingPrompt(questions);

  // ── 4. Gemini Vision 호출 (폴백 체인) ──
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTransient = (s) => s === 503 || s === 429;
  let usedModel = null, rawText = null, usage = null, lastError = null, lastStatus = null;

  outer:
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await _callVision(model, apiKey, prompt, studentImageBase64, studentImageMimeType);
        if (result.ok) {
          usedModel = model;
          rawText = result.text;
          usage = result.usage;
          break outer;
        }
        lastError = result.error;
        lastStatus = result.status || null;
        if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
          return res.status(502).json({ error: 'AI 서비스 오류', detail: lastError, model, status: lastStatus });
        }
        if (isTransient(lastStatus) && attempt === 0) {
          console.warn(`[scoresnap-grade] ${model} ${lastStatus} → 800ms 후 재시도`);
          await sleep(800);
          continue;
        }
        console.warn(`[scoresnap-grade] ${model} 실패(${lastStatus}) → 다음 모델`);
        continue outer;
      } catch (e) {
        lastError = e.message;
        console.warn(`[scoresnap-grade] ${model} exception:`, e.message);
        if (attempt === 0) { await sleep(800); continue; }
      }
    }
  }

  if (!rawText) {
    return res.status(502).json({ error: '모든 AI 모델 실패', detail: lastError, triedModels: GEMINI_MODELS });
  }

  // ── 5. JSON 파싱 + 후처리 ──
  const parsed = _parseJSON(rawText);
  if (!parsed) {
    return res.status(502).json({
      error: 'AI 응답 파싱 실패',
      rawSnippet: rawText.slice(0, 500),
      model: usedModel,
    });
  }
  const processed = postProcessGradingResult(parsed, questions.length);

  // ── 6. 사용량 카운트 (generator 합산, endpoint=scoresnap-grade 로 일자별 추적 가능) ──
  try {
    await incrementUsage({ ...q, res, endpoint: 'scoresnap-grade' });
  } catch (e) {
    console.warn('[scoresnap-grade] incrementUsage 실패 (응답은 진행):', e.message);
  }

  return res.status(200).json({
    success: true,
    model: usedModel,
    testTitle: testData.title || testData.name || '시험',
    ...processed,
    tokenUsage: usage,
  });
};
