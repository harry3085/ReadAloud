// api/generate-quiz.js
// Google Gemini 3.1 Flash-Lite (Preview)로 객관식 4지선다 문제를 자동 생성
// POST body: { pages: [{id, title, text}], count?: number, type?: 'mcq' }
// Response: { success, questions: [...] }
//
// 환경변수: GEMINI_API_KEY (Google AI Studio에서 발급)

// 모델 폴백 체인: Preview가 불안정할 수 있으므로 실패 시 안정판으로 자동 전환
// 단일 모델 정책: gemini-3.1-flash-lite-preview 만 사용
// (2.5 계열은 일일 한도 적고 결과 편차로 일관성 저하)
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite-preview',
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 유형별 문제 수 상한 (초과 시 400 에러)
const MAX_COUNT_BY_TYPE = {
  vocab: 100,       // 단어는 항목당 짧아 많이 가능
  mcq: 50,
  subjective: 50,
  fill_blank: 50,
  recording: 50,
  unscramble: 50,
};
const MAX_PAGES = 20;

// ─── 문제 타입별 시스템 프롬프트 ───
const SYSTEM_PROMPTS = {
  mcq: `You are an English reading comprehension quiz generator for Korean middle/high school students.

Your task is to create 4-choice multiple-choice questions based on given English passages.

RULES:
1. Questions should test reading comprehension:
   - Main idea / purpose
   - Specific details (who, what, when, where, why, how)
   - Inference (what the author implies)
   - Vocabulary in context
   Avoid trivial yes/no questions.

2. Questions must be answerable ONLY from the given passage (no external knowledge needed).

3. For each question:
   - Write the question in English (natural, grammatically correct)
   - Provide a Korean translation of the question (for student comprehension aid)
   - Create exactly 4 answer choices in English
   - Exactly ONE choice must be correct
   - Wrong choices (distractors) should be plausible but clearly wrong to a careful reader
   - Wrong choices should be similar in length and style to the correct answer
   - Do NOT make wrong choices obviously absurd

4. Difficulty:
   - Include a mix of easy / medium / hard when possible, based on available content.
   - Exact distribution is NOT required — prioritize good questions from the passage over hitting a target ratio.

5. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "questions": [
    {
      "type": "mcq",
      "question": "What did the character decide to do at the end?",
      "questionKo": "주인공은 마지막에 무엇을 하기로 결정했나요?",
      "choices": [
        { "text": "Come back tomorrow with a flashlight", "isAnswer": true },
        { "text": "Call her parents immediately", "isAnswer": false },
        { "text": "Enter the barn right away", "isAnswer": false },
        { "text": "Tell her teacher the next day", "isAnswer": false }
      ],
      "explanation": "The passage says 'They decided to come back tomorrow with a flashlight.'",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "easy"
    }
  ]
}

Do NOT wrap in markdown code blocks. Do NOT add any text before or after the JSON.`,

  subjective: `You are an English-to-Korean translation exercise generator for Korean middle/high school students.

Your task is to pick meaningful sentences from given English passages and create "translate this sentence" questions for a printed test paper (no auto-grading — students write by hand).

RULES:
1. Pick ONE sentence per question. Avoid trivial sentences (e.g., "Hello."). Prefer sentences with substantive content.

2. Copy the original sentence from the passage VERBATIM. Every word, every form, every spelling must match the passage text exactly. Do NOT rephrase, shorten, combine, translate-back, or fabricate sentences. If a sentence does not appear in the passage as written, DO NOT use it.
   CRITICAL: If you cannot find enough suitable verbatim sentences to meet the requested count, RETURN FEWER questions. NEVER invent or modify a sentence to reach the count.

3. For each picked sentence, provide a natural Korean translation that a teacher would accept as a model answer (sampleAnswerKo). It should be fluent Korean, not literal word-by-word.

4. questionKo field: Use simple instruction like "위 문장을 우리말로 해석하시오." (can vary slightly).

5. Difficulty:
   - Include a mix of easy / medium / hard when possible, based on available content.
   - Exact distribution is NOT required — prioritize verbatim sentences over hitting a target ratio.

6. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "questions": [
    {
      "type": "subjective",
      "sentence": "The brave knight fought the dragon with great courage.",
      "questionKo": "위 문장을 우리말로 해석하시오.",
      "sampleAnswerKo": "용감한 기사는 대단한 용기로 용과 싸웠다.",
      "explanation": "fought = 싸우다(과거), courage = 용기",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "medium"
    }
  ]
}

Do NOT wrap in markdown code blocks. Do NOT add any text before or after the JSON.`,

  vocab: `You are an English vocabulary test generator for Korean middle/high school students.

Your task is to pick important vocabulary words from the given passages and provide Korean meanings.

RULES:
1. Pick meaningful CONTENT words (nouns, verbs, adjectives, adverbs).
   AVOID articles, prepositions, pronouns, common auxiliary verbs.

2. For each word, provide:
   - Korean meaning (natural, 1-3 words)
   - One example sentence from the passage (or adapted)
   - Korean translation of the example

3. Each word should appear ONCE (no duplicates in the set).

4. Prefer words that are:
   - Actually useful for middle/high school vocabulary building
   - Not too common (skip "go", "make", "have" etc. unless phrase verbs)
   - Not proper nouns (names of people/places)

5. Difficulty:
   - easy: common 1000-word list
   - medium: intermediate vocabulary
   - hard: advanced vocabulary, less common words

6. Output ONLY a valid JSON object (no markdown, no prose):
{
  "questions": [
    {
      "type": "vocab",
      "word": "benevolent",
      "meaning": "자비로운",
      "example": "She is a benevolent person.",
      "exampleKo": "그녀는 자비로운 사람이다.",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "medium"
    }
  ]
}`,

  unscramble: `You are an English sentence unscramble exercise generator for Korean middle/high school students.

Your task is to pick sentences from the given passages and split them into chunks based on the requested chunk count.

RULES:
1. Pick sentences EXACTLY as they appear in the passages. Copy each sentence VERBATIM — every word, every form, every spelling must match the passage text. Do NOT paraphrase, summarize, combine, translate-back, or fabricate. The joined (unchunked) sentence MUST be findable in the passage as a continuous substring.
   CRITICAL: If you cannot find enough suitable verbatim sentences to meet the requested count, RETURN FEWER questions. NEVER invent or modify a sentence to reach the count.

2. Split each sentence into the requested number of chunks using '/' as separator.
   Target chunk count is N — you may use N-1, N, or N+1 chunks per sentence when that respects natural linguistic boundaries better. Do not go outside [N-1, N+1].

3. Chunking strategy (based on sentence length and chunk count):
   - For SHORT sentences (5-8 words) with few chunks: single-word chunks are fine
   - For MEDIUM sentences (8-15 words): use phrases (noun phrases, verb phrases, prepositional phrases)
   - For LONG sentences (15+ words): use semantic meaning units (clauses, participial phrases, relative clauses)
   - ALWAYS respect natural linguistic boundaries

4. Provide Korean meaning (natural translation) for the whole sentence.

5. Difficulty:
   - easy: short sentences with simple structure
   - medium: medium length with common grammar
   - hard: longer sentences with complex structure

6. Output ONLY a valid JSON object (no markdown, no prose):
{
  "questions": [
    {
      "type": "unscramble",
      "chunkedSentence": "The /boy picked up/ the ball",
      "meaningKo": "그 소년이 공을 주웠다.",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "medium"
    }
  ]
}

IMPORTANT:
- Chunk count must be within [N-1, N+1] where N is the requested count
- Do NOT add '/' at the start or end
- Do NOT include extra spaces around '/'`,

  recording: `You are an English reading-aloud exercise generator for Korean middle/high school students.

Your task is to pick sentences from given English passages that students will READ ALOUD and RECORD for pronunciation practice.

RULES:
1. Pick ONE sentence per question, copied VERBATIM from the passage. Every word, every form, every spelling must match the passage text exactly. Do NOT paraphrase, modify, combine, translate-back, or fabricate. The sentence MUST be findable in the passage as a continuous substring.
   CRITICAL: If you cannot find enough suitable verbatim sentences to meet the requested count, RETURN FEWER questions. NEVER invent or modify a sentence to reach the count.

2. Prefer sentences that are:
   - 6 ~ 20 words long (not too short, not too long for single recording)
   - Complete grammatical sentences (start with capital, end with . ! ?)
   - Containing varied vocabulary useful for pronunciation practice
   - Avoiding quoted dialogue unless clean and short

3. Skip: incomplete fragments, headers, page numbers, overly complex technical sentences.

4. questionKo field: Use simple instruction like "다음 문장을 큰 소리로 읽고 녹음하세요." (can vary slightly).

5. Difficulty (by sentence length and vocabulary):
   - easy: simple common words, 6-10 words
   - medium: 10-15 words or some complex vocabulary
   - hard: 15+ words or advanced vocabulary

6. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "questions": [
    {
      "type": "recording",
      "sentence": "The young boy learned to read quickly every day.",
      "questionKo": "다음 문장을 큰 소리로 읽고 녹음하세요.",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "easy"
    }
  ]
}

Do NOT wrap in markdown code blocks. Do NOT add any text before or after the JSON.`,

  fill_blank: `You are an English fill-in-the-blank exercise generator for Korean middle/high school students.

Your task is to create fill-in-the-blank questions based on given English passages.

RULES:
1. Each question is ONE sentence copied VERBATIM from the passage, with some content words replaced by ___. Every non-blank word (and its form/spelling/punctuation) must match the passage text exactly. Do NOT paraphrase, simplify, combine, translate-back, or fabricate. When the blanks are filled back in with the answer words, the resulting sentence MUST be findable in the passage as a continuous substring.
   CRITICAL: If you cannot find enough suitable verbatim sentences to meet the requested count, RETURN FEWER questions. NEVER invent or modify a sentence to reach the count.

2. Mark 1-K words as blanks per sentence, where K is given by the user (blanksPerSentence option).
   Prefer meaningful CONTENT words: nouns, main verbs, adjectives, adverbs.
   AVOID masking: articles (a/an/the), prepositions, pronouns, common auxiliary verbs (is/are/was).

3. Replace each blank word with exactly "___" (three underscores) in the sentence field.
   Keep surrounding punctuation and capitalization intact.

4. List the blank answers in order as they appear in the sentence, inside the "blanks" array.
   Use the exact form from the passage (matching case/number/tense).

5. Difficulty:
   - Include a mix of easy / medium / hard when possible, based on available content.
   - Exact distribution is NOT required — prioritize verbatim sentences over hitting a target ratio.

6. sentenceKo field: Provide a natural Korean translation of the COMPLETE sentence (with the blank words filled in). This is used as a hint for struggling students. Keep it fluent, not literal.

7. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "questions": [
    {
      "type": "fill_blank",
      "sentence": "The young ___ quickly ___ the letter to his friend.",
      "blanks": ["boy", "sent"],
      "sentenceKo": "그 어린 소년은 친구에게 빠르게 편지를 보냈다.",
      "questionKo": "문장의 빈칸에 알맞은 단어를 쓰세요.",
      "explanation": "본문에서 a young boy가 친구에게 편지를 보내는 장면",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "easy"
    }
  ]
}

Do NOT wrap in markdown code blocks. Do NOT add any text before or after the JSON.`,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  // GET: 기본 프롬프트 조회 (관리자 UI에서 편집용)
  if (req.method === 'GET') {
    const t = req.query?.type;
    if (t) {
      if (SYSTEM_PROMPTS[t]) {
        return res.status(200).json({ success: true, type: t, prompt: SYSTEM_PROMPTS[t] });
      }
      return res.status(400).json({ error: `Unknown type: ${t}` });
    }
    return res.status(200).json({ success: true, prompts: SYSTEM_PROMPTS });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { pages, count, type, customSystemPrompt } = req.body || {};

    // ─── 입력 검증 ───
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'pages array is required' });
    }
    if (pages.length > MAX_PAGES) {
      return res.status(400).json({ error: `페이지는 최대 ${MAX_PAGES}개까지 선택 가능합니다 (요청: ${pages.length}개)` });
    }

    const quizType = type || 'mcq';
    if (!SYSTEM_PROMPTS[quizType]) {
      return res.status(400).json({
        error: `Type "${quizType}" not supported. Supported: ${Object.keys(SYSTEM_PROMPTS).join(', ')}`,
      });
    }

    const requestedCount = parseInt(count) || 5;
    if (requestedCount < 1) {
      return res.status(400).json({ error: '문제 수는 1개 이상이어야 합니다' });
    }
    const maxAllowed = MAX_COUNT_BY_TYPE[quizType] || 50;
    if (requestedCount > maxAllowed) {
      return res.status(400).json({
        error: `${quizType} 유형은 최대 ${maxAllowed}개까지 생성 가능합니다 (요청: ${requestedCount}개)`,
      });
    }
    const targetCount = requestedCount;

    // ─── 본문 전처리 ───
    const MAX_CHARS_PER_PAGE = 3000;
    const normalizedPages = pages.map(p => ({
      id: String(p.id || '').slice(0, 100),
      title: String(p.title || '').slice(0, 200),
      text: String(p.text || '').trim().slice(0, MAX_CHARS_PER_PAGE),
    })).filter(p => p.text.length > 20);

    if (normalizedPages.length === 0) {
      return res.status(400).json({ error: 'No valid page content (min 20 chars per page)' });
    }

    // ─── 프롬프트 구성 ───
    // 사용자 정의 프롬프트가 있으면 우선 사용 (최소 길이 20자)
    const systemPrompt = (typeof customSystemPrompt === 'string' && customSystemPrompt.trim().length >= 20)
      ? customSystemPrompt.trim()
      : SYSTEM_PROMPTS[quizType];
    const userPrompt = buildUserPrompt(normalizedPages, targetCount, quizType, req.body || {});

    // ─── Gemini API 호출 (폴백 체인) ───
    let lastError = null;
    let usedModel = null;
    let rawText = null;
    let usage = null;

    for (const model of GEMINI_MODELS) {
      try {
        const result = await callGemini(model, apiKey, systemPrompt, userPrompt);
        if (result.ok) {
          usedModel = model;
          rawText = result.text;
          usage = result.usage;
          break;
        }
        lastError = result.error;
        // 4xx는 모델 문제라기보단 입력/할당량 문제일 수 있음 — 폴백해도 소용없을 가능성
        if (result.status && result.status >= 400 && result.status < 500 && result.status !== 404) {
          // 404는 모델 이름 오류일 수 있으니 다음 모델로 폴백
          return res.status(502).json({
            error: 'AI service error',
            detail: lastError,
            model,
          });
        }
      } catch (e) {
        lastError = e.message;
        console.warn(`Model ${model} failed, trying next:`, e.message);
      }
    }

    if (!rawText) {
      return res.status(502).json({
        error: 'All AI models failed',
        detail: lastError,
        triedModels: GEMINI_MODELS,
      });
    }

    // ─── 응답 파싱 ───
    const parsed = parseAIResponse(rawText);
    if (!parsed) {
      return res.status(502).json({
        error: 'Failed to parse AI response',
        rawSnippet: rawText.slice(0, 500),
        model: usedModel,
      });
    }

    // ─── 결과 검증 & 정제 ───
    const validators = {
      mcq: validateMCQ,
      fill_blank: validateFillBlank,
      subjective: validateSubjective,
      recording: validateRecording,
      vocab: validateVocab,
      unscramble: validateUnscramble,
    };
    let validated = validators[quizType](parsed.questions || [], normalizedPages);

    // ─── 부족분 재시도 (1회 한정) ───
    // 1차 응답이 목표 개수에 못 미치면, 이미 채택된 문장을 제외 지시하고 부족분만 재요청.
    // 창작 방지 검증 탓에 폐기된 문제를 대체하는 용도.
    let retried = false;
    let retryUsage = null;
    if (validated.length > 0 && validated.length < targetCount && rawText) {
      retried = true;
      const missing = targetCount - validated.length;
      const avoidList = validated.map(q => _keyOf(q, quizType)).filter(Boolean);
      const retryUserPrompt = buildUserPrompt(
        normalizedPages, missing, quizType,
        { ...(req.body || {}), avoidList }
      );
      try {
        const retryResult = await callGemini(usedModel, apiKey, systemPrompt, retryUserPrompt);
        if (retryResult.ok) {
          retryUsage = retryResult.usage;
          const retryParsed = parseAIResponse(retryResult.text);
          if (retryParsed) {
            const retryValidated = validators[quizType](retryParsed.questions || [], normalizedPages);
            const existingKeys = new Set(
              validated.map(q => _keyOf(q, quizType).toLowerCase()).filter(Boolean)
            );
            const dedupedRetry = retryValidated.filter(q => {
              const k = _keyOf(q, quizType).toLowerCase();
              if (!k || existingKeys.has(k)) return false;
              existingKeys.add(k);
              return true;
            });
            validated = [...validated, ...dedupedRetry];
          }
        }
      } catch (e) {
        console.warn('retry call failed:', e.message);
      }
    }

    // 목표 초과는 잘라냄
    if (validated.length > targetCount) validated = validated.slice(0, targetCount);

    return res.status(200).json({
      success: true,
      type: quizType,
      model: usedModel,
      requestedCount: targetCount,
      returnedCount: validated.length,
      retried,
      questions: validated,
      usage,
      retryUsage,
    });
  } catch (err) {
    console.error('generate-quiz error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

async function callGemini(model, apiKey, systemPrompt, userPrompt) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 32768,
      responseMimeType: 'application/json', // JSON 모드
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
      error: 'AI 응답이 최대 토큰 한도에 도달해 잘렸습니다. 문제 수를 줄이거나 페이지를 줄여 다시 시도하세요.',
    };
  }

  return { ok: true, text, usage: data.usageMetadata || null };
}

