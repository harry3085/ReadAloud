// api/check-recording.js
// 녹음 정확도 평가 + 상세 피드백 (Gemini 오디오 멀티모달)
// Phase 5.5 신규 — 배치 처리용

const API_KEY = process.env.GEMINI_API_KEY;
// 과부하 시 순차 폴백 (오디오 지원 확인된 모델만)
const MODELS = [
  'gemini-3.1-flash-lite-preview',  // 1순위 (1000회/일 무료, 네이티브 오디오)
  'gemini-2.5-flash',                // GA 폴백
  'gemini-2.0-flash',                // 최후 폴백
];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch {}
  }
  return null;
}

function isRetryable(status, data) {
  // 과부하 (재시도하면 다른 모델로 처리됨)
  if (status === 503 || status === 429) return true;
  // 모델 not found / deprecated → 다른 모델 시도
  if (status === 404) return true;
  const st = data?.error?.status;
  if (st === 'UNAVAILABLE' || st === 'RESOURCE_EXHAUSTED' || st === 'NOT_FOUND') return true;
  const msg = String(data?.error?.message || '').toLowerCase();
  if (msg.includes('overload') || msg.includes('unavailable') || msg.includes('high demand')) return true;
  if (msg.includes('not found') || msg.includes('not supported')) return true;
  return false;
}

function buildCheckPrompt(originalText, evaluationSeconds) {
  return `You are evaluating a student's English reading recording.

ORIGINAL TEXT:
"""
${originalText}
"""

Evaluate ONLY the first ${evaluationSeconds} seconds of the audio.

Return strictly JSON (no markdown):
{
  "score": <integer 0-100>,
  "missedWords": [<up to 5 important words omitted>],
  "note": "<one-line Korean comment>"
}

Scoring guide:
- 90-100: Read almost every word clearly, in correct order
- 75-89: Most words clear, minor omissions
- 60-74: Noticeable omissions or rushed portions
- 40-59: Many words missed or unclear
- 0-39: Silent, noise, or entirely different content`;
}

