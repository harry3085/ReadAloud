// ScoreSnap 채점 API — Gemini Vision (정답지 OCR + 학생 채점 통합)
// 모드 2개:
//   mode: 'answerKey'  → 정답지 1장에서 questions·정답 OCR 추출 (시험당 1회)
//   mode: 'student'    → 학생 답안지 + answerKey questions → 채점 (학생당 1회)
//
// 정책 (No-Storage MVP):
//   - 결과를 Firestore/Storage 에 저장 X. 응답으로만 반환
//   - quota: 'generator' 재사용 (베타 동안 AI 호출 통합 카운터)
//   - 폴백 체인: 2.5-flash → 2.5-flash-lite → 3.1-flash-lite

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');
const {
  buildAnswerKeyPrompt, postProcessAnswerKey,
  buildStudentGradePrompt, postProcessStudentGrade,
} = require('./_lib/scoresnap-prompt');
const { setCors } = require('./_lib/cors');

function _ensureAdminApp() {
  if (getApps().length > 0) return;
  let pk = process.env.FIREBASE_PRIVATE_KEY || '';
  pk = pk.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    }),
  });
}

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function _callVision(model, apiKey, prompt, base64, mimeType, precision = false) {
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
      temperature: precision ? 0.1 : 0.2,         // 정밀: 더 보수적
      topP: 0.95,
      maxOutputTokens: precision ? 16384 : 8192,  // 정밀: 긴 응답 잘림 방지
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
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const finishReason = data.candidates?.[0]?.finishReason;
  if (!text) return { ok: false, error: `Empty response (finishReason: ${finishReason || 'unknown'})` };
  if (finishReason === 'MAX_TOKENS') return { ok: false, error: 'AI 응답이 잘렸어요' };
  return { ok: true, text, usage: data.usageMetadata || null };
}

function _parseJSON(text) {
  if (!text) return null;
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

// 폴백 체인 실행 — 호출자에 raw text 반환
async function _callWithFallback(apiKey, prompt, base64, mimeType, precision = false) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTransient = (s) => s === 503 || s === 429;
  let usedModel = null, rawText = null, usage = null, lastError = null, lastStatus = null;

  outer:
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await _callVision(model, apiKey, prompt, base64, mimeType, precision);
        if (result.ok) {
          usedModel = model;
          rawText = result.text;
          usage = result.usage;
          break outer;
        }
        lastError = result.error;
        lastStatus = result.status || null;
        if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
          return { ok: false, status: 502, error: lastError, model, lastStatus };
        }
        if (isTransient(lastStatus) && attempt === 0) {
          await sleep(800);
          continue;
        }
        continue outer;
      } catch (e) {
        lastError = e.message;
        if (attempt === 0) { await sleep(800); continue; }
      }
    }
  }
  if (!rawText) return { ok: false, status: 502, error: lastError || 'All models failed' };
  return { ok: true, usedModel, rawText, usage };
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });

  let body;
  try { body = req.body || {}; } catch (_) { return res.status(400).json({ error: '요청 형식 오류' }); }
  const { idToken, mode, imageBase64, imageMimeType, answerKeyQuestions, precision } = body;

  if (!idToken) return res.status(401).json({ error: '인증 토큰 필요' });
  if (mode !== 'answerKey' && mode !== 'student') {
    return res.status(400).json({ error: "mode 는 'answerKey' 또는 'student'" });
  }
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: '이미지 데이터 필요' });
  }
  if (imageBase64.length > 6 * 1024 * 1024) {
    return res.status(413).json({ error: '이미지가 너무 큼 (4MB 이하로)' });
  }

  _ensureAdminApp();

  // ── 인증 + 할당량 (generator 재사용) ──
  const q = await verifyAndCheckQuota({ idToken, quotaKind: 'generator' });
  if (q.error) return res.status(q.status || 401).json({ error: q.error });

  // ── 모드별 프롬프트 + 호출 ──
  let prompt;
  if (mode === 'answerKey') {
    prompt = buildAnswerKeyPrompt();
  } else {
    if (!Array.isArray(answerKeyQuestions) || answerKeyQuestions.length === 0) {
      return res.status(400).json({ error: '정답지 questions 필요 (mode=student)' });
    }
    prompt = buildStudentGradePrompt(answerKeyQuestions);
  }

  const r = await _callWithFallback(apiKey, prompt, imageBase64, imageMimeType || 'image/jpeg', precision === true);
  if (!r.ok) {
    return res.status(r.status || 502).json({ error: 'AI 호출 실패', detail: r.error });
  }

  const parsed = _parseJSON(r.rawText);
  if (!parsed) {
    return res.status(502).json({
      error: 'AI 응답 파싱 실패',
      rawSnippet: r.rawText.slice(0, 500),
      model: r.usedModel,
    });
  }

  // ── 후처리 + 사용량 ──
  try {
    await incrementUsage({ ...q, res, endpoint: 'scoresnap-grade' });
  } catch (e) {
    console.warn('[scoresnap-grade] incrementUsage 실패:', e.message);
  }

  if (mode === 'answerKey') {
    const processed = postProcessAnswerKey(parsed);
    return res.status(200).json({
      success: true,
      mode,
      model: r.usedModel,
      ...processed,
      tokenUsage: r.usage,
    });
  } else {
    const processed = postProcessStudentGrade(parsed, answerKeyQuestions.length);
    return res.status(200).json({
      success: true,
      mode,
      model: r.usedModel,
      ...processed,
      tokenUsage: r.usage,
    });
  }
};
