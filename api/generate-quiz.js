// api/generate-quiz.js
// Google Gemini 로 객관식/주관식/단어/녹음/언스크램블/빈칸 문제를 자동 생성
// POST body: { idToken, pages: [{id, title, text}], count?: number, type?: 'mcq' }
// Response: { success, questions: [...] }
//
// 환경변수: GEMINI_API_KEY (Google AI Studio에서 발급)
// 인증: idToken 검증 + 학원 AI 월 쿼터 체크 (Phase 3)

const { verifyAndCheckQuota, incrementUsage } = require('./_lib/quota');
const { postProcessMCQ } = require('./_lib/quiz-post-process');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// firebase-admin 앱 초기화 보장 — GET 경로는 verifyAndCheckQuota 를 안 거쳐서
// 별도로 초기화 안 하면 getFirestore() 가 throw 함.
function _ensureAdminApp() {
  if (getApps().length) return;
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

// appConfig/aiPrompts (Firestore 글로벌 default) = super 글로벌 = 진실 출처.
// 2026-05-24 정책: 학원장이 보는 결과는 언제나 Firestore 값. 코드 default 는 Firestore
//   에 키 자체가 없을 때만 사용되는 emergency fallback. 양방향 동기는 사용자가
//   명시적으로 코드↔Firestore 박기 요청 시에만 진행 (자동 sync 없음).
//   학원장 본인 커스텀(academies/{id}.customPrompts)은 customSystemPrompt 로 별도 전달
//   — 이 함수에 안 닿음.
// 호출당 Firestore read 1회 ($0.0000006).
async function getEffectivePrompt(quizType) {
  try {
    _ensureAdminApp();
    const snap = await getFirestore().doc('appConfig/aiPrompts').get();
    if (snap.exists) {
      const v = snap.data()[quizType];
      if (typeof v === 'string' && v.length > 20) return v;
    }
  } catch (e) {
    console.warn('[generate-quiz] appConfig/aiPrompts read failed:', e.message);
  }
  return SYSTEM_PROMPTS[quizType];
}

// 모델 폴백 체인 (2026-05-18 재배치 — 2.5-flash-lite 503 급증 대응):
//   1차 2.5-flash-lite — GA 안정 + 빠름 + 저렴 (평상시 1차 통과)
//   2차 3.1-flash-lite — 신모델, 2.5-flash 보다 전 항목 저렴 + 빠름
//   3차 2.5-flash      — 1·2 동시 장애 시만 (capable, 비쌈 → 최후)
// 503/429 transient 에러는 같은 모델로 1회 재시도(800ms backoff) 후 다음 모델.
// 4xx 비-rate-limit (400/401/403) 는 폴백 안 함 (동일 결과 예상).
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
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
const MAX_PAGES = 30;

// ─── 문제 타입별 시스템 프롬프트 ───
const SYSTEM_PROMPTS = {
  mcq: `You are an English reading comprehension quiz generator for Korean students.

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

4. VOCABULARY MIRRORING (CRITICAL — Korean students are reading at the passage's level):
   The vocabulary in your QUESTION and ALL FOUR CHOICES must stay at or below the passage's level.

   PRIORITY 1 — Use words that ACTUALLY APPEAR in the passage. Reuse the passage's nouns,
   verbs, adjectives, and key phrases whenever possible. A question phrased with the
   passage's own words is always better than one with synonyms.

   PRIORITY 2 — When a word not in the passage is needed (question words like what/who/why,
   conjunctions like and/but/because, etc.), use only VERY COMMON basic vocabulary that
   any student at the passage's level would know.

   NEVER introduce advanced or abstract vocabulary that doesn't fit the passage's level.
   For elementary or early-middle-school level passages, the following words are FORBIDDEN
   in the question and choices (this list is illustrative, not exhaustive):
     consequence, demonstrate, occur, indicate, primarily, sufficient, encounter,
     eventual, eventually, significant, factor, regarding, particularly, dynamics,
     implication, ultimately, encounter, abandon, perceive, anticipate, comprise,
     attribute, demonstrate, illustrate, signify, constitute, emphasize, reinforce.

   GOOD example (passage talks about "Sam saw a wolf, told villagers, they didn't believe him"):
     Q: "What happened to the sheep when the villagers did not believe Sam?"
     (uses 'happened', 'sheep', 'villagers', 'believe', 'Sam' — all from passage)

   BAD example (same passage):
     Q: "What was the consequence of the villagers' disbelief?"
     (uses 'consequence', 'disbelief' — not in passage, too advanced)

   If you cannot phrase a meaningful question using the passage's vocabulary,
   skip that question idea and find a different angle. Quality at the right level >
   forcing complex questions.

5. Difficulty — controls THINKING DEPTH only (vocabulary stays at passage level per Rule 4):
   - easy: FACT-FINDING. Answer is directly stated in ONE sentence of the passage.
     Use what/who/when/where/which questions. Student just locates the matching sentence.
   - medium: COMPREHENSION. Answer requires combining 2–3 sentences, or understanding
     cause-effect, comparison, sequence, or word meaning from context.
   - hard: INFERENCE. Answer is NOT directly stated. Student must infer the author's
     implied meaning, character motivation, lesson, or theme from the whole passage.
   - Include a mix when possible; exact distribution NOT required.
   - REGARDLESS of difficulty, the vocabulary level rule above is absolute — hard questions
     can still be phrased with passage words (a "hard" inference question is hard because
     of WHAT is asked, not because of unfamiliar words).

6. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
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

  mcq_grammar: `You generate English grammar MCQs for Korean middle/high school students.
Use the passage ONLY to detect grammar patterns and difficulty level.
Output: valid JSON only. No markdown, no prose.

==========================================
CORE RULES
==========================================
1. NEW CONTENT: Do NOT reuse passage sentences/names/specific vocabulary. Construct fresh test sentences using everyday topics (school, family, food, weather, hobbies, pets). The passage is your reference for which grammar patterns and difficulty level to target — NOT a source for verbatim sentences.

2. SHORT (mobile-friendly): question ≤12 words. Each choice ≤5 words. questionKo ≤30자. explanation ≤60자.

3. RANDOM ANSWER POSITION: Spread correct answers evenly across positions 1–4 (~25% each). NEVER default to position 1. (Server post-processing will also shuffle as a safety net.)

4. ONE GRAMMAR POINT PER QUESTION: 4 choices, exactly 1 correct, distractors plausible with clear grammatical errors, similar length/structure.

5. AVOID pure vocabulary or reading comprehension (those are separate quiz types).

6. Grammar topics to test:
   - Verb tenses (past/present/future, perfect, progressive)
   - Subject-verb agreement
   - Articles (a/an/the), prepositions, pronouns, conjunctions
   - Modal verbs (can/could/may/might/should/must)
   - Relative clauses, conditionals, passive voice
   - Comparatives/superlatives, gerunds/infinitives
   - Word forms, parts of speech

==========================================
QUESTIONKO FORMAT (CRITICAL)
==========================================
Type A — Context-dependent grammar (modals, articles, tenses without time markers, ambiguous pronouns):
→ questionKo MUST include Korean translation showing intended meaning.
  Format: "[한글 번역]. 빈칸에 알맞은 것을 고르시오."
  Example: "그는 매우 빠를 것이다. 빈칸에 알맞은 것을 고르시오." (for "He ___ be very fast." with answer must)

Type B — Context-independent grammar (subject-verb agreement, comparatives, passive, relative clauses, gerund/infinitive, word forms):
→ questionKo is a short instruction only.
  Example: "빈칸에 알맞은 동사 형태를 고르시오."

==========================================
a / an RULE (AI 가 자주 실수하는 영역)
==========================================
"an" goes before VOWEL SOUNDS, not vowel letters.
- Words starting with a, e, i, o → "an" (an apple, an artificial, an egg, an honest)
- "u" with [yoo] sound → "a" (a university, a uniform, a useful tool)
- "u" with [uh/oo] sound → "an" (an umbrella, an uncle)
- Silent "h" → "an" (an hour, an honor, an heir)
- Pronounced "h" → "a" (a house, a hat)
⚠️ NEVER answer "a" before: artificial, athletic, academic, animal, apple, egg, hour, honest, honor.
⚠️ NEVER answer "an" before: university, uniform, useful, unique, year, young, one, once.

==========================================
QUESTION STEM PATTERNS (vary across questions)
==========================================
- Fill-in-the-blank: "She ___ to school every day." (correct: goes)
- Choose the correct: "Which sentence is grammatically correct?"
- Identify the error: "Which option contains a grammatical error?"
- Best transformation: "Which correctly transforms to passive voice?"

==========================================
DIFFICULTY
==========================================
Include a mix of easy / medium / hard when possible. Exact distribution NOT required.

==========================================
OUTPUT FORMAT
==========================================
{
  "questions": [
    {
      "type": "mcq",
      "question": "She ___ to school every day.",
      "questionKo": "빈칸에 알맞은 동사 형태를 고르시오.",
      "choices": [
        { "text": "go", "isAnswer": false },
        { "text": "goes", "isAnswer": true },
        { "text": "going", "isAnswer": false },
        { "text": "gone", "isAnswer": false }
      ],
      "explanation": "주어 She (3인칭 단수) + 현재시제 → -s/-es 추가",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "easy"
    }
  ]
}

Do NOT wrap in markdown code blocks. Do NOT add any text before or after the JSON.`,

  subjective: `You are an English reading comprehension test generator for Korean middle/high school students.
The students have already memorized the textbook passages thoroughly. Your task is to test whether they truly UNDERSTAND the story/content, not whether they can pattern-match memorized phrases.
Create paraphrased summary sentences that retell the passage's storyline using different sentence structures and expressions, then ask students to translate them into Korean.
RULES:
1. Read the passage and identify the storyline, key events, character actions, cause-effect relationships, or main arguments. Focus on the FLOW of content (what happens, why, what follows).
2. Construct a NEW English sentence that PARAPHRASES a piece of the storyline. The sentence should:
   - Convey content from the passage in DIFFERENT words and DIFFERENT sentence structure
   - NOT match any sentence pattern that appears in the passage
   - Be recognizable as the passage's content ONLY if the student truly understood the story
   - A student who merely memorized the passage word-for-word should find this sentence unfamiliar in form, even though the meaning is from the passage
3. VOCABULARY CONSTRAINT (important):
   - Use vocabulary at or BELOW the passage's difficulty level
   - Prefer simple, common words that a student at this level already knows
   - Do NOT introduce advanced or unfamiliar vocabulary just to make the sentence "different"
   - The challenge should come from comprehension, not from unfamiliar words
4. PARAPHRASING TECHNIQUES to use (vary across questions):
   - Change active voice to passive (or vice versa)
   - Replace specific phrases with synonyms or simpler equivalents
   - Restructure clause order (e.g., move the cause before the effect, or vice versa)
   - Combine two short ideas into one sentence with a conjunction
   - Express the same fact from a different character's perspective
   - Use a generic descriptor instead of a specific name where it doesn't lose meaning
5. Each summary sentence MUST be EXACTLY ONE sentence (one period at the end). You MAY use commas, conjunctions, and relative clauses to combine ideas WITHIN a single sentence.
6. Each summary sentence MUST have 30 words or fewer. Aim for around 15-25 words.
7. The sentence must accurately reflect what happens in the passage. Do not contradict the passage or invent events that aren't there. Do not introduce characters or items that don't appear.
8. The sentence must be self-contained — avoid pronouns without clear antecedents; use names or descriptors when needed.
9. For each sentence, provide a natural Korean translation that a teacher would accept as a model answer (sampleAnswerKo). Fluent Korean, not literal word-by-word.
10. questionKo field: Use simple instruction like "위 문장을 우리말로 해석하시오." (slight variations are fine).
11. explanation field: Provide brief notes (1-2 items max) — typically a paraphrase note (e.g., "본문의 X 부분을 다른 표현으로 바꿈") or a key vocabulary point.
12. Difficulty:
    - easy: simple paraphrase with mostly identical vocabulary
    - medium: structural change + some vocabulary substitution
    - hard: significant restructuring + multiple synonym substitutions
    - Include a mix when possible.
13. When multiple passages are given, distribute questions across them (1-3 per passage).
14. If the passage's storyline is too thin to support meaningful paraphrasing, RETURN FEWER questions. Quality over quantity.
15. Before outputting each sentence, verify: (a) it ends with exactly one period, (b) it has 30 words or fewer, (c) it uses different wording/structure than the passage, (d) it does NOT contain vocabulary harder than the passage. If any check fails, rewrite the sentence.
16. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "questions": [
    {
      "type": "subjective",
      "sentence": "Although her friend felt afraid, the young girl wanted to investigate the strange noise from the barn.",
      "questionKo": "위 문장을 우리말로 해석하시오.",
      "sampleAnswerKo": "친구는 두려워했지만, 그 어린 소녀는 헛간에서 들리는 이상한 소리를 살펴보고 싶어 했다.",
      "explanation": "본문의 'Mia wanted to check it out, but her friend was too scared'를 종속절(although)로 재구성",
      "sourcePageId": "the id you were given",
      "sourcePageTitle": "the title you were given",
      "difficulty": "medium"
    }
  ]
}
Do NOT wrap in markdown code blocks. Do NOT add any text before or after the JSON.`,

  // 해석하기_주관식 — 문장 유지(verbatim) 모드. 본문 문장 그대로 출제 (paraphrase X)
  // 학원장 옵션 'sentenceMode=verbatim' 일 때 사용. default(paraphrase)는 subjective.
  subjective_verbatim: `You are an English-to-Korean translation test generator for Korean students.
Your task is to pick sentences DIRECTLY from given English passages for a printed test paper (no auto-grading — students write by hand).

RULES:
1. Pick ONE meaningful sentence per question, copying it VERBATIM from the passage.
   Every word, every form, every punctuation must match the source exactly.
   Do NOT paraphrase, summarize, restructure, combine, or fabricate.
   The selected sentence MUST be findable in the passage as a continuous substring.

2. Prefer sentences with substantive content that test grammar, vocabulary, or comprehension.
   Avoid trivial sentences (e.g., "Hello.", "Yes.", "OK.").

3. SENTENCE LENGTH: aim for 5-30 words. Skip very short fragments or extremely long sentences.

4. For each sentence, provide a natural Korean translation that a teacher would accept
   as a model answer (sampleAnswerKo). Fluent Korean, not literal word-by-word.

5. questionKo field: Use a simple instruction like "위 문장을 우리말로 해석하시오."
   (slight variations are fine, e.g., "아래 문장을 한국어로 옮기시오.").

6. explanation field: Provide brief notes (1-2 items max) — typically a key vocabulary
   item or grammar point relevant to translating this sentence. NO paraphrase notes
   (this is verbatim mode).

7. Difficulty: include a mix of easy / medium / hard when possible.
   Exact distribution is NOT required.

8. When multiple passages are given, distribute questions across them (1-3 per passage).

9. If the passage doesn't have enough quality sentences (e.g., too short / too few real
   sentences), return FEWER questions. Quality over quantity.

