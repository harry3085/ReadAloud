// api/check-recording.js
// 녹음 정확도 평가 + 상세 피드백 (Gemini 오디오 멀티모달)
// Phase 5.5 신규 — 배치 처리용

const API_KEY = process.env.GEMINI_API_KEY;
// 폴백 체인 (2026-05-18 재배치): 2.5-flash-lite → 3.1-flash-lite → 2.5-flash
// 2.5-flash-lite 503 급증 대응 — 2순위를 더 저렴·빠른 3.1-flash-lite 로,
// 2.5-flash 는 3순위 강등 (audio 비용 큼). 같은 모델 최대 2회 재시도 후 다음.
const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
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
  // truncated JSON 복구 — maxOutputTokens 초과로 응답이 잘린 경우
  // 마지막 정상 닫힘 위치 찾아 그 지점까지만 살림
  return _salvageTruncated(cleaned);
}

function _salvageTruncated(text) {
  if (!text || text.indexOf('{') < 0) return null;
  const start = text.indexOf('{');
  let s = text.slice(start);
  // 트레일링 쉼표 + 미완성 따옴표 / 배열 정리
  // 1) 마지막 ":" 또는 "," 뒤가 미완성이면 그 직전까지 잘라냄
  for (let i = s.length - 1; i > 0; i--) {
    const ch = s[i];
    if (ch === '}' || ch === ']') {
      // 여기까지 살릴 시도
      let candidate = s.slice(0, i + 1);
      // 객체·배열 깊이 맞춤
      let bDepth = 0, kDepth = 0, inStr = false, esc = false;
      for (let j = 0; j < candidate.length; j++) {
        const c = candidate[j];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') bDepth++;
        else if (c === '}') bDepth--;
        else if (c === '[') kDepth++;
        else if (c === ']') kDepth--;
      }
      // 부족한 닫힘 채워서 시도
      let fixed = candidate.replace(/,\s*$/, '');
      while (kDepth > 0) { fixed += ']'; kDepth--; }
      while (bDepth > 0) { fixed += '}'; bDepth--; }
      try { return JSON.parse(fixed); } catch {}
    }
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

// 통합 프롬프트 — 1회 호출로 점수 + 피드백 둘 다 반환.
// 점수 미달이라도 피드백은 항상 포함 (학습 효과 우선, 비용 차이 미미).
// evaluationSeconds: 0/null = 전체 평가, 양수 = 앞 N초만 평가 (학원 설정)
// wordCount / expectedDuration / actualDuration: 본문 일부만 읽은 케이스 차단용 (2026-06-27)
function buildEvalPrompt(originalText, evaluationSeconds, meta = {}) {
  const evalScope = (evaluationSeconds && evaluationSeconds > 0)
    ? `Evaluate ONLY the first ${evaluationSeconds} seconds of the recording.`
    : `Evaluate the ENTIRE recording.`;
  // 본문 정보 블록 — 클라가 측정값 보내면 명시. AI 가 "본문 일부만 읽기" 케이스 식별.
  const { wordCount, expectedDuration, actualDuration } = meta;
  const hasMeta = (typeof wordCount === 'number' && wordCount > 0)
    && (typeof expectedDuration === 'number' && expectedDuration > 0)
    && (typeof actualDuration === 'number' && actualDuration >= 0);
  const metaBlock = hasMeta
    ? `

본문 정보 (참고 — AI 가 audio 들으면서 함께 비교):
- 본문 총 단어 수: ${wordCount} 단어
- 정상 읽기 예상 시간 (150 WPM 기준): 약 ${expectedDuration}초
- 학생 녹음 길이: ${actualDuration}초
- 녹음 비율: ${Math.round((actualDuration / expectedDuration) * 100)}% (정상 대비)

CRITICAL — 본문 부분 읽기 / 반복 읽기 차단:
- 녹음 길이가 본문 예상 시간의 30% 미만 (현재 ${Math.round((actualDuration / expectedDuration) * 100)}%) 면 score 30 이하 강제.
- 학생이 본문 일부 (몇 문장) 만 읽고 끝낸 케이스, 또는 같은 부분을 반복 읽은 케이스에 해당.
- 일부 발음이 정확하다 해도 본문 완독률이 낮으면 정상 점수 부여 불가.
- audio 듣고 학생이 본문 전체를 읽었는지 확인 — 일부만 읽었거나 같은 문장 반복하면 점수에 즉시 반영.
- 본문 단어 중 절반 이상을 들었으면 정상 평가, 그 미만이면 score 50 이하.`
    : '';
  return `You are a Korean English teacher evaluating a student's reading recording.

ORIGINAL TEXT:
"""
${originalText}
"""
${metaBlock}

${evalScope}
Compare the student's audio to the ORIGINAL TEXT above — measure how much was read clearly and in order.
Then ALWAYS provide detailed feedback (regardless of score) so the student can improve.

Return strictly JSON (no markdown):
{
  "score": <integer 0-100>,
  "transcribedWords": [<English words actually heard in the audio, in order, lowercase, up to 200 words>],
  "missedWords": [<up to 5 important words omitted>],
  "note": "<one-line Korean comment>",
  "feedback": {
    "missedWords": [<up to 3 omitted words, can overlap with above>],
    "weakPronunciation": [
      { "word": "<english word>", "issue": "<specific actionable Korean instruction>" }
    ],
    "tips": [<up to 2 actionable Korean tips, short>],
    "positives": [<up to 2 short Korean praise — what the student did well>],
    "intonation": "<one-line Korean comment on intonation (sentence rise/fall, question tone, emphasis)>",
    "stress": "<one-line Korean comment on word/sentence stress (which syllables/words to emphasize)>"
  },
  "categoryScores": {
    "pronunciation": <integer 0-100>,
    "intonation": <integer 0-100>,
    "pace": <integer 0-100>,
    "accuracy": <integer 0-100>
  },
  "categoryComments": {
    "pronunciation": "<one short Korean line — overall pronunciation quality>",
    "intonation": "<one short Korean line — intonation natural flow>",
    "pace": "<one short Korean line — reading speed>",
    "accuracy": "<one short Korean line — how many words read correctly>"
  }
}

Scoring guide (overall score & each category, 0-100):
- 90-100: Read almost every word clearly, in correct order, natural rhythm
- 75-89: Most words clear, minor omissions or unclear sections
- 60-74: Noticeable omissions, mispronunciation, or rushed portions
- 40-59: Many words missed or unclear; partial reading
- 0-39: Silent (침묵), noise only (단순 소음), irrelevant babbling (무의미한 웅얼거림), or entirely different content (원문과 완전히 다른 내용). 이 경우 즉시 0점 처리하고 세부 채점 및 억지 피드백 생성을 중단할 것.

CRITICAL — 0점 처리 시 세부 항목 통일:
score 가 0점 (또는 0-10 사이) 으로 처리되는 경우, categoryScores 의 모든 항목 (pronunciation, intonation, pace, accuracy) 값 또한 반드시 0 으로 설정하라.
- 본문과 무관한 내용·침묵·소음·무의미 발화일 때 발음/억양/속도/정확도를 따로 평가하지 말 것.
- feedback.weakPronunciation / tips / positives 등 세부 피드백도 빈 배열 또는 한 줄 "본문을 읽어주세요" 안내로 통일.
- 본문 단어를 추측해서 weakPronunciation 으로 생성하지 말 것 (학생이 그 단어를 실제 발음한 게 아니면 무의미).

CRITICAL — 학생별 점수 차이를 명확히 반영하라:
- 모든 학생에게 같은 점수 (예: 78점 디폴트, 75/70/85/80 디폴트 카테고리) 를 부여하지 말 것.
- 이 학생의 audio 가 가진 고유한 특성 (발음 정확도, 끊김, 속도, 단어 누락량) 을 분석해서 점수에 반영.
- 학생 A 와 B 의 audio 가 다르면 점수도 달라야 함. 미세한 차이도 +/- 3~5점 변동 허용.
- 0-100 전체 범위를 적극 활용. 잘하면 88, 92, 95 등으로 세분. 보통이면 72, 76, 80. 못하면 55, 62 등.
- 카테고리별 점수도 동일 — 발음 잘하면 90, 보통이면 75, 약하면 60 등 다양하게.
- "한국 학생 영어 = 78점" 같은 일반화 패턴 회피. 각 학생을 독립적으로 평가.

Category meanings:
- pronunciation: 자음·모음 정확도, 단어 발음
- intonation: 문장 끝 톤(올림/내림), 의문문 자연스러움
- pace: 자연스러운 읽기 속도 (너무 빠르거나 느리지 않음)
- accuracy: 단어 누락·순서·완독률

CRITICAL: 반드시 categoryScores 와 categoryComments 의 4 카테고리 (pronunciation, intonation, pace, accuracy) 를 모두 채워야 합니다. 하나라도 누락하면 학원장 화면에 빈 칸이 보입니다.
CRITICAL: Keep all comments SHORT (한 줄, 60자 이내). 짧고 명확하게.
Examples for category comments:
- pronunciation: "또렷하게 잘 읽었어요" / "단어 끝 자음을 흐리지 마세요"
- intonation: "문장 끝 톤이 평탄했어요. 마침표·물음표에 따라 변화 주세요"
- pace: "자연스러운 속도였어요" / "조금 빨라서 단어가 뭉쳐졌어요"
- accuracy: "단어 4개를 빠뜨렸어요" / "본문 거의 모두 읽었어요"
positives 예: "발음이 또렷해요" / "끊김 없이 한 호흡으로 읽었어요"

CRITICAL — weakPronunciation.issue rules:
- DO NOT describe what the student's pronunciation sounded like in Korean. 학생이 영어를 한글로 어떻게 들렸는지 묘사는 금지 — 영어 발음을 한글로 정확히 표기 불가능하므로 의미 없음.
  * 금지 패턴: "'마이티'처럼 들렸어요" / "'유진'처럼 발음했어요" / "'X'와 같이 들렸어요" / "'Y'로 들렸어요"
  * 어떤 형태든 issue 의 첫 문장이 "~처럼 들렸어요" / "~로 들렸어요" 식 청취 묘사면 안 됨
- ALWAYS start issue with a specific, actionable instruction the student can follow:
  * Stress placement (예: "두 번째 음절 -GENE 에 강세")
  * Specific consonant/vowel issue (예: "j 발음 [dʒ] 강하게, '쥐'와 '주' 사이")
  * Mouth/tongue position hint (예: "L 발음 시 혀를 윗니 뒤에")
  * Length/timing (예: "ee 모음 길게, '이-' 늘여서")
- IPA notation in brackets is encouraged when helpful (예: "[ˈjuːdʒiːn], 영어 강세는 첫 음절").
- BAD examples (do NOT do this):
  * "Eugene을 '유진'처럼 발음했어요. '유진'에 가깝게 연습하세요" — 음역만 있고 행동 지시 없음
  * "Mighty가 '마이티'처럼 들렸어요. 다시 연습해보세요" — 청취 묘사 + 모호한 지시
- GOOD example: "Mighty [ˈmaɪti] — 첫 음절 'MIGH' 길고 강하게, t 는 받침처럼 짧게. '마이-티' 가 아니라 '마이리' 에 가깝게."
- If you cannot produce a useful actionable instruction for a word, DO NOT include it in weakPronunciation. Empty array is better than vague feedback.

Feedback Korean: natural, encouraging, appropriate for middle/high school students.

CRITICAL — transcribedWords (완독률 측정용):
- audio 에서 실제로 들린 영어 단어를 순서대로 lowercase 배열로 반환.
- 침묵·소음·한국어·웅얼거림은 단어로 받아 적지 말 것 (영어 단어만).
- 본문 단어를 추측해서 채우지 말 것 — audio 에 실제 들린 단어만.
- 본문에 없는 단어가 들리면 그것도 포함 (정확한 기록).
- 들린 게 없으면 빈 배열 [].
- 최대 200 단어 (긴 본문은 처음~끝까지 들린 만큼).
- 서버가 이 배열로 본문 단어와 매칭해 완독률을 계산해 학원장 화면에 표시함.
- 정직하게 작성. 본문 추측 금지.`;
}

const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');

module.exports = async (req, res) => {
  require('./_lib/cors').setCors(req, res);
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
    let audioBase64 = body.audioBase64;
    const audioUrl = body.audioUrl;  // 신규: Storage download URL 패턴 (Vercel 4.5MB body 한도 회피)
    const idToken = body.idToken;

    // 인증 + 녹음 월 쿼터 (Phase 3)
    const q = await verifyAndCheckQuota({ idToken, quotaKind: 'recording' });
    if (q.error) { res.status(q.status).json({ success: false, error: q.error, limit: q.limit, currentCount: q.currentCount }); return; }
    // 쿼터 통과 시점에 카운트 — daily/monthly 단일 writer (서버) 통합
    await incrementUsage({ ...q, res, endpoint: 'check-recording' });

    // audioUrl 받으면 server-side fetch → base64 변환 (Vercel body 한도 무관)
    let fetchedMime = '';
    if (audioUrl && typeof audioUrl === 'string' && !audioBase64) {
      try {
        const r = await fetch(audioUrl);
        if (!r.ok) {
          console.error(`[check-rec][diag] fetch failed ${r.status} url=${audioUrl.slice(0,80)}`);
          res.status(400).json({ success: false, error: `audio fetch failed: ${r.status}` });
          return;
        }
        const ab = await r.arrayBuffer();
        if (ab.byteLength > 20 * 1024 * 1024) {
          res.status(413).json({ success: false, error: 'Audio too large (>20MB)' });
          return;
        }
        audioBase64 = Buffer.from(ab).toString('base64');
        fetchedMime = r.headers.get('content-type') || '';
        // 진단 — 학생별 audio 가 진짜 다른지 확인용 (Vercel 로그에서 비교)
        console.log(`[check-rec][diag] audio fetched: bytes=${ab.byteLength} mime="${fetchedMime}" b64.head=${audioBase64.slice(0,32)} b64.tail=${audioBase64.slice(-32)}`);
      } catch (e) {
        console.error('[check-recording] audioUrl fetch failed:', e);
        res.status(502).json({ success: false, error: 'audio fetch failed: ' + (e.message || 'unknown') });
        return;
      }
    }

    const rawMime = body.mimeType || fetchedMime || 'audio/webm';
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

    // 통합 프롬프트 — score + feedback 둘 다 1회 호출로 (mode 무관, 항상 동일)
    // evaluationSeconds: 0 또는 미지정 = 전체 평가, 양수 = 앞 N초만 평가 (학원 설정)
    const reqEvalSec = parseInt(body.evaluationSeconds);
    // 본문 단어수 + 예상·실제 길이 (2026-06-27, 본문 일부만 읽기 차단용)
    const meta = {
      wordCount: parseInt(body.wordCount) || 0,
      expectedDuration: parseInt(body.expectedDuration) || 0,
      actualDuration: parseInt(body.actualDuration) || 0,
    };
    const prompt = buildEvalPrompt(originalText, isFinite(reqEvalSec) && reqEvalSec > 0 ? reqEvalSec : 0, meta);

    // responseSchema — 통합 응답 구조 (Phase C: positives/intonation/stress + categoryScores/Comments)
    const responseSchema = {
      type: 'object',
      properties: {
        score: { type: 'integer' },
        transcribedWords: { type: 'array', items: { type: 'string' } },
        missedWords: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
        feedback: {
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
            positives: { type: 'array', items: { type: 'string' } },
            intonation: { type: 'string' },
            stress: { type: 'string' },
          },
          required: ['missedWords', 'weakPronunciation', 'tips'],
        },
        categoryScores: {
          type: 'object',
          properties: {
            pronunciation: { type: 'integer' },
            intonation: { type: 'integer' },
            pace: { type: 'integer' },
            accuracy: { type: 'integer' },
          },
          required: ['pronunciation', 'intonation', 'pace', 'accuracy'],
        },
        categoryComments: {
          type: 'object',
          properties: {
            pronunciation: { type: 'string' },
            intonation: { type: 'string' },
            pace: { type: 'string' },
            accuracy: { type: 'string' },
          },
          required: ['pronunciation', 'intonation', 'pace', 'accuracy'],
        },
      },
      required: ['score', 'transcribedWords', 'missedWords', 'note', 'feedback', 'categoryScores', 'categoryComments'],
    };

    // 진단 — Gemini 에 보내는 audio 메타 (Vercel 로그에서 학생별 비교)
    console.log(`[check-rec][diag] gemini.send: mimeType="${mimeType}" b64.len=${audioBase64?.length || 0} promptLen=${prompt.length}`);

    const reqBody = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.9,  // 0.7 → 0.9 — 점수보다 피드백 다양성 우선 (학생별 표현·지적이 다양해야 학습 가치)
        topP: 0.95,
        maxOutputTokens: 3000,
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
          // 진단 — Gemini 응답 raw 학생별 비교 (audio 영향 받았나)
          console.log(`[check-rec][diag] ${model} response.head=${textPart.slice(0, 220).replace(/\n/g, ' ')}`);
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
      // Rate limit / quota 에러면 친화적 메시지로 변환
      const lower = String(lastErrorMsg || '').toLowerCase();
      let friendly = lastErrorMsg || 'Gemini API error';
      if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('retry')) {
        friendly = 'AI 사용 한도에 도달했어요. 1~2분 뒤 다시 시도해 주세요.';
      }
      res.status(gres?.status || 502).json({
        success: false,
        error: friendly,
        detail: lastErrorMsg,
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

    // 통합 응답 — score + missedWords + note + feedback 한 번에
    const score = Math.max(0, Math.min(100, parseInt(parsed.score) || 0));
    const missedWords = Array.isArray(parsed.missedWords)
      ? parsed.missedWords.map(w => String(w || '').trim()).filter(Boolean).slice(0, 5) : [];
    const note = String(parsed.note || '').trim().slice(0, 200);

    // 완독률 측정 — transcribedWords vs 본문 단어 매칭 (2026-06-27 옵션 B)
    // AI 가 추정한 들린 단어를 본문과 매칭해 객관적 완독률 계산
    const transcribedWords = Array.isArray(parsed.transcribedWords)
      ? parsed.transcribedWords.map(w => String(w || '').trim().toLowerCase()).filter(Boolean).slice(0, 200)
      : [];
    let completionRate = null;
    let bookWordCount = 0;
    let heardWordCount = 0;
    try {
      // 본문에서 영단어만 추출 (소문자, 알파벳만)
      const bookWords = String(originalText || '').toLowerCase().match(/[a-z]+/g) || [];
      const bookUniqueSet = new Set(bookWords);
      const heardSet = new Set(transcribedWords);
      // 본문 unique 단어 중 들린 단어 비율 (중복 안 셈 — 한 번이라도 들렸으면 매칭)
      const matched = [...bookUniqueSet].filter(w => heardSet.has(w));
      bookWordCount = bookUniqueSet.size;
      heardWordCount = matched.length;
      completionRate = bookWordCount > 0 ? Math.round((heardWordCount / bookWordCount) * 100) : null;
    } catch (_) {}

    const fb = parsed.feedback || {};
    const fbMissed = Array.isArray(fb.missedWords)
      ? fb.missedWords.map(w => String(w || '').trim()).filter(Boolean).slice(0, 3) : [];
    const fbWeak = Array.isArray(fb.weakPronunciation)
      ? fb.weakPronunciation
          .map(item => ({ word: String(item?.word || '').trim(), issue: String(item?.issue || '').trim().slice(0, 150) }))
          .filter(w => w.word && w.issue).slice(0, 3) : [];
    const fbTips = Array.isArray(fb.tips)
      ? fb.tips.map(t => String(t || '').trim().slice(0, 200)).filter(Boolean).slice(0, 3) : [];
    // Phase C 신규: positives + intonation + stress
    const fbPositives = Array.isArray(fb.positives)
      ? fb.positives.map(t => String(t || '').trim().slice(0, 150)).filter(Boolean).slice(0, 2) : [];
    const fbIntonation = String(fb.intonation || '').trim().slice(0, 200);
    const fbStress = String(fb.stress || '').trim().slice(0, 200);

    // Phase C 신규: 카테고리별 점수·코멘트
    const _clampScore = (v) => {
      const n = parseInt(v);
      return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    };
    const cs = parsed.categoryScores || {};
    const cc = parsed.categoryComments || {};
    const categoryScores = {
      pronunciation: _clampScore(cs.pronunciation),
      intonation: _clampScore(cs.intonation),
      pace: _clampScore(cs.pace),
      accuracy: _clampScore(cs.accuracy),
    };
    const categoryComments = {
      pronunciation: String(cc.pronunciation || '').trim().slice(0, 120),
      intonation: String(cc.intonation || '').trim().slice(0, 120),
      pace: String(cc.pace || '').trim().slice(0, 120),
      accuracy: String(cc.accuracy || '').trim().slice(0, 120),
    };

    res.status(200).json({
      success: true,
      score,
      missedWords,
      note,
      feedback: {
        missedWords: fbMissed,
        weakPronunciation: fbWeak,
        tips: fbTips,
        positives: fbPositives,
        intonation: fbIntonation,
        stress: fbStress,
      },
      categoryScores,
      categoryComments,
      // 완독률 — 객관적 본문 단어 매칭 비율 (학원장 화면 표시용)
      completionRate,
      bookWordCount,
      heardWordCount,
      elapsedMs,
    });
  } catch (e) {
    console.error('/api/check-recording error:', e);
    res.status(500).json({ success: false, error: e.message || 'Internal error' });
  }
};
