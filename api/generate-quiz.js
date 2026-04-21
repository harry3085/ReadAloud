// api/generate-quiz.js
// Google Gemini 3.1 Flash-Lite (Preview)로 객관식 4지선다 문제를 자동 생성
// POST body: { pages: [{id, title, text}], count?: number, type?: 'mcq' }
// Response: { success, questions: [...] }
//
// 환경변수: GEMINI_API_KEY (Google AI Studio에서 발급)

// 모델 폴백 체인: Preview가 불안정할 수 있으므로 실패 시 안정판으로 자동 전환
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite-preview',  // 1순위 (빠르고 저렴, Preview)
  'gemini-2.5-flash',                // 2순위 (안정판 폴백)
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
const MAX_PAGES = 10;

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

4. Difficulty distribution (if generating multiple):
   - About 30% easy (direct factual)
   - About 50% medium (requires careful reading)
   - About 20% hard (requires inference or integration)

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

2. Keep the original sentence from the passage UNMODIFIED. Do not rephrase, shorten, or combine sentences.

3. For each picked sentence, provide a natural Korean translation that a teacher would accept as a model answer (sampleAnswerKo). It should be fluent Korean, not literal word-by-word.

4. questionKo field: Use simple instruction like "위 문장을 우리말로 해석하시오." (can vary slightly).

5. Difficulty (based on sentence complexity, vocabulary, structure):
   - About 30% easy
   - About 50% medium
   - About 20% hard

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
1. Pick sentences directly from the passages (unmodified).

2. Split each sentence into EXACTLY the requested number of chunks using '/' as separator.

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
- The number of '/' separators should equal requested chunk count minus 1
- Do NOT add '/' at the start or end
- Do NOT include extra spaces around '/'`,

  recording: `You are an English reading-aloud exercise generator for Korean middle/high school students.

Your task is to pick sentences from given English passages that students will READ ALOUD and RECORD for pronunciation practice.

RULES:
1. Pick ONE sentence per question, directly from the passage (unmodified).

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
1. Each question is ONE sentence from the passage (or slightly modified for clarity).

2. Mark 1-K words as blanks per sentence, where K is given by the user (blanksPerSentence option).
   Prefer meaningful CONTENT words: nouns, main verbs, adjectives, adverbs.
   AVOID masking: articles (a/an/the), prepositions, pronouns, common auxiliary verbs (is/are/was).

3. Replace each blank word with exactly "___" (three underscores) in the sentence field.
   Keep surrounding punctuation and capitalization intact.

4. List the blank answers in order as they appear in the sentence, inside the "blanks" array.
   Use the exact form from the passage (matching case/number/tense).

5. Difficulty distribution (if generating multiple):
   - About 30% easy (short, common words)
   - About 50% medium (content words requiring comprehension)
   - About 20% hard (less common words, inference required)

6. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "questions": [
    {
      "type": "fill_blank",
      "sentence": "The young ___ quickly ___ the letter to his friend.",
      "blanks": ["boy", "sent"],
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
    const validated = validators[quizType](parsed.questions || [], normalizedPages);

    return res.status(200).json({
      success: true,
      type: quizType,
      model: usedModel,
      requestedCount: targetCount,
      returnedCount: validated.length,
      questions: validated,
      usage,
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
- Split each sentence into EXACTLY ${Math.min(Math.max(parseInt(opts?.chunkCount)||4, 2), 10)} chunks using '/' separator.
- Pick meaningful sentences (6-30 words each).
- Use semantic chunking based on chunk count: fewer chunks = larger semantic units.
- Include sourcePageId for each sentence.
- Difficulty preset: ${opts?.difficulty || '중1'}.`,
  };

  return `${typeInstructions[type]}

${passages}

Output ONLY the JSON object, nothing else.`;
}

function parseAIResponse(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
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

      const questionKo = String(q.questionKo || '문장의 빈칸에 알맞은 단어를 쓰세요.').trim();

      const sourcePageId = validPageIds.has(q.sourcePageId)
        ? q.sourcePageId
        : (pages[0]?.id || '');
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || '';

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      return {
        type: 'fill_blank',
        sentence,
        blanks,
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

      const sampleAnswerKo = String(q.sampleAnswerKo || '').trim().slice(0, 500);
      const questionKo = String(q.questionKo || '위 문장을 우리말로 해석하시오.').trim();

      const sourcePageId = validPageIds.has(q.sourcePageId)
        ? q.sourcePageId
        : (pages[0]?.id || '');
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || '';

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

      const questionKo = String(q.questionKo || '다음 문장을 큰 소리로 읽고 녹음하세요.').trim();

      const sourcePageId = validPageIds.has(q.sourcePageId)
        ? q.sourcePageId
        : (pages[0]?.id || '');
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || '';

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

      const sourcePageId = validPageIds.has(q.sourcePageId)
        ? q.sourcePageId : (pages[0]?.id || '');
      const sourcePageTitle = pageTitleMap.get(sourcePageId) || '';

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