10. Output ONLY a valid JSON object in this exact format (no markdown, no prose):
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
Your task is to create vocabulary questions with Korean meanings from the given input.

═══════════════════════════════════════════════════════════════
INPUT TYPE DETECTION (FIRST STEP — ALWAYS CHECK)
═══════════════════════════════════════════════════════════════

Before applying any rules, examine the input format:

[TYPE A: VOCABULARY LIST]
The input is a vocabulary list if MOST non-empty lines follow this pattern:
   <English word/phrase><TAB><Korean meaning>

Examples of valid vocabulary list lines:
   apple<TAB>사과
   send > sent<TAB>보내다
   it might be ~<TAB>~일지도 모른다
   on the way home<TAB>집에 가는 길에

[TYPE B: PASSAGE]
The input is a reading passage if it consists of full sentences/paragraphs
without consistent tab-separated structure.

═══════════════════════════════════════════════════════════════
RULE 1: VOCABULARY LIST MODE (when input is TYPE A)
═══════════════════════════════════════════════════════════════

When the input is a vocabulary list (TYPE A):

1-1. Generate EXACTLY ONE question per valid line in the input.
     "Valid line" means: contains a tab character AND has non-empty content
     on BOTH sides of the first tab.
     Preserve the original count of valid lines.

1-2. Use the English word/phrase EXACTLY as given (left side of first tab).
     Do NOT modify, normalize, split, translate, or filter:
     - Keep all special characters: > ~ . , ( ) etc.
     - Keep multi-word phrases as single units: "play a joke", "be alone"
     - Keep verb forms with arrows: "send > sent", "hide > hid A from B"
     - Keep articles, prepositions, pronouns, auxiliary verbs — accept any form
     - Do NOT correct typos or capitalization

