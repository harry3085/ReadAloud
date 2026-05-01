// api/cleanup-ocr.js
// OCR 결과 텍스트를 Gemini 로 프롬프트 기반 정리
// POST body: { idToken, text, systemPrompt }
// Response: { success, cleaned, model, usage }
// 인증: idToken 검증 + 학원 AI 월 쿼터 (Phase 3)

const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');

// 폴백 체인 (2026-04-27 유료 티어 전환): 2.5-flash-lite → 2.5-flash → 3.1-flash-lite
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MAX_INPUT_CHARS = 10000; // 페이지당 본문 상한 (OCR 결과는 3000자 남짓이지만 여유)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { idToken, text, systemPrompt } = req.body || {};

    // 인증 + Cleanup 월 쿼터 (T2/T3 5분류 분리)
    const q = await verifyAndCheckQuota({ idToken, quotaKind: 'cleanup' });
    if (q.error) return res.status(q.status).json({ error: q.error, limit: q.limit, currentCount: q.currentCount });

    if (typeof text !== 'string' || text.trim().length < 5) {
      return res.status(400).json({ error: '정리할 본문이 너무 짧거나 비어 있습니다' });
    }
    if (typeof systemPrompt !== 'string' || systemPrompt.trim().length < 10) {
      return res.status(400).json({ error: '프리셋 프롬프트가 너무 짧거나 비어 있습니다' });
    }

    const inputText = text.slice(0, MAX_INPUT_CHARS);

    let lastError = null;
    let lastStatus = null;
    let usedModel = null;
    let cleaned = null;
    let usage = null;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const isTransient = (status) => status === 503 || status === 429;

    outer:
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await callGemini(model, apiKey, systemPrompt.trim(), inputText);
          if (result.ok) {
            usedModel = model;
            cleaned = result.text;
            usage = result.usage;
            break outer;
          }
          lastError = result.error;
          lastStatus = result.status || null;
          if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
            return res.status(502).json({ error: 'AI service error', detail: lastError, model, status: lastStatus });
          }
          if (isTransient(lastStatus) && attempt === 0) {
            console.warn(`[cleanup-ocr] ${model} ${lastStatus} → 800ms 후 재시도`);
            await sleep(800);
            continue;
          }
          console.warn(`[cleanup-ocr] ${model} 실패(${lastStatus}) → 다음 모델`);
          continue outer;
        } catch (e) {
          lastError = e.message;
          console.warn(`[cleanup-ocr] ${model} exception:`, e.message);
          if (attempt === 0) { await sleep(800); continue; }
        }
      }
    }

    if (cleaned === null) {
      return res.status(502).json({
        error: 'All AI models failed',
        detail: lastError,
        triedModels: GEMINI_MODELS,
      });
    }

    await incrementUsage(q);
    return res.status(200).json({
      success: true,
      model: usedModel,
      cleaned: cleaned.trim(),
      usage,
    });
  } catch (err) {
    console.error('cleanup-ocr error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

async function callGemini(model, apiKey, systemPrompt, inputText) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: inputText }] }],
    generationConfig: {
      temperature: 0.2, // 정리 작업은 결정적으로
      topP: 0.95,
      maxOutputTokens: 16384,
      responseMimeType: 'text/plain',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Gemini ${model} error:`, res.status, errText.slice(0, 300));
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('');

  const finishReason = data.candidates?.[0]?.finishReason;
  if (!text) {
    return {
      ok: false,
      error: `Empty response (finishReason: ${finishReason || 'unknown'})`,
    };
  }
  if (finishReason === 'MAX_TOKENS') {
    return {
      ok: false,
      error: 'AI 응답이 최대 토큰 한도에 도달해 잘렸습니다. 입력 본문을 줄여 다시 시도하세요.',
    };
  }

  return { ok: true, text, usage: data.usageMetadata || null };
}
