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
    if (pages.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 pages per request' });
    }
    const targetCount = Math.min(Math.max(parseInt(count) || 5, 1), 20);
    const quizType = type || 'mcq';

    if (!SYSTEM_PROMPTS[quizType]) {
      return res.status(400).json({
        error: `Type "${quizType}" not supported. Supported: ${Object.keys(SYSTEM_PROMPTS).join(', ')}`,
      });
    }

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
    const validators = { mcq: validateMCQ, fill_blank: validateFillBlank, subjective: validateSubjective };
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
      maxOutputTokens: 8192,
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

  if (!text) {
    const finishReason = data.candidates?.[0]?.finishReason;
    return {
      ok: false,
      error: `Empty response (finishReason: ${finishReason || 'unknown'})`,
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