function buildUserPrompt(pages, count, type, opts) {
  const passages = pages.map((p, i) =>
    `[Passage ${i + 1}]\nID: ${p.id}\nTitle: ${p.title}\n---\n${p.text}\n---`
  ).join('\n\n');

  const blanksPerSentence = Math.min(Math.max(parseInt(opts?.blanksPerSentence) || 1, 1), 5);

  const typeInstructions = {
    mcq: `Please generate ${count} 4-choice multiple-choice questions.
- Distribute questions across all passages (if multiple)
- Include sourcePageId matching the passage the question is based on
- Vary difficulty levels`,
    fill_blank: `Please generate ${count} fill-in-the-blank questions.
- Each question should mask approximately ${blanksPerSentence} word(s) per sentence (blanksPerSentence=${blanksPerSentence}).
- Distribute questions across all passages (if multiple)
- Include sourcePageId matching the passage the question is based on
- Vary difficulty levels`,
    subjective: `Please generate ${count} sentence-translation questions (English → Korean).
- Pick ONE meaningful sentence per question from the given passages.
- Distribute across all passages (if multiple).
- Include sourcePageId for the source passage.
- Vary difficulty levels.`,
    recording: `Please generate ${count} read-aloud (recording) sentence questions.
- Pick sentences directly from the given passages (do NOT modify them).
- Distribute across all passages (if multiple).
- Include sourcePageId for the source passage.
- Prefer 6-20 word sentences with varied pronunciation practice value.`,
    vocab: `Please generate ${count} vocabulary questions.
- Pick important content words from the passages.
- Each word appears only ONCE in the set.
- Distribute across all passages (if multiple).
- Include sourcePageId for each word.
- Difficulty preset: ${opts?.difficulty || '중1'}.`,
    unscramble: `Please generate ${count} unscramble questions.
- Split each sentence into ${Math.min(Math.max(parseInt(opts?.chunkCount)||4, 2), 10)} chunks (±1 allowed) using '/' separator, whichever respects natural linguistic boundaries better.
- Pick meaningful sentences (6-30 words each).
- Use semantic chunking based on chunk count: fewer chunks = larger semantic units.
- Include sourcePageId for each sentence.
- Difficulty preset: ${opts?.difficulty || '중1'}.`,
  };

  // 재시도 호출 시 이미 채택된 문장 목록을 넘겨 중복 선택 방지
  const avoidList = Array.isArray(opts?.avoidList) ? opts.avoidList.filter(Boolean) : [];
  const avoidBlock = avoidList.length > 0
    ? `\n\nALREADY-USED sentences (do NOT repeat these — pick DIFFERENT sentences from the passage):\n${avoidList.map(s => `- "${String(s).slice(0, 300)}"`).join('\n')}\n`
    : '';

  return `${typeInstructions[type]}${avoidBlock}

${passages}

Output ONLY the JSON object, nothing else.`;
}

