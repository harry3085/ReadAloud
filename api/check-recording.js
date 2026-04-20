// api/check-recording.js
// 녹음 정확도 평가 + 상세 피드백 (Gemini 2.5 Flash 오디오)
// Phase 5.5 신규 — 배치 처리용

const API_KEY = process.env.GEMINI_API_KEY;
// 과부하 시 순차 폴백 (generate-quiz.js 패턴)
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
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

function isOverloaded(status, data) {
  if (status === 503 || status === 429) return true;
  const st = data?.error?.status;
  if (st === 'UNAVAILABLE' || st === 'RESOURCE_EXHAUSTED') return true;
  const msg = String(data?.error?.message || '').toLowerCase();
  if (msg.includes('overload') || msg.includes('unavailable') || msg.includes('high demand')) return true;
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

    const reqBody = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: mode === 'feedback' ? 800 : 400,
        responseMimeType: 'application/json',
      },
    };

    const t0 = Date.now();
    let gres = null;
    let gdata = null;
    let modelUsed = null;
    let lastErrorMsg = '';

    for (const model of MODELS) {
      const endpoint = `${BASE}/${model}:generateContent?key=${API_KEY}`;
      try {
        gres = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        gdata = await gres.json();
        modelUsed = model;
        if (gres.ok) break;
        lastErrorMsg = gdata?.error?.message || `HTTP ${gres.status}`;
        if (isOverloaded(gres.status, gdata)) {
          console.warn(`[check-recording] ${model} overloaded → fallback`);
          continue;
        }
        // overload 가 아닌 에러면 더 진행해도 의미 없음
        break;
      } catch (e) {
        lastErrorMsg = e.message || 'fetch failed';
        console.warn(`[check-recording] ${model} exception → fallback`, e.message);
        continue;
      }
    }
    const elapsedMs = Date.now() - t0;

    if (!gres || !gres.ok) {
      console.error('Gemini all models failed:', lastErrorMsg, gdata);
      res.status(gres?.status || 502).json({
        success: false,
        error: lastErrorMsg || 'Gemini API error',
        modelTried: MODELS.join(','),
      });
      return;
    }

    const textPart = gdata.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(textPart);
    if (!parsed) {
      // Gemini 가 오디오 인식 실패 시 prose 로 응답하는 케이스
      console.error('[check-recording] JSON parse failed, raw:', textPart.slice(0, 500));
      res.status(200).json({
        success: true,
        mode,
        score: 0,
        missedWords: [],
        note: `AI 가 오디오를 해석하지 못했어요 (${modelUsed}). 원본: ${textPart.slice(0, 180)}`,
        raw: textPart.slice(0, 300),
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
