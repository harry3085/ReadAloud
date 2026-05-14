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

const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function buildWordCheckPrompt(targetWord) {
  return `You are evaluating ONE English word pronunciation by a Korean student.

TARGET WORD: "${targetWord}"

Listen to the audio and answer:
1. Did the student say "${targetWord}" or close to it? (Korean accent acceptable)
2. What did you actually hear?

Return STRICT JSON only (no markdown, no explanation):
{
  "match": true | false,
  "heard": "<the word you actually heard, lowercase English only>",
  "confidence": <0-100>,
  "reason": "<one-line Korean pronunciation tip, max 25 chars>"
}

ACCEPT (match: true):
- Clearly pronounced target word
- Korean accent of target word (e.g., "워러" for "water" → match: true)
- Minor mispronunciation if target is identifiable

REJECT (match: false):
- Completely different word
- Silent or only noise
- Wrong word that just sounds similar in letters (e.g., "right" vs "light")

HEARD field:
- ALWAYS return what you actually heard, even if match: true
- If silent/noise: return ""
- Use lowercase English (no Korean text)

REASON field — Korean pronunciation tip:
- If match: true and confidence > 90: ""
- If match: true and confidence 60-90: short tip ("i 발음을 좀 더 길게")
- If match: false: what's wrong ("R 발음을 굴려보세요", "발음이 다른 단어예요")
- Max 25 Korean characters

CONFIDENCE GUIDE:
- 90-100: Native-level or clear Korean accent
- 70-89: Identifiable with minor issues
- 50-69: Recognizable but needs practice
- 30-49: Significant issues
- 0-29: Wrong / silent / noise`;
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

  // ── 인증 + 할당량 (recording 재사용) ──
  const q = await verifyAndCheckQuota({ idToken, quotaKind: 'recording' });
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
      maxOutputTokens: 200,
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

  // ── 사용량 카운트 (성공 시만, recording 카운터 + apiUsage 'check-word') ──
  try {
    await incrementUsage({ ...q, res, endpoint: 'check-word' });
  } catch (e) {
    console.warn('[check-word] incrementUsage 실패:', e.message);
  }

  return res.status(200).json({
    match: parsed.match,
    heard: cleanHeard,
    confidence: conf,
    reason: cleanReason,
    modelUsed,
    elapsed,
  });
};
