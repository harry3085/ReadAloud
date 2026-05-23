// 옛 vocab 시험/세트의 말하기 출제 데이터 일괄 백필 (2026-05-23)
//
// 채울 필드 (서버 HOMOPHONES_PROMPT 4필드 동시 생성):
//   - homophones      : 동음이의어 (이미 채워진 단어는 skip)
//   - speakingKoPron  : 한글 발음표기 (2차 ko-KR STT 비교용)
//   - speakingSent    : 영어 빈칸 문장 (3차 sentence-reading)
//   - speakingSentKo  : 한글 해석 ([대괄호] 로 목표 부분 표시)
//
// 대상:
//   - genTests (testMode='vocab' + questions 의 word 있음)
//   - genQuestionSets (sourceType='vocab')
//   3필드(koPron/sent/sentKo) 중 하나라도 누락된 단어 → AI 호출 대상
//
// 사용:
//   node scripts/migrate/backfill-vocab-speaking-data.js                   # DRY-RUN
//   node scripts/migrate/backfill-vocab-speaking-data.js --apply
//   node scripts/migrate/backfill-vocab-speaking-data.js --tests-only      # genTests 만
//   node scripts/migrate/backfill-vocab-speaking-data.js --sets-only       # genQuestionSets 만
//   node scripts/migrate/backfill-vocab-speaking-data.js --testId=XXX      # 특정 시험만
//   node scripts/migrate/backfill-vocab-speaking-data.js --setId=XXX       # 특정 세트만
//   node scripts/migrate/backfill-vocab-speaking-data.js --academyId=XXX   # 특정 학원만
//   node scripts/migrate/backfill-vocab-speaking-data.js --speaking-only   # vocabOptions.format='speaking' 시험만 (genTests)

const { getDb } = require('../lib/firebase-admin');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
// 서버 폴백 체인과 동일 순서 (작업규칙 8, 2026-05-18 재배치)
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

// 서버 api/generate-quiz.js HOMOPHONES_PROMPT 와 동일 (4필드 동시 생성)
// 동기화: 서버 변경 시 이 프롬프트도 같이 변경 필요
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
A natural Korean transliteration that a Korean student would write down after hearing the word — used as ground truth for matching ko-KR speech recognition output.

RULES:
1. Use only Korean hangul + spaces. NO English letters, NO numbers, NO punctuation.
2. Match the conventional Korean transliteration used in Korean schools/dictionaries.
   Examples: right → 라이트, cereal → 시리얼, ought to → 오트 투, grayish-brown → 그레이시 브라운, vegetable → 베지터블, squirt → 스쿼트.
3. Multi-word phrases: separate each word with a single space.
4. NEVER leave empty.

═══ FIELD 3: sentence (English example sentence) ═══
A short English sentence containing the target word/phrase, used for the 3rd-attempt sentence-reading mode.

RULES:
1. Length: 5–10 words total (short, easy to read aloud).
2. The target word MUST appear EXACTLY ONCE, matching the input form (case-insensitive, but keep lowercase unless the target is a proper noun).
3. Place the target word in the MIDDLE of the sentence when possible.
4. The OTHER words must be from the most common 500–1000 English words (CEFR A1 level).
5. Use only standard letters (a-z, A-Z), spaces, apostrophe ('), and a single trailing period or question mark. NO commas, NO quotes.
6. NEVER leave empty.

═══ FIELD 4: sentenceKo (Korean translation of the sentence) ═══
A natural Korean translation of the sentence above, with the part that corresponds to the target word wrapped in [square brackets].

RULES:
1. Translate the WHOLE sentence naturally into Korean.
2. Wrap the portion that translates the target word/phrase in [square brackets]. EXACTLY ONE pair per sentence.
3. Use only Korean hangul, basic punctuation (. ? ,) and the [] brackets. NO English letters.
4. NEVER leave empty.

═══ OUTPUT ═══
Output ONLY a valid JSON object (no markdown, no prose):
{
  "results": [
    { "word": "cereal", "homophones": ["serial"], "koPron": "시리얼", "sentence": "I eat cereal every morning.", "sentenceKo": "나는 매일 아침 [시리얼]을 먹는다." }
  ]
}

The "results" array must include EVERY input word, in the same order, with ALL FOUR fields populated.`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isTransient = (status) => status === 503 || status === 429;

async function callGemini(model, prompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { role: 'system', parts: [{ text: prompt }] },
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Gemini ${r.status}: ${d?.error?.message || ''}`);
    err.status = r.status;
    throw err;
  }
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