function buildFeedbackPrompt(originalText, evaluationSeconds) {
  return `You are a Korean English teacher.

ORIGINAL TEXT:
"""
${originalText}
"""

This is the student's 3rd and final attempt, which passed the threshold. Give specific improvements for the first ${evaluationSeconds} seconds.

Return strictly JSON (no markdown):
{
  "missedWords": [<up to 3 omitted words>],
  "weakPronunciation": [
    { "word": "<english word>", "issue": "<one-line Korean issue>" }
  ],
  "tips": [<up to 3 actionable Korean tips>]
}

Korean: natural, encouraging, appropriate for middle/high school students.`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }

  if (!API_KEY) {
    res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured' });
    return;
  }

  try {
    const body = req.body || {};
    const mode = body.mode === 'feedback' ? 'feedback' : 'check';
    const originalText = String(body.originalText || '').trim();
    const audioBase64 = body.audioBase64;
    const rawMime = body.mimeType || 'audio/webm';
    // Gemini 공식 지원: wav/mp3/aiff/aac/ogg/flac
    // 브라우저가 주로 내보내는 webm/mp4 는 거부되므로 호환 포맷으로 리라벨
    // (컨테이너 내부 opus/aac 코덱은 보통 파싱 가능)
    const mimeType = (() => {
      const lower = rawMime.toLowerCase();
      if (lower.includes('webm')) return 'audio/ogg';
      if (lower.includes('mp4') || lower.includes('m4a')) return 'audio/aac';
      // codec 파라미터 제거 (audio/ogg;codecs=opus → audio/ogg)
      return lower.split(';')[0].trim() || 'audio/ogg';
    })();
    const evaluationSeconds = Math.max(10, Math.min(parseInt(body.evaluationSeconds) || 60, 300));

    if (!originalText || originalText.length < 5) {
      res.status(400).json({ success: false, error: 'originalText required' });
      return;
    }
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ success: false, error: 'audioBase64 required' });
      return;
    }
    if (audioBase64.length > 25 * 1024 * 1024) {
      res.status(413).json({ success: false, error: 'Audio too large' });
      return;
    }

    const prompt = mode === 'feedback'
      ? buildFeedbackPrompt(originalText, evaluationSeconds)
      : buildCheckPrompt(originalText, evaluationSeconds);

    // responseSchema 로 구조화 출력 강제 → JSON 파싱 실패 원천 차단
    const responseSchema = mode === 'feedback'
      ? {
          type: 'object',
          properties: {
            missedWords: { type: 'array', items: { type: 'string' } },
            weakPronunciation: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  word: { type: 'string' },
                  issue: { type: 'string' },
                },
                required: ['word', 'issue'],
              },
            },
            tips: { type: 'array', items: { type: 'string' } },
          },
          required: ['missedWords', 'weakPronunciation', 'tips'],
        }
      : {
          type: 'object',
          properties: {
            score: { type: 'integer' },
            missedWords: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
          required: ['score', 'missedWords', 'note'],
        };

    const reqBody = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,  // 더 결정적
        topP: 0.9,
        maxOutputTokens: mode === 'feedback' ? 800 : 400,
        responseMimeType: 'application/json',
        responseSchema,
      },
    };

    // 한 모델당 JSON 파싱 포함 2회 시도
    async function callOnce(model) {
      const endpoint = `${BASE}/${model}:generateContent?key=${API_KEY}`;
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const d = await r.json();
      return { r, d };
    }

    const t0 = Date.now();
    let gres = null;
    let gdata = null;
    let parsed = null;
    let modelUsed = null;
    let lastErrorMsg = '';
    let lastRaw = '';

    outer:
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { r, d } = await callOnce(model);
          gres = r; gdata = d; modelUsed = model;
          if (!r.ok) {
            lastErrorMsg = d?.error?.message || `HTTP ${r.status}`;
            if (isRetryable(r.status, d)) {
              console.warn(`[check-recording] ${model} ${r.status} → 다음 모델`, lastErrorMsg);
              continue outer;  // 다음 모델로
            }
            break outer;  // 재시도 불가 에러 → 중단
          }
          const textPart = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          lastRaw = textPart;
          const j = extractJson(textPart);
          if (j) { parsed = j; break outer; }  // 성공
          // 파싱 실패 → 같은 모델로 1회 재시도
          console.warn(`[check-recording] ${model} parse fail attempt ${attempt+1}, raw:`, textPart.slice(0, 200));
        } catch (e) {
          lastErrorMsg = e.message || 'fetch failed';
          console.warn(`[check-recording] ${model} exception`, e.message);
        }
      }
      // 같은 모델 2회 모두 실패 → 다음 모델
      console.warn(`[check-recording] ${model} 전체 실패 → 다음 모델`);
    }
    const elapsedMs = Date.now() - t0;

    if (!gres || !gres.ok) {
      console.error('Gemini all models failed:', lastErrorMsg);
      res.status(gres?.status || 502).json({
        success: false,
        error: lastErrorMsg || 'Gemini API error',
        modelTried: MODELS.join(','),
      });
      return;
    }

    if (!parsed) {
      // 모든 모델·재시도에서 파싱 실패
      console.error('[check-recording] all parses failed, raw:', lastRaw.slice(0, 500));
      res.status(200).json({
        success: true,
        mode,
        score: 0,
        missedWords: [],
        note: `AI 가 오디오를 해석하지 못했어요 (${modelUsed}). 원본: ${lastRaw.slice(0, 180)}`,
        raw: lastRaw.slice(0, 300),
        elapsedMs,
      });
      return;
    }

    if (mode === 'check') {
      const score = Math.max(0, Math.min(100, parseInt(parsed.score) || 0));
      const missedWords = Array.isArray(parsed.missedWords)
        ? parsed.missedWords.map(w => String(w || '').trim()).filter(Boolean).slice(0, 5) : [];
      const note = String(parsed.note || '').trim().slice(0, 200);
      res.status(200).json({ success: true, mode: 'check', score, missedWords, note, elapsedMs });
    } else {
      const missedWords = Array.isArray(parsed.missedWords)
        ? parsed.missedWords.map(w => String(w || '').trim()).filter(Boolean).slice(0, 3) : [];
      const weakPronunciation = Array.isArray(parsed.weakPronunciation)
        ? parsed.weakPronunciation
            .map(item => ({ word: String(item?.word || '').trim(), issue: String(item?.issue || '').trim().slice(0, 150) }))
            .filter(w => w.word && w.issue).slice(0, 3) : [];
      const tips = Array.isArray(parsed.tips)
        ? parsed.tips.map(t => String(t || '').trim().slice(0, 200)).filter(Boolean).slice(0, 3) : [];
      res.status(200).json({ success: true, mode: 'feedback', missedWords, weakPronunciation, tips, elapsedMs });
    }
  } catch (e) {
    console.error('/api/check-recording error:', e);
    res.status(500).json({ success: false, error: e.message || 'Internal error' });
  }
};