// 재시도 시 중복 체크에 쓸 키 (유형별 대표 문자열)
function _keyOf(q, type) {
  if (!q) return '';
  switch (type) {
    case 'unscramble':
    case 'recording':
    case 'subjective':
      return String(q.sentence || '').trim();
    case 'fill_blank': {
      let filled = String(q.sentence || '');
      (q.blanks || []).forEach(b => { filled = filled.replace('___', b); });
      return filled.trim();
    }
    case 'mcq': return String(q.question || '').trim();
    case 'vocab': return String(q.word || '').trim();
    default: return '';
  }
}

function parseAIResponse(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();

  // 1) 마크다운 펜스 제거
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // 2) 그대로 파싱 (responseMimeType:application/json 이상적 케이스)
  try { return JSON.parse(cleaned); } catch {}

  // 3) 앞뒤 잡음 제거: 첫 { ~ 마지막 }
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace === -1) return null;
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); } catch {}

    // 4) 트레일링 쉼표 제거
    const noTrail = slice.replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(noTrail); } catch {}
  }

  // 5) 잘린 응답 복구 시도: "questions":[...] 배열에서 마지막으로 완성된 object 까지만 살림
  const salvaged = _trySalvageTruncatedQuestions(cleaned.slice(firstBrace));
  if (salvaged) return salvaged;

  return null;
}