1-3. Use the Korean meaning EXACTLY as given (right side of first tab).
     If the line has multiple tabs, use only the content between the FIRST and
     SECOND tab; ignore any additional columns.

1-4. Preserve the original ORDER of items.

1-5. Do NOT remove duplicates — output every valid line as a separate question.
     If "Friday → 금요일" and "Friday → 금" both appear, output both.

1-6. SKIP these lines (do not generate a question, do not include in output):
     - Empty lines or lines with only whitespace
     - Lines without any tab character
     - Lines where English (left of first tab) is empty
     - Lines where Korean (right of first tab) is empty

1-7. For "example" and "exampleKo": always set to empty string "".
     Do NOT generate example sentences in vocabulary list mode.

1-8. For "difficulty": always set "medium" in vocabulary list mode.
     Do NOT classify by frequency or complexity.

1-9. ★ CRITICAL: When in vocabulary list mode, IGNORE Rules 2 through 6 below.
     Skip the entire content-word filtering, deduplication, example generation,
     and difficulty classification logic. The user's list is authoritative —
     output it as-is, one question per valid line.

═══════════════════════════════════════════════════════════════
RULES 2-6: PASSAGE MODE (when input is TYPE B)
═══════════════════════════════════════════════════════════════

When the input is a reading passage (TYPE B), apply the following:

2. Pick meaningful CONTENT words (nouns, verbs, adjectives, adverbs).
   AVOID articles, prepositions, pronouns, common auxiliary verbs.

3. For each word, provide:
   - Korean meaning (natural, 1-3 words)
   - One example sentence from the passage (or adapted)
   - Korean translation of the example

4. Each word should appear ONCE (no duplicates in the set).

5. Prefer words that are:
   - Actually useful for middle/high school vocabulary building
   - Not too common (skip "go", "make", "have" etc. unless phrasal verbs)
   - Not proper nouns (names of people/places)

6. Difficulty:
   - easy: common 1000-word list
   - medium: intermediate vocabulary
   - hard: advanced vocabulary, less common words

═══════════════════════════════════════════════════════════════
RULE 7: OUTPUT FORMAT (applies to BOTH modes)
═══════════════════════════════════════════════════════════════

Output ONLY a valid JSON object (no markdown, no prose, no code fences):

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
}

In vocabulary list mode (TYPE A), the output for each question would look like:

{
  "type": "vocab",
  "word": "send > sent",
  "meaning": "보내다",
  "example": "",
  "exampleKo": "",
  "sourcePageId": "the id you were given",
  "sourcePageTitle": "the title you were given",
  "difficulty": "medium"
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

5. Difficulty (REBASED 2026-05-20 — shifted down to favor easier student levels):
   - easy: very short sentences (≤8 words) with simple structure AND only high-frequency common words (800-1000 word range)
   - medium: short sentences (8-12 words) with simple grammar and everyday common words (was the prior "easy")
   - hard: medium length (10-14 words) with general grammar — common everyday vocabulary, NO relative clauses / participial phrases / complex structures, NO rare or advanced words (was the prior "medium")

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
  // 우선순위: appConfig/aiPrompts (글로벌 default) → 코드 상수 fallback
  if (req.method === 'GET') {
    const t = req.query?.type;
    if (t) {
      if (!SYSTEM_PROMPTS[t]) return res.status(400).json({ error: `Unknown type: ${t}` });
      const prompt = await getEffectivePrompt(t);
      return res.status(200).json({ success: true, type: t, prompt });
    }
    // 전체 조회 — 6 유형 모두 effective 값 반환
    const out = {};
    for (const key of Object.keys(SYSTEM_PROMPTS)) {
      out[key] = await getEffectivePrompt(key);
    }
    return res.status(200).json({ success: true, prompts: out });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { idToken, pages, count, type, customSystemPrompt, mode, words, subType, sentences, chunkCount } = req.body || {};

    // ─── 인증 + Generator 월 쿼터 체크 (T2/T3 5분류 분리) ───
    const q = await verifyAndCheckQuota({ idToken, quotaKind: 'generator' });
    if (q.error) return res.status(q.status).json({ error: q.error, limit: q.limit, currentCount: q.currentCount });
    // 쿼터 통과 시점에 카운트 — daily/monthly 단일 writer (서버) 통합
    await incrementUsage({ ...q, res, endpoint: 'generate-quiz' });

    // ─── 동음이의어 전용 분기 (Wordsnap 수동 입력용) ───
    // 문제 생성 X. 단어 리스트 → AI → { word, homophones[] } 매핑.
    // 토큰 적음 (정상 vocab 호출의 1/10 수준).
    if (mode === 'homophones-only') {
      return await handleHomophonesOnly({ words, apiKey, res });
    }

    // ─── 언스크램블 직접 입력 분기 (한 줄 1 영문장 → 청크 분할 + 한글뜻) ───
    // 입력 문장 원문 100% 보존 (변경·누락 절대 X). 청크 분할 + meaningKo 자동 생성.
    if (mode === 'unscramble-from-text') {
      return await handleUnscrambleFromText({ sentences, chunkCount, apiKey, res });
    }

    // ─── 말하기 부적합 단어 판별 (의성어 / 사전없음 / ASR 오인식 위험) ───
    // 휴리스틱(3글자 이하)은 클라가, 의성어·사전·ASR위험 판단은 AI. generator 쿼터(위에서 카운트됨).
    if (mode === 'speaking-unfit-check') {
      return await handleSpeakingUnfit({ words, apiKey, res });
    }

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
    // mcq subType: 'content' (default) | 'grammar'. 프롬프트·검증 분기.
    const mcqSubType = (quizType === 'mcq' && subType === 'grammar') ? 'grammar' : 'content';
    // subjective sentenceMode: 'paraphrase' (default) | 'verbatim'. 별도 프롬프트 분기.
    const subjectiveMode = (quizType === 'subjective' && req.body?.sentenceMode === 'verbatim') ? 'verbatim' : 'paraphrase';
    const promptKey = (quizType === 'mcq' && mcqSubType === 'grammar') ? 'mcq_grammar'
                    : (quizType === 'subjective' && subjectiveMode === 'verbatim') ? 'subjective_verbatim'
                    : quizType;

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
    })).filter(p => p.text.length > 0);

    if (normalizedPages.length === 0) {
      return res.status(400).json({ error: 'No valid page content' });
    }

    // ─── 프롬프트 구성 ───
    // 우선순위:
    //   1. customSystemPrompt (학원장 localStorage 에 저장된 학원별 커스텀)
    //   2. appConfig/aiPrompts (super_admin 편집한 글로벌 default)
    //   3. SYSTEM_PROMPTS (코드 fallback, 1·2 다 비었거나 짧을 때)
    const systemPrompt = (typeof customSystemPrompt === 'string' && customSystemPrompt.trim().length >= 20)
      ? customSystemPrompt.trim()
      : (await getEffectivePrompt(promptKey));
    const userPrompt = buildUserPrompt(normalizedPages, targetCount, quizType, { ...(req.body || {}), mcqSubType, subjectiveMode });

    // ─── Gemini API 호출 (폴백 체인 + 동일 모델 1회 재시도) ───
    let lastError = null;
    let lastStatus = null;
    let usedModel = null;
    let rawText = null;
    let usage = null;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const isTransient = (status) => status === 503 || status === 429;

    outer:
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await callGemini(model, apiKey, systemPrompt, userPrompt);
          if (result.ok) {
            usedModel = model;
            rawText = result.text;
            usage = result.usage;
            break outer;
          }
          lastError = result.error;
          lastStatus = result.status || null;
          // 4xx 비-transient (400/401/403) 는 다른 모델도 동일 에러 — 즉시 중단
          if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
            return res.status(502).json({ error: 'AI service error', detail: lastError, model, status: lastStatus });
          }
          // 503/429 → 같은 모델 1회 재시도 (800ms backoff)
          if (isTransient(lastStatus) && attempt === 0) {
            console.warn(`[generate-quiz] ${model} ${lastStatus} → 800ms 후 재시도`);
            await sleep(800);
            continue;
          }
          // 그 외 (404 / 5xx 등) → 다음 모델
          console.warn(`[generate-quiz] ${model} 실패(${lastStatus}) → 다음 모델`);
          continue outer;
        } catch (e) {
          lastError = e.message;
          console.warn(`[generate-quiz] ${model} exception:`, e.message);
          if (attempt === 0) { await sleep(800); continue; }  // 네트워크 오류도 1회 재시도
        }
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
    let validated = validators[quizType](parsed.questions || [], normalizedPages, { mcqSubType, subjectiveMode });

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
            const retryValidated = validators[quizType](retryParsed.questions || [], normalizedPages, { mcqSubType, subjectiveMode });
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

    // mcq 후처리 — a/an 자동 보정 + 선택지 셔플 (위치 편향 제거)
    let autoFixedCount = 0;
    if (quizType === 'mcq') {
      const post = postProcessMCQ(validated);
      validated = post.questions;
      autoFixedCount = post.autoFixedCount;
    }

    return res.status(200).json({
      success: true,
      type: quizType,
      model: usedModel,
      requestedCount: targetCount,
      returnedCount: validated.length,
      retried,
      autoFixedCount,
      questions: validated,
      // 클라이언트가 세트 doc 에 박을 메타 (subType / subjectiveMode 등)
      ...(quizType === 'mcq' ? { mcqSubType } : {}),
      ...(quizType === 'subjective' ? { subjectiveMode } : {}),
      usage,
      retryUsage,
    });
  } catch (err) {
    console.error('generate-quiz error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

// ─── 동음이의어 전용 프롬프트 ───
// 단어 리스트 → 각 단어의 영어 동음이의어 추출. 단어 시험 말하기 모드 채점 보조.
// 출력: { results: [{ word, homophones: [] }] } — 입력 순서·소문자 유지.
// 2026-05-23: 단어 말하기 1·2·3차 흐름 (영어 STT → 한국어 STT → 빈칸 문장 STT) 도입으로
// homophones 단일 출력에서 4필드(homophones / koPron / sentence / sentenceKo) 동시 생성으로 확장.
// AI 호출 1회로 출제 시점 데이터 일괄 생성.
const HOMOPHONES_PROMPT = `You generate speaking-test data for Korean students learning English vocabulary.

For each given English word or phrase, output FOUR fields: homophones, koPron, sentence, sentenceKo.

═══ FIELD 1: homophones ═══
List any English homophones — sound-alike words that pronounce identically (or near-identically) in standard American English and that a speech recognition system would commonly confuse with the input.

RULES:
1. Only list TRUE homophones (same pronunciation, different spelling/meaning).
   Examples: cereal/serial, piece/peace, weak/week, weather/whether, your/you're, their/there/they're, flower/flour, knight/night.
   NOT homophones: cat/cot, mat/mate, bit/beat — clearly different vowels, do NOT list.
2. Multi-word phrases: list phrases that sound identical only if a true phrase-level homophone exists. Otherwise [].
3. Include even very short single-syllable homophones (high/hi, by/bye/buy, two/to/too, be/bee, see/sea).
4. EXACT lowercase form (no capitalization, no quotes, no extra spaces).
5. If a word has NO true homophones, return [] — do NOT invent any.

═══ FIELD 2: koPron (Korean pronunciation guide) ═══
A natural Korean transliteration that a Korean student would write down after hearing the word — used as ground truth for matching ko-KR speech recognition output (Korean students saying the English word, but the STT engine running in Korean mode).

RULES:
1. Use only Korean hangul + spaces. NO English letters, NO numbers, NO punctuation.
2. Match the conventional Korean transliteration used in Korean schools/dictionaries.
   Examples: right → 라이트, cereal → 시리얼, ought to → 오트 투, grayish-brown → 그레이시 브라운, vegetable → 베지터블, squirt → 스쿼트.
3. Multi-word phrases: separate each word with a single space (matching English word boundary).
4. NEVER leave empty. If the word is unusual, give your best phonetic Korean approximation.

═══ FIELD 3: sentence (English example sentence) ═══
A short English sentence containing the target word/phrase, used for the 3rd-attempt sentence-reading mode.

RULES:
1. Length: 5–10 words total (short, easy to read aloud).
2. The target word MUST appear EXACTLY ONCE, matching the input form (case-insensitive, but keep lowercase unless the target is a proper noun).
   - If input is "roll up", the sentence must contain "roll up" verbatim (not "rolls up" or "rolled up").
   - If input is "be destroyed", the sentence must contain "be destroyed" verbatim.
3. Place the target word in the MIDDLE of the sentence when possible (not at the very start or very end).
4. The OTHER words in the sentence must be from the most common 500–1000 English words (CEFR A1 level).
   - GOOD: I eat cereal every morning. / Please turn right at the corner. / The big wind will destroy houses.
   - BAD (uses rare words): The carpet stored the cereal. / The frost destroys plants annually.
5. Use only standard letters (a-z, A-Z), spaces, apostrophe ('), and a single trailing period or question mark. NO commas, NO quotes, NO dashes other than within the target itself.
6. NO abbreviations or initialisms in the sentence (TV, USA, OK, FBI, NASA, iPhone, WiFi, USB, ATM, etc.).
   These cause translation conflicts (sentenceKo would have to either keep the English letters
   or transliterate them, both of which break the Korean-only rule). Use the full word instead
   (e.g., "television" not "TV", "the United States" not "USA"), or pick a different example sentence.
7. NEVER leave empty.

═══ FIELD 4: sentenceKo (Korean translation of the sentence) ═══
A natural Korean translation of the sentence above, with the part that corresponds to the target word wrapped in [square brackets].

RULES:
1. Translate the WHOLE sentence naturally into Korean.
2. Wrap the portion that translates the target word/phrase in [square brackets]. EXACTLY ONE pair of brackets per sentence.
   - Example: target=right, sentence="Please turn right at the corner.", sentenceKo="모퉁이에서 [오른쪽으로] 도세요."
   - Example: target=destroy, sentence="The big wind will destroy houses.", sentenceKo="큰 바람이 집들을 [파괴할] 것이다."
3. Use only Korean hangul, basic punctuation (. ? ,) and the [] brackets. NO English letters in the translation itself.
4. NEVER leave empty.

═══ FIELD 5: speakingTip (pronunciation coaching for Korean learners) ═══
A short, SPECIFIC Korean coaching tip about the pronunciation difficulty Korean learners typically face with this exact word.

RULES:
1. Maximum 25 hangul characters (short — read at a glance).
2. Only Korean hangul + basic punctuation (. , / ~). NO English letters except when quoting a sound (e.g., "R", "L", "th", "F").
3. Focus on the SPECIFIC sound or part of THIS word that's hard for Korean speakers — not generic advice.
   GOOD examples:
     "right" → "R 발음 — 혀 끝 말지 말기"
     "fast" → "F 발음 — 아랫입술 살짝"
     "think" → "th — 혀 끝 이 사이로"
     "rice" → "R 발음 / lice 와 다름"
     "world" → "월드 아닌 워얼드"
     "vegetable" → "베지터블 — 4음절"
   BAD (generic): "또박또박 발음하기", "정확하게 말하기", "천천히 말하기"
4. If THIS specific word has no particular Korean-learner difficulty (e.g., very simple words like "cat", "dog", "book"), return empty string "".

═══ OUTPUT ═══
Output ONLY a valid JSON object (no markdown, no prose):
{
  "results": [
    { "word": "cereal", "homophones": ["serial"], "koPron": "시리얼", "sentence": "I eat cereal every morning.", "sentenceKo": "나는 매일 아침 [시리얼]을 먹는다.", "speakingTip": "" },
    { "word": "right", "homophones": ["write", "rite"], "koPron": "라이트", "sentence": "Please turn right at the corner.", "sentenceKo": "모퉁이에서 [오른쪽으로] 도세요.", "speakingTip": "R 발음 — 혀 끝 말지 말기" },
    { "word": "think", "homophones": [], "koPron": "씽크", "sentence": "I think you are smart.", "sentenceKo": "너는 똑똑하다고 [생각해].", "speakingTip": "th — 혀 끝 이 사이로" }
  ]
}

The "results" array must include EVERY input word, in the same order, with ALL FIVE fields populated (speakingTip can be "" if no specific difficulty).`;

// 언스크램블 직접 입력 — 입력 문장 원문 보존 + 청크 분할 + 한글뜻 (2026-05-15)
const UNSCRAMBLE_FROM_TEXT_PROMPT = `You are an English sentence unscramble exercise generator for Korean students.

You receive a list of English sentences (one per line, entered directly by the teacher).
For EACH sentence:
1. Keep the sentence EXACTLY as given — VERBATIM. Every word, form, punctuation, capitalization, spelling MUST match the input. Do NOT paraphrase, summarize, combine, reorder, add, or remove anything. The joined (de-chunked) sentence MUST equal the input character-for-character (only '/' chunk separators added).
2. Split into chunks using '/' as separator. Target chunk count is N — you may use N-1, N, or N+1 chunks when natural linguistic boundaries fit better. Stay within [N-1, N+1].
   - SHORT (5-8 words): single words OK
   - MEDIUM (8-15 words): phrases (noun/verb/prepositional phrases)
   - LONG (15+ words): semantic meaning units (clauses, relative/participial phrases)
   - ALWAYS respect natural linguistic boundaries.
3. Provide a natural Korean translation (meaningKo) of the whole sentence.

NEVER drop a sentence. Output EXACTLY one question per input sentence, in the SAME order.

Output ONLY valid JSON (no markdown):
{
  "questions": [
    {
      "type": "unscramble",
      "chunkedSentence": "The /boy picked up/ the ball",
      "meaningKo": "그 소년이 공을 주웠다.",
      "difficulty": "medium"
    }
  ]
}`;

async function handleUnscrambleFromText({ sentences, chunkCount, apiKey, res }) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return res.status(400).json({ error: 'sentences array is required' });
  }
  const sanitized = sentences
    .map(s => String(s || '').trim())
    .filter(s => s && s.length >= 3 && s.length <= 400)
    .slice(0, 100);
  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'No valid sentences (length 3~400 required)' });
  }
  const N = Math.max(2, Math.min(10, parseInt(chunkCount) || 4));

  const userPrompt = `Target chunk count N = ${N}.
Generate one unscramble question for EACH of these ${sanitized.length} sentences (keep verbatim, split into chunks, add Korean meaning):

${sanitized.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Output ONLY the JSON object. EXACTLY ${sanitized.length} questions, same order.`;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTransient = (status) => status === 503 || status === 429;

  let rawText = null, usedModel = null, lastError = null, lastStatus = null;
  outer:
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callGemini(model, apiKey, UNSCRAMBLE_FROM_TEXT_PROMPT, userPrompt);
        if (result.ok) { usedModel = model; rawText = result.text; break outer; }
        lastError = result.error; lastStatus = result.status || null;
        if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
          return res.status(502).json({ error: 'AI service error', detail: lastError, model, status: lastStatus });
        }
        if (isTransient(lastStatus) && attempt === 0) { await sleep(800); continue; }
        continue outer;
      } catch (e) {
        lastError = e.message;
        if (attempt === 0) { await sleep(800); continue; }
      }
    }
  }
  if (!rawText) {
    return res.status(502).json({ error: 'All AI models failed', detail: lastError, triedModels: GEMINI_MODELS });
  }

  const parsed = parseAIResponse(rawText);
  if (!parsed || !Array.isArray(parsed.questions)) {
    return res.status(502).json({ error: 'Failed to parse AI response', rawSnippet: rawText.slice(0, 500), model: usedModel });
  }

  // 검증: chunkedSentence 의 '/' 제거 후 원문과 일치해야 (원문 보존 보장)
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const questions = [];
  parsed.questions.forEach((qq, idx) => {
    if (!qq || typeof qq !== 'object') return;
    let chunked = String(qq.chunkedSentence || '').trim();
    const orig = sanitized[idx] || '';
    if (!orig) return;
    if (!chunked) {
      // AI 가 청크 누락 — 원문 N등분 fallback
      const w = orig.split(/\s+/);
      const per = Math.max(1, Math.ceil(w.length / N));
      const parts = [];
      for (let i = 0; i < w.length; i += per) parts.push(w.slice(i, i + per).join(' '));
      chunked = parts.join(' / ');
    }
    const joined = chunked.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (norm(joined) !== norm(orig)) {
      // AI 가 원문 변형 — 원문 단어 단위 N등분 강제 (원문 100% 보존)
      const w = orig.split(/\s+/);
      const per = Math.max(1, Math.ceil(w.length / N));
      const parts = [];
      for (let i = 0; i < w.length; i += per) parts.push(w.slice(i, i + per).join(' '));
      chunked = parts.join(' / ');
    }
    questions.push({
      type: 'unscramble',
      chunkedSentence: chunked,
      meaningKo: String(qq.meaningKo || '').trim(),
      sourcePageId: '',
      sourcePageTitle: '직접 입력',
      difficulty: qq.difficulty || 'medium',
    });
  });

  if (questions.length === 0) {
    return res.status(502).json({ error: 'No valid questions generated', rawSnippet: rawText.slice(0, 500) });
  }

  return res.status(200).json({
    success: true,
    mode: 'unscramble-from-text',
    model: usedModel,
    requestedCount: sanitized.length,
    questions,
  });
}

