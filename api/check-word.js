// 단어 말하기 AI 정밀 채점 — Gemini 2.5 Flash-Lite 오디오 멀티모달
// Web Speech 2회 실패 후 폴백 전용 (모든 호출 X). 사전 검증 (무음·짧음) 클라에서 처리.
// quota: 'recording' 카테고리 재사용 (5분류 + apiUsage daily 'check-word')

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');
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

// 폴백 체인 (2026-05-18 재배치): 2.5-flash-lite → 3.1-flash-lite
// 단어 말하기는 5초→9초 타임아웃·재시도(B-1)라 속도 민감 — 2순위를
// 2.5-flash 대신 더 빠르고 저렴한 3.1-flash-lite 로 (503 시 폴백 비용↓·지연↓).
const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function buildWordCheckPrompt(targetWord) {
  // 2026-05-15 축소판 — 응답 속도 우선 (입력 토큰 ↓ + 출력 ≤80 tokens 강제)
  return `Korean student pronouncing English word.

TARGET: "${targetWord}"

Return JSON only:
{"match":true|false,"heard":"<heard word, lowercase eng>","confidence":0-100,"reason":"<Korean action tip, max 20 chars>"}

match=true: target spoken (Korean accent OK). match=false: different word / silent / noise.
heard: actual word heard (empty if silent).
reason: pronunciation ACTION tip preferred (e.g. "R 발음 강하게", "TH 혀끝 이 사이"). If you must mention how the word sounded, use TENTATIVE expression "XX 처럼 들릴 수 있어요" (가능성·완곡), NEVER assertive "XX 처럼 들렸어요". Empty if no useful tip.
confidence: 90+ clear / 70-89 minor / 50-69 fair / <50 poor.`;
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

function isRetryable(status, data) {
  if (status === 503 || status === 429 || status === 404) return true;
  const st = data?.error?.status;
  if (st === 'UNAVAILABLE' || st === 'RESOURCE_EXHAUSTED' || st === 'NOT_FOUND') return true;
  const msg = String(data?.error?.message || '').toLowerCase();
  if (msg.includes('overload') || msg.includes('unavailable') || msg.includes('not found')) return true;
  return false;
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });

  let body;
  try { body = req.body || {}; } catch (_) { return res.status(400).json({ error: '요청 형식 오류' }); }
  const { idToken, targetWord, audioBase64, mimeType } = body;

  // ── 입력 검증 (인증 전 — 잘못된 입력은 카운터 차감 X) ──
  if (!idToken) return res.status(401).json({ error: '인증 토큰 필요', fallback: true });
  const word = String(targetWord || '').trim();
  if (!word || word.length > 50) {
    return res.status(400).json({ error: 'targetWord 1~50자', fallback: true });
  }
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'audioBase64 필요', fallback: true });
  }
  // 단어 한 개라 5초 안팎 — 200KB 이상은 거부 (악용 방지)
  if (audioBase64.length > 200 * 1024) {
    return res.status(413).json({ error: '오디오가 너무 큼 (~5초)', fallback: true });
  }

  _ensureAdminApp();

  // ── 인증 + 할당량 (2026-05-15 'word-speaking' 별도 카운터 분리) ──
  const q = await verifyAndCheckQuota({ idToken, quotaKind: 'word-speaking' });
  if (q.error) return res.status(q.status || 401).json({ error: q.error, fallback: true });

  // ── MIME 보정 (Gemini 호환 형식으로 라벨링) ──
  const mt = String(mimeType || '').toLowerCase();
  const cleanMime = mt.includes('webm') ? 'audio/ogg'
                  : (mt.includes('mp4') || mt.includes('m4a')) ? 'audio/aac'
                  : (mt.split(';')[0].trim() || 'audio/ogg');

  // ── responseSchema (구조 강제) ──
  const responseSchema = {
    type: 'object',
    properties: {
      match: { type: 'boolean' },
      heard: { type: 'string' },
      confidence: { type: 'integer' },
      reason: { type: 'string' },
    },
    required: ['match', 'heard', 'confidence'],
  };

  const reqBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: buildWordCheckPrompt(word) },
        { inlineData: { mimeType: cleanMime, data: audioBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.0,
      topP: 0.8,
      maxOutputTokens: 80,  // 2026-05-15 200 → 80 (응답 시간 단축, 50~80 tokens 면 충분)
      responseMimeType: 'application/json',
      responseSchema,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  // ── 모델 폴백 체인 ──
  const t0 = Date.now();
  let gres = null, gdata = null, modelUsed = null;

  for (const model of MODELS) {
    const endpoint = `${BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { gres = r; gdata = d; modelUsed = model; break; }
      if (!isRetryable(r.status, d)) { gres = r; gdata = d; modelUsed = model; break; }
      console.warn(`[check-word] ${model} retryable fail:`, r.status, d?.error?.message);
    } catch (e) {
      console.warn(`[check-word] ${model} threw:`, e.message);
    }
  }

  const elapsed = Date.now() - t0;

  if (!gres || !gres.ok) {
    console.error('[check-word] all models failed', gdata);
    return res.status(502).json({ error: 'AI 일시 불가', fallback: true, elapsed });
  }

  // ── JSON 파싱 ──
  const textOut = gdata?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJson(textOut);
  if (!parsed || typeof parsed.match !== 'boolean') {
    console.error('[check-word] parse failed', textOut?.slice(0, 200));
    return res.status(502).json({ error: 'AI 응답 파싱 실패', fallback: true, elapsed });
  }

  // ── heard 정제 (영어 알파벳·공백·하이픈·작은따옴표만) ──
  let cleanHeard = String(parsed.heard || '').toLowerCase().trim();
  cleanHeard = cleanHeard.replace(/[^a-z\s\-']/g, '').trim();
  if (cleanHeard.length > 30) cleanHeard = cleanHeard.slice(0, 30);
  const cleanReason = String(parsed.reason || '').slice(0, 40);
  const conf = Math.max(0, Math.min(100, parsed.confidence || 0));

  // ── 응답 먼저 보내고 사용량 카운트는 백그라운드 (응답 시간 단축, 2026-05-15) ──
  res.status(200).json({
    match: parsed.match,
    heard: cleanHeard,
    confidence: conf,
    reason: cleanReason,
    modelUsed,
    elapsed,
  });

  // Fire and forget — Vercel function 이 종료될 때까지 백그라운드 처리
  // 단 X-Quota-* 헤더는 응답 이후라 셋팅 X (학원장 위젯이 자체 fetch 로 한도 표시)
  incrementUsage({ ...q, endpoint: 'check-word' })
    .catch(e => console.warn('[check-word] incrementUsage 실패:', e.message));
};