// "questions":[ ... ] 형태에서 중간에 끊긴 경우, 마지막으로 완성된 중괄호 블록까지만 파싱
function _trySalvageTruncatedQuestions(src) {
  const m = src.match(/"questions"\s*:\s*\[/);
  if (!m) return null;
  const arrStart = m.index + m[0].length;
  let depth = 0, inStr = false, escape = false, lastCompleteEnd = -1;
  for (let i = arrStart; i < src.length; i++) {
    const c = src[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) lastCompleteEnd = i; }
    else if (c === ']' && depth === 0) break;
  }
  if (lastCompleteEnd === -1) return null;
  const rebuilt = src.slice(0, lastCompleteEnd + 1) + ']}';
  try { return JSON.parse(rebuilt); } catch { return null; }
}

// ─── 본문 원문 포함 검증 헬퍼 ───
// 대소문자·공백·구두점 차이는 무시하고 substring 매칭 (어순·어휘는 유지 필수)
// \p{L}=letter, \p{N}=number 외 모든 문자를 공백으로 치환 → 공백 정규화
function _normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 생성 문장이 어느 passage에 포함되는지 찾아 해당 page 반환. 없으면 null.
// 이 반환값으로 sourcePageId 를 실제 매칭 페이지로 교정한다.
function _findHostPage(sentence, pages) {
  const norm = _normalizeForMatch(sentence);
  if (!norm || norm.length < 8) return null;
  for (const p of pages) {
    const body = _normalizeForMatch(p.text);
    if (body.includes(norm)) return p;
  }
  return null;
}