async function fetchSpeakingData(words) {
  if (!Array.isArray(words) || words.length === 0) return {};
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 미설정 — .env 또는 환경변수 확인');

  const userPrompt = `Generate speaking-test data for each of these ${words.length} English words/phrases:

${words.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Output ONLY the JSON object as specified.`;

  let rawText = null, lastError = null;
  outer:
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        rawText = await callGemini(model, HOMOPHONES_PROMPT, userPrompt);
        break outer;
      } catch (e) {
        lastError = e;
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404 && !isTransient(e.status)) {
          continue outer;  // 다음 모델로
        }
        if (isTransient(e.status) && attempt === 0) { await sleep(800); continue; }
        continue outer;
      }
    }
  }
  if (!rawText) throw lastError || new Error('All Gemini models failed');

  const parsed = JSON.parse(rawText);
  const map = {};

  for (const r of (parsed.results || [])) {
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

    // koPron — 한글만
    let koPron = String(r.koPron || '').trim();
    if (koPron && !/^[가-힣\s]+$/.test(koPron)) {
      koPron = koPron.replace(/[^가-힣\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    // sentence — 4~12단어 + 목표 단어 포함
    let sentence = String(r.sentence || '').trim();
    if (sentence) {
      const cleanedSent = sentence.replace(/[^a-zA-Z'\s\-.?]/g, '').replace(/\s+/g, ' ').trim();
      const wordCount = cleanedSent.split(/\s+/).filter(Boolean).length;
      const targetRe = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (wordCount >= 4 && wordCount <= 12 && targetRe.test(cleanedSent)) {
        sentence = cleanedSent;
      } else {
        sentence = '';
      }
    }

    // sentenceKo — 한글 + [대괄호] 1쌍
    let sentenceKo = String(r.sentenceKo || '').trim();
    if (sentenceKo) {
      const hasHangul = /[가-힣]/.test(sentenceKo);
      const openCount = (sentenceKo.match(/\[/g) || []).length;
      const closeCount = (sentenceKo.match(/\]/g) || []).length;
      const hasBracket = openCount === 1 && closeCount === 1 && sentenceKo.indexOf('[') < sentenceKo.indexOf(']');
      const hasEnglish = /[a-zA-Z]/.test(sentenceKo);
      if (!hasHangul || !hasBracket || hasEnglish) sentenceKo = '';
    }

    map[w] = { homophones: cleanedHomos, koPron, sentence, sentenceKo };
  }
  return map;
}

function isVocabQ(q) {
  return q && q.word && (q.type === 'vocab' || !q.type);
}
function isMissing(q) {
  return isVocabQ(q) && (
    !Array.isArray(q.homophones) ||
    !q.speakingKoPron ||
    !q.speakingSent ||
    !q.speakingSentKo
  );
}

async function processDoc(db, col, docId, dryRun) {
  const ref = db.doc(`${col}/${docId}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`  ${col}/${docId} — 없음`); return false; }
  const data = snap.data();
  const qs = data.questions || [];
  const missing = qs.filter(isMissing);
  if (missing.length === 0) {
    console.log(`  ${col}/${docId} (${data.name || data.testName || '-'}) — 누락 없음`);
    return false;
  }
  // 누락 필드 종류별 카운트 (DRY-RUN 분석용)
  const noHomo = missing.filter(q => !Array.isArray(q.homophones)).length;
  const noKoPron = missing.filter(q => !q.speakingKoPron).length;
  const noSent = missing.filter(q => !q.speakingSent).length;
  const noSentKo = missing.filter(q => !q.speakingSentKo).length;
  console.log(`  ${col}/${docId} (${data.name || data.testName || '-'}) — 누락 ${missing.length}/${qs.length} 단어 [homo:${noHomo} koPron:${noKoPron} sent:${noSent} sentKo:${noSentKo}]`);
  if (dryRun) return true;  // DRY-RUN 도 대상 카운트는 잡음

  const words = [...new Set(missing.map(q => q.word))];
  console.log(`    AI 호출: ${words.length}단어 [${words.slice(0, 8).join(', ')}${words.length > 8 ? ' ...' : ''}]`);
  const map = await fetchSpeakingData(words);
  let filledHomo = 0, filledKoPron = 0, filledSent = 0, filledSentKo = 0;
  qs.forEach(q => {
    if (!isMissing(q)) return;
    const m = map[q.word.toLowerCase()] || {};
    if (!Array.isArray(q.homophones)) { q.homophones = m.homophones || []; if (q.homophones.length) filledHomo++; }
    if (!q.speakingKoPron && m.koPron) { q.speakingKoPron = m.koPron; filledKoPron++; }
    if (!q.speakingSent && m.sentence) { q.speakingSent = m.sentence; filledSent++; }
    if (!q.speakingSentKo && m.sentenceKo) { q.speakingSentKo = m.sentenceKo; filledSentKo++; }
  });
  await ref.update({ questions: qs });
  console.log(`    ✓ 채움 homo:${filledHomo} koPron:${filledKoPron} sent:${filledSent} sentKo:${filledSentKo}`);
  // AI rate limit 부드럽게 — 시험 간 200ms 대기
  await sleep(200);
  return true;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const testsOnly = process.argv.includes('--tests-only');
  const setsOnly = process.argv.includes('--sets-only');
  const speakingOnly = process.argv.includes('--speaking-only');
  const testIdArg = process.argv.find(a => a.startsWith('--testId='))?.split('=')[1];
  const setIdArg = process.argv.find(a => a.startsWith('--setId='))?.split('=')[1];
  const academyIdArg = process.argv.find(a => a.startsWith('--academyId='))?.split('=')[1];
  const db = getDb();

  console.log(`\n=== vocab 말하기 데이터 백필 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
  if (academyIdArg) console.log(`학원: ${academyIdArg}`);
  if (speakingOnly) console.log(`필터: vocabOptions.format='speaking' 만 (genTests)`);
  console.log('');

  let updated = 0, totalMissingWords = 0;

  if (testIdArg) {
    if (await processDoc(db, 'genTests', testIdArg, !apply)) updated++;
  } else if (setIdArg) {
    if (await processDoc(db, 'genQuestionSets', setIdArg, !apply)) updated++;
  } else {
    // genQuestionSets (sourceType='vocab')
    if (!testsOnly) {
      console.log('[genQuestionSets] sourceType=vocab' + (academyIdArg ? ` + academyId=${academyIdArg}` : '') + '\n');
      let q = db.collection('genQuestionSets').where('sourceType', '==', 'vocab');
      if (academyIdArg) q = q.where('academyId', '==', academyIdArg);
      const snap = await q.get();
      console.log(`  ${snap.size}건 발견\n`);
      for (const d of snap.docs) {
        if (await processDoc(db, 'genQuestionSets', d.id, !apply)) updated++;
      }
    }

    // genTests (testMode=vocab)
    if (!setsOnly) {
      console.log('\n[genTests] testMode=vocab' + (academyIdArg ? ` + academyId=${academyIdArg}` : '') + (speakingOnly ? ` + vocabOptions.format=speaking` : '') + '\n');
      let q = db.collection('genTests').where('testMode', '==', 'vocab');
      if (academyIdArg) q = q.where('academyId', '==', academyIdArg);
      const snap = await q.get();
      console.log(`  ${snap.size}건 발견\n`);
      for (const d of snap.docs) {
        if (speakingOnly) {
          const fmt = d.data()?.vocabOptions?.format;
          if (fmt !== 'speaking') continue;
        }
        if (await processDoc(db, 'genTests', d.id, !apply)) updated++;
      }
    }
  }

  console.log(`\n${apply ? '✓ 완료' : '(DRY-RUN — --apply 로 실제 적용)'}`);
  console.log(`업데이트${apply ? '됨' : ' 예정'}: ${updated}건\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