async function handleHomophonesOnly({ words, apiKey, res }) {
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array is required' });
  }
  const sanitized = words
    .map(w => String(w || '').trim())
    .filter(w => w && w.length >= 2 && w.length <= 60)
    .slice(0, 200);
  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'No valid words (length 2~60 required)' });
  }

  const userPrompt = `Identify English homophones for each of these ${sanitized.length} English words/phrases:

${sanitized.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Output ONLY the JSON object as specified.`;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTransient = (status) => status === 503 || status === 429;

  let rawText = null;
  let usedModel = null;
  let lastError = null;
  let lastStatus = null;

  outer:
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callGemini(model, apiKey, HOMOPHONES_PROMPT, userPrompt);
        if (result.ok) { usedModel = model; rawText = result.text; break outer; }
        lastError = result.error;
        lastStatus = result.status || null;
        if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
          return res.status(502).json({ error: 'AI service error', detail: lastError, model, status: lastStatus });
        }
        if (isTransient(lastStatus) && attempt === 0) { await sleep(800); continue; }
        continue outer;
      } catch (e) {
        lastError = e.message;
        if (attempt === 0) { await sleep(800); continue; }
      }
    }
  }

  if (!rawText) {
    return res.status(502).json({ error: 'All AI models failed', detail: lastError, triedModels: GEMINI_MODELS });
  }

  const parsed = parseAIResponse(rawText);
  if (!parsed || !Array.isArray(parsed.results)) {
    return res.status(502).json({ error: 'Failed to parse AI response', rawSnippet: rawText.slice(0, 500), model: usedModel });
  }

  // 입력 단어 → 4필드 매핑 (input order 보존)
  // 검증 실패 필드는 빈 값으로 — tpPublish 게이트에서 누락 단어 차단
  const mapByLower = new Map();
  for (const r of parsed.results) {
    if (!r || typeof r !== 'object') continue;
    const w = String(r.word || '').toLowerCase().trim();
    if (!w) continue;

    // homophones
    const homos = Array.isArray(r.homophones) ? r.homophones : [];
    const cleanedHomos = Array.from(new Set(
      homos
        .map(h => String(h || '').toLowerCase().trim())
        .filter(h => h && h !== w && h.length >= 2 && h.length <= 60)
    )).slice(0, 5);

    // koPron — 한글만 (영문/숫자/특수문자 제거 후 비어있으면 빈값)
    let koPron = String(r.koPron || '').trim();
    if (koPron && !/^[가-힣\s]+$/.test(koPron)) {
      koPron = koPron.replace(/[^가-힣\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    // sentence — 5~10단어 + 목표 단어 포함 + 영문/공백/'/-/.?만
    let sentence = String(r.sentence || '').trim();
    if (sentence) {
      // 허용 문자 외 제거 (콤마·쉼표·기타 문장부호 제거)
      const cleanedSent = sentence.replace(/[^a-zA-Z'\s\-.?]/g, '').replace(/\s+/g, ' ').trim();
      const wordCount = cleanedSent.split(/\s+/).filter(Boolean).length;
      // 목표 단어가 sentence 내에 포함되는지 (word boundary, case-insensitive)
      const targetRe = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (wordCount >= 4 && wordCount <= 12 && targetRe.test(cleanedSent)) {
        sentence = cleanedSent;
      } else {
        sentence = '';
      }
    }

    // sentenceKo — 한글 포함 + [대괄호] 쌍 정확히 1개
    let sentenceKo = String(r.sentenceKo || '').trim();
    if (sentenceKo) {
      const hasHangul = /[가-힣]/.test(sentenceKo);
      const openCount = (sentenceKo.match(/\[/g) || []).length;
      const closeCount = (sentenceKo.match(/\]/g) || []).length;
      const hasBracket = openCount === 1 && closeCount === 1 && sentenceKo.indexOf('[') < sentenceKo.indexOf(']');
      // 영문 금지 (괄호 안 포함 — 전부 한글 번역이어야 함)
      const hasEnglish = /[a-zA-Z]/.test(sentenceKo);
      if (!hasHangul || !hasBracket || hasEnglish) sentenceKo = '';
    }

    // speakingTip — 한글 포함 + 길이 ≤ 50 (안전망, 프롬프트 25자 + 여유)
    // 영문 일부 허용 (R/L/th/F 같은 발음 기호 인용). 단 한글 한 글자 이상 필수.
    let speakingTip = String(r.speakingTip || '').trim();
    if (speakingTip) {
      const hasHangulTip = /[가-힣]/.test(speakingTip);
      if (!hasHangulTip || speakingTip.length > 50) speakingTip = '';
    }

    mapByLower.set(w, { homophones: cleanedHomos, koPron, sentence, sentenceKo, speakingTip });
  }

  const results = sanitized.map(w => {
    const m = mapByLower.get(w.toLowerCase()) || {};
    return {
      word: w,
      homophones: m.homophones || [],
      koPron: m.koPron || '',
      sentence: m.sentence || '',
      sentenceKo: m.sentenceKo || '',
      speakingTip: m.speakingTip || '',
    };
  });

  return res.status(200).json({
    success: true,
    mode: 'homophones-only',
    model: usedModel,
    count: results.length,
    results,
  });
}

const SPEAKING_UNFIT_PROMPT = `You classify English vocabulary words for a Korean students' SPEAKING (voice-recognition) test.

═══ DEFAULT IS ALWAYS FALSE ═══
For ALL three booleans below, the default answer is FALSE. Only output TRUE when you are
>90% confident the word clearly falls into the category. When in any doubt, output FALSE.
Over-flagging normal vocabulary is much worse than under-flagging edge cases.

For EACH given word output three booleans:

──── "onomatopoeia" ────
TRUE only if the word is PRIMARILY an imitative/sound-effect word.
  TRUE examples: woof, buzz, splash, bang, meow, beep, vroom, boom, tick, tweet, hiss, oink, baa, moo
  FALSE examples: bell, drum, noise, sound, music, voice, call, shout, whisper, talk
  Rule of thumb: if the word names a concept or thing (even sound-related), it is NOT onomatopoeia.

──── "notRealWord" ────
TRUE only if the word is NOT suitable as a SPEAKING-test vocabulary item.
  TRUE examples:
    - Arbitrary personal names: Tom, John, Jenny, Mike
    - Brand/product names: Coca-Cola, iPhone, Samsung, Nike
    - Abbreviations / acronyms: FBI, USA, NASA, IBM
    - Made-up / nonsense strings: xqzy, lkjhg, blorp, supercalifragilistic
  FALSE examples (treat as normal vocab):
    - Common dictionary words: cat, run, beautiful, quickly, advertisement, magnificent
    - Geographic proper nouns (countries / cities / states / rivers / mountains):
      Mississippi, Indianapolis, Tokyo, Korea, Paris, London, Seoul, Amazon, Everest
    - Famous historical/literary figures listed in standard dictionaries: Einstein, Shakespeare
  Rule of thumb:
    1) If the word appears in Oxford/Merriam-Webster (including geographic entries), it is FALSE.
    2) Geographic place names are standard English vocabulary and FALSE — they have clear
       pronunciation and Korean students commonly learn them.
    3) Only mark TRUE when the word is an arbitrary personal name, brand, abbreviation, or
       nonsense string with no meaningful vocab value.

──── "hardForASR" ────
TRUE only if a Korean student saying this word is HIGHLY likely to be misrecognized by
a browser SpeechRecognition engine. Specifically: very short, acoustically sparse single-syllable
words with weak vowels, liquid/glide consonants (r/l/w/y), or ambiguous boundaries.

  TRUE examples (clear ASR risk): roll, up, be, err, owe, ore, awe, aria, lyre, ewe, eye, are, our, hour, ear, ire, oar, ire
  FALSE examples (recognize reliably even though short or with r/l):
    wild, soft, claim, feel, pass, big, run, jump, walk, dog, cat, ball, book, school,
    right, light, world, fast, food, milk, hand, foot, head, name, time, water,
    happy, hello, today, family, beautiful, magnificent
    Also FALSE: longer/clear words like advertisement, computer, vegetable, communicate

  Rule of thumb: TRUE only for words that are BOTH very short (≤4 letters typically)
  AND have ambiguous phonetic boundaries. Common everyday words students learn first
  (wild/soft/right/light/world/fast) are FALSE even if short.

═══ OUTPUT ═══
Output ONLY JSON: {"results":[{"word":"...","onomatopoeia":true|false,"notRealWord":true|false,"hardForASR":true|false}, ...]}
One entry per input word, same order, no commentary. Remember: when in doubt, FALSE.`;

async function handleSpeakingUnfit({ words, apiKey, res }) {
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words array is required' });
  }
  const sanitized = words
    .map(w => String(w || '').trim())
    .filter(w => w && w.length <= 60)
    .slice(0, 300);
  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'No valid words' });
  }

  const userPrompt = `Classify these ${sanitized.length} words:

${sanitized.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Output ONLY the JSON object as specified.`;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTransient = (status) => status === 503 || status === 429;

  let rawText = null, usedModel = null, lastError = null, lastStatus = null;
  outer:
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 분류 task — temperature 0 으로 결정성 보장 (같은 입력 → 같은 결과)
        // 일반 출제 task 는 0.7 (다양성 필요) — callGemini default 사용
        const result = await callGemini(model, apiKey, SPEAKING_UNFIT_PROMPT, userPrompt, { temperature: 0 });
        if (result.ok) { usedModel = model; rawText = result.text; break outer; }
        lastError = result.error;
        lastStatus = result.status || null;
        if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 404 && !isTransient(lastStatus)) {
          return res.status(502).json({ error: 'AI service error', detail: lastError, model, status: lastStatus });
        }
        if (isTransient(lastStatus) && attempt === 0) { await sleep(800); continue; }
        continue outer;
      } catch (e) {
        lastError = e.message;
        if (attempt === 0) { await sleep(800); continue; }
      }
    }
  }

  if (!rawText) {
    return res.status(502).json({ error: 'All AI models failed', detail: lastError, triedModels: GEMINI_MODELS });
  }

  const parsed = parseAIResponse(rawText);
  if (!parsed || !Array.isArray(parsed.results)) {
    return res.status(502).json({ error: 'Failed to parse AI response', rawSnippet: rawText.slice(0, 500), model: usedModel });
  }

  const byLower = new Map();
  for (const r of parsed.results) {
    if (!r || typeof r !== 'object') continue;
    const w = String(r.word || '').toLowerCase().trim();
    if (!w) continue;
    byLower.set(w, { onomatopoeia: !!r.onomatopoeia, notRealWord: !!r.notRealWord, hardForASR: !!r.hardForASR });
  }
  const results = sanitized.map(w => {
    const f = byLower.get(w.toLowerCase()) || { onomatopoeia: false, notRealWord: false, hardForASR: false };
    return { word: w, onomatopoeia: f.onomatopoeia, notRealWord: f.notRealWord, hardForASR: f.hardForASR };
  });

  return res.status(200).json({
    success: true,
    mode: 'speaking-unfit-check',
    model: usedModel,
    count: results.length,
    results,
  });
}