function validateMCQ(questions, pages) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const question = String(q.question || '').trim();
      const questionKo = String(q.questionKo || '').trim();
      if (!question || question.length < 5) return null;

      if (!Array.isArray(q.choices) || q.choices.length !== 4) return null;

      const choices = q.choices
        .map(c => {
          if (!c || typeof c !== 'object') return null;
          const text = String(c.text || '').trim();
          if (!text || text.length > 300) return null;
          return { text, isAnswer: c.isAnswer === true };
        })
        .filter(Boolean);

      if (choices.length !== 4) return null;

      // 정답이 정확히 하나인지
      const answerCount = choices.filter(c => c.isAnswer).length;
      if (answerCount !== 1) return null;

      // 중복 보기 제거
      const uniqueTexts = new Set(choices.map(c => c.text.toLowerCase()));
      if (uniqueTexts.size !== 4) return null;

      const sourcePageId = validPageIds.has(q.sourcePageId)
        ? q.sourcePageId
        : (pages[0]?.id || '');
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      return {
        type: 'mcq',
        question,
        questionKo,
        choices,
        explanation: String(q.explanation || '').trim().slice(0, 500),
        sourcePageId,
        sourcePageTitle,
        difficulty,
      };
    })
    .filter(Boolean);
}

function validateFillBlank(questions, pages) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const sentence = String(q.sentence || '').trim();
      if (!sentence || sentence.length < 8) return null;

      const markerCount = (sentence.match(/___/g) || []).length;
      if (markerCount < 1 || markerCount > 5) return null;

      if (!Array.isArray(q.blanks) || q.blanks.length !== markerCount) return null;

      const blanks = q.blanks.map(b => String(b || '').trim());
      if (blanks.some(b => !b || b.length > 40)) return null;

      // 본문 원문 검증: ___ 를 blanks 로 채운 완성 문장이 어느 passage 에 있어야 함
      let filled = sentence;
      for (const b of blanks) filled = filled.replace('___', b);
      if (filled.includes('___')) return null;
      const hostPage = _findHostPage(filled, pages);
      if (!hostPage) return null;

      const questionKo = String(q.questionKo || '문장의 빈칸에 알맞은 단어를 쓰세요.').trim();

      // sourcePageId 는 실제 매칭된 페이지로 교정 (AI 가 엉뚱한 id 를 줘도 복구)
      const sourcePageId = hostPage.id;
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || hostPage.title || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      const sentenceKo = String(q.sentenceKo || '').trim().slice(0, 500);

      return {
        type: 'fill_blank',
        sentence,
        blanks,
        sentenceKo,
        questionKo,
        explanation: String(q.explanation || '').trim().slice(0, 500),
        sourcePageId,
        sourcePageTitle,
        difficulty,
      };
    })
    .filter(Boolean);
}

function validateSubjective(questions, pages) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const sentence = String(q.sentence || '').trim();
      if (!sentence || sentence.length < 8 || sentence.length > 500) return null;

      // 본문 원문 검증: 문장이 어느 passage 에도 없으면 폐기
      const hostPage = _findHostPage(sentence, pages);
      if (!hostPage) return null;

      const sampleAnswerKo = String(q.sampleAnswerKo || '').trim().slice(0, 500);
      const questionKo = String(q.questionKo || '위 문장을 우리말로 해석하시오.').trim();

      // sourcePageId 는 실제 매칭 페이지로 교정
      const sourcePageId = hostPage.id;
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || hostPage.title || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      return {
        type: 'subjective',
        sentence,
        questionKo,
        sampleAnswerKo,
        explanation: String(q.explanation || '').trim().slice(0, 500),
        sourcePageId,
        sourcePageTitle,
        difficulty,
      };
    })
    .filter(Boolean);
}

function validateRecording(questions, pages) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const sentence = String(q.sentence || '').trim();
      if (!sentence || sentence.length < 10 || sentence.length > 300) return null;

      const wordCount = sentence.split(/\s+/).length;
      if (wordCount < 4 || wordCount > 30) return null;

      // 본문 원문 검증
      const hostPage = _findHostPage(sentence, pages);
      if (!hostPage) return null;

      const questionKo = String(q.questionKo || '다음 문장을 큰 소리로 읽고 녹음하세요.').trim();

      const sourcePageId = hostPage.id;
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || hostPage.title || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      return {
        type: 'recording',
        sentence,
        questionKo,
        sourcePageId,
        sourcePageTitle,
        difficulty,
      };
    })
    .filter(Boolean);
}