async function callGemini(model, apiKey, systemPrompt, userPrompt, opts = {}) {
  // opts.temperature — 호출별 override (분류 task 는 0, 출제 task 는 default 0.7)
  const temperature = (typeof opts.temperature === 'number') ? opts.temperature : 0.7;
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
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

// 난이도 표기 정규화 — 한글 '하/중/상' / 영어 'easy/medium/hard' / 옛 학년('중1','초3' 등) 모두 영어로 매핑.
function _normalizeDifficulty(d) {
  if (d === '하') return 'easy';
  if (d === '중') return 'medium';
  if (d === '상') return 'hard';
  if (d === 'easy' || d === 'medium' || d === 'hard') return d;
  return 'medium';  // 옛 학년 값 또는 미지정 폴백
}

function buildUserPrompt(pages, count, type, opts) {
  const passages = pages.map((p, i) =>
    `[Passage ${i + 1}]\nID: ${p.id}\nTitle: ${p.title}\n---\n${p.text}\n---`
  ).join('\n\n');

  const blanksPerSentence = Math.min(Math.max(parseInt(opts?.blanksPerSentence) || 1, 1), 5);

  const typeInstructions = {
    mcq: opts?.mcqSubType === 'grammar'
      ? `Please generate ${count} 4-choice multiple-choice GRAMMAR questions.
- Identify grammar patterns that appear in the passage (verb tenses, articles, prepositions, modals, conditionals, etc.) and test them.
- Test sentences may be constructed (do NOT need to be verbatim from the passage); they only need to demonstrate the same grammar pattern.
- Each question tests ONE clear grammar point.
- Distribute questions across all passages (if multiple); include sourcePageId matching the passage that inspired the grammar pattern.
- Vary difficulty (per-question easy/medium/hard tag).
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)} — calibrate grammar complexity accordingly.`
      : `Please generate ${count} 4-choice multiple-choice questions.
- Distribute questions across all passages (if multiple)
- Include sourcePageId matching the passage the question is based on
- Vary difficulty levels (per-question easy/medium/hard tag)
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)} — calibrate vocabulary, sentence complexity, and question depth accordingly.`,
    fill_blank: `Please generate ${count} fill-in-the-blank questions.
- Each question should mask approximately ${blanksPerSentence} word(s) per sentence (blanksPerSentence=${blanksPerSentence}).
- Distribute questions across all passages (if multiple)
- Include sourcePageId matching the passage the question is based on
- Vary difficulty levels (per-question easy/medium/hard tag)
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)} — pick blanks of suitable grammar/vocabulary level.`,
    subjective: opts?.subjectiveMode === 'verbatim'
      ? `Please generate ${count} sentence-translation questions (English → Korean).
- VERBATIM mode: pick sentences DIRECTLY from the passages. Copy each sentence EXACTLY as it appears (every word, every punctuation). Do NOT paraphrase, restructure, or fabricate.
- Distribute across all passages (if multiple).
- Include sourcePageId for the source passage.
- Vary difficulty levels (per-question easy/medium/hard tag).
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)} — pick sentences appropriate to this level.`
      : `Please generate ${count} sentence-translation questions (English → Korean).
- PARAPHRASE mode: construct NEW sentences that retell the passage's storyline using DIFFERENT words/structure. The student should recognize the content only if they truly understood the story (not by memorized pattern matching).
- Vocabulary must stay at or below the passage's level (do NOT introduce advanced words).
- Distribute across all passages (if multiple).
- Include sourcePageId for the source passage.
- Vary difficulty levels (per-question easy/medium/hard tag).
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)} — match sentence vocabulary, length, and grammar to this level.`,
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
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)}.
- For each question, ALSO include a "homophones" field (string array). List ONLY true English homophones — words that pronounce identically (or near-identically) in standard American English and that a speech recognition system would commonly confuse with this word.
  Examples of TRUE homophones: cereal→["serial"], piece→["peace"], weak→["week"], weather→["whether"], their→["there","they're"].
  NOT homophones: cat/cot, mat/mate, bit/beat (different vowels — do NOT list these).
  If a word has no true homophones, output [].
  For multi-word phrases: list phrases that sound the same (e.g., "be served"→["be surveyed"]) only if a true homophone exists.
  Output exact lowercase form, no extra spaces.`,
    unscramble: `Please generate ${count} unscramble questions.
- Split each sentence into ${Math.min(Math.max(parseInt(opts?.chunkCount)||4, 2), 10)} chunks (±1 allowed) using '/' separator, whichever respects natural linguistic boundaries better.
- Pick meaningful sentences (6-30 words each).
- Use semantic chunking based on chunk count: fewer chunks = larger semantic units.
- Include sourcePageId for each sentence.
- Target difficulty: ${_normalizeDifficulty(opts?.difficulty)}.`,
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

function validateMCQ(questions, pages, opts) {
  if (!Array.isArray(questions)) return [];

  const validPageIds = new Set(pages.map(p => p.id));
  const pageTitleMap = new Map(pages.map(p => [p.id, p.title]));
  const subType = (opts && opts.mcqSubType === 'grammar') ? 'grammar' : 'content';

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
        subType,  // 'content' | 'grammar' — 학생앱·학원장 화면 표시 분기
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

function validateSubjective(questions, pages, opts) {
  if (!Array.isArray(questions)) return [];

  const pageById = new Map(pages.map(p => [p.id, p]));
  const mode = opts?.subjectiveMode === 'verbatim' ? 'verbatim' : 'paraphrase';

  // 페이지별 단어 Set 캐시 (소문자, 영문 단어만) — paraphrase 모드 매칭용
  const pageWordSets = new Map();
  // verbatim 모드 — 본문 전체를 정규화한 substring 매칭용
  const pageNormText = new Map();
  for (const p of pages) {
    const words = String(p.text || '').toLowerCase().split(/[^a-z0-9']+/).filter(w => w.length >= 2);
    pageWordSets.set(p.id, new Set(words));
    pageNormText.set(p.id, _normalizeForMatch(String(p.text || '')));
  }

  return questions
    .map(q => {
      if (!q || typeof q !== 'object') return null;

      const sentence = String(q.sentence || '').trim();
      if (!sentence || sentence.length < 8 || sentence.length > 500) return null;

      // 출처 페이지 결정: AI 가 알려준 sourcePageId 우선, 유효하지 않으면 첫 페이지 폴백
      let page = pageById.get(q.sourcePageId);
      if (!page) page = pages[0];
      if (!page) return null;

      if (mode === 'verbatim') {
        // verbatim 모드 — 본문 substring 정확 매칭. 못 찾으면 폐기 (AI 가 변형했음)
        const sentNorm = _normalizeForMatch(sentence);
        const hostText = pageNormText.get(page.id) || '';
        if (!hostText.includes(sentNorm)) {
          // 다른 페이지에서도 찾기 (sourcePageId 가 잘못 박힌 케이스)
          const hostPage = pages.find(p => (pageNormText.get(p.id) || '').includes(sentNorm));
          if (!hostPage) return null;
          page = hostPage;
        }
      } else {
        // paraphrase 모드 — 가벼운 단어 매칭 30%
        const sentenceWords = sentence.toLowerCase().split(/[^a-z0-9']+/).filter(w => w.length >= 2);
        if (sentenceWords.length > 0) {
          const pageWords = pageWordSets.get(page.id) || new Set();
          const matched = sentenceWords.filter(w => pageWords.has(w)).length;
          const ratio = matched / sentenceWords.length;
          if (ratio < 0.3) return null;
        }
      }

      const sampleAnswerKo = String(q.sampleAnswerKo || '').trim().slice(0, 500);
      const questionKo = String(q.questionKo || '위 문장을 우리말로 해석하시오.').trim();

      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      return {
        type: 'subjective',
        sentence,
        questionKo,
        sampleAnswerKo,
        explanation: String(q.explanation || '').trim().slice(0, 500),
        sourcePageId: page.id,
        sourcePageTitle: page.title || '',
        difficulty,
        // 세트/시험 표시용 — 각 문항이 어떤 모드로 생성됐는지
        subjectiveMode: mode,
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

      // homophones — 말하기 모드 채점에서만 사용. UI/인쇄/단어장에 노출 X.
      const homophones = Array.isArray(q.homophones)
        ? Array.from(new Set(
            q.homophones
              .map(h => String(h || '').toLowerCase().trim())
              .filter(h => h && h !== wordLower && h.length >= 2 && h.length <= 60)
          )).slice(0, 5)
        : [];

      return {
        type: 'vocab',
        word, meaning, example, exampleKo,
        homophones,
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