function validateVocab(questions, pages) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));
  const seenWords = new Set();

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const word = String(q.word || '').trim();
      if (!word || word.length < 2 || word.length > 40) return null;

      const wordLower = word.toLowerCase();
      if (seenWords.has(wordLower)) return null;
      seenWords.add(wordLower);

      const meaning = String(q.meaning || '').trim();
      if (!meaning || meaning.length > 100) return null;

      const example = String(q.example || '').trim().slice(0, 300);
      const exampleKo = String(q.exampleKo || '').trim().slice(0, 300);

      const sourcePageId = validPageIds.has(q.sourcePageId)
        ? q.sourcePageId : (pages[0]?.id || '');
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty : 'medium';

      return {
        type: 'vocab',
        word, meaning, example, exampleKo,
        sourcePageId, sourcePageTitle, difficulty,
      };
    })
    .filter(Boolean);
}

function validateUnscramble(questions, pages) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const chunkedSentence = String(q.chunkedSentence || '').trim();
      if (!chunkedSentence || chunkedSentence.length < 8) return null;

      const chunks = chunkedSentence
        .split('/')
        .map(s => s.trim())
        .filter(Boolean);
      if (chunks.length < 2 || chunks.length > 10) return null;

      const sentence = chunks.join(' ').replace(/\s+/g, ' ').trim();

      const meaningKo = String(q.meaningKo || '').trim();
      if (!meaningKo) return null;

      // 본문 원문 검증: 청크를 합친 문장이 어느 passage 에도 없으면 폐기
      const hostPage = _findHostPage(sentence, pages);
      if (!hostPage) return null;

      const sourcePageId = hostPage.id;
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || hostPage.title || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty : 'medium';

      return {
        type: 'unscramble',
        chunkedSentence,
        sentence,
        meaningKo,
        chunkCount: chunks.length,
        sourcePageId, sourcePageTitle, difficulty,
      };
    })
    .filter(Boolean);
}
