// 옛 vocab 시험/세트의 누락 동음이의어 일괄 채움 (2026-05-15)
// 대상:
//   - genTests (vocabOptions.format='speaking' 또는 'mixed' + questions 의 word 있음)
//   - genQuestionSets (sourceType='vocab')
// 누락 단어 (homophones not Array) 만 AI 호출 (Gemini generate-quiz mode='homophones-only')
//
// 사용:
//   node scripts/migrate/backfill-vocab-homophones.js                   # DRY-RUN
//   node scripts/migrate/backfill-vocab-homophones.js --apply
//   node scripts/migrate/backfill-vocab-homophones.js --tests-only      # genTests 만
//   node scripts/migrate/backfill-vocab-homophones.js --sets-only       # genQuestionSets 만
//   node scripts/migrate/backfill-vocab-homophones.js --testId=XXX      # 특정 시험만
//   node scripts/migrate/backfill-vocab-homophones.js --setId=XXX       # 특정 세트만

const { getDb } = require('../lib/firebase-admin');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

async function fetchHomophones(words) {
  if (!Array.isArray(words) || words.length === 0) return {};
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 미설정 — .env 또는 환경변수 확인');

  const prompt = `For each English word, list TRUE homophones (different word, same/near-identical pronunciation).
Strict criteria: must be a real different word with same sound. Examples: cereal/serial, reign/rein/rain, pair/pear, hi/high.
Exclude false positives: cat/cot (different vowel), mat/mate (different vowel length).

Return JSON ONLY:
{"results":[{"word":"<word>","homophones":["<other word>","..."]}, ...]}

Words: ${words.map(w => `"${w}"`).join(', ')}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const url = `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${d?.error?.message || ''}`);
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(text);
  const map = {};
  (parsed.results || []).forEach(r => {
    if (r.word) {
      const homo = (r.homophones || [])
        .map(s => String(s || '').trim())
        .filter(s => s && s.toLowerCase() !== r.word.toLowerCase())
        .slice(0, 5);
      map[r.word.toLowerCase()] = homo;
    }
  });
  return map;
}

async function processDoc(db, col, docId, dryRun) {
  const ref = db.doc(`${col}/${docId}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`  ${col}/${docId} — 없음`); return false; }
  const data = snap.data();
  const qs = data.questions || [];
  const missing = qs.filter(q => q && q.word && (q.type === 'vocab' || !q.type) && !Array.isArray(q.homophones));
  if (missing.length === 0) {
    console.log(`  ${col}/${docId} (${data.name || data.testName || '-'}) — 누락 없음`);
    return false;
  }
  console.log(`  ${col}/${docId} (${data.name || data.testName || '-'}) — 누락 ${missing.length}/${qs.length} 단어`);
  if (dryRun) return false;

  const words = [...new Set(missing.map(q => q.word))];
  console.log(`    AI 호출: [${words.join(', ')}]`);
  const map = await fetchHomophones(words);
  let filled = 0;
  qs.forEach(q => {
    if (q && q.word && (q.type === 'vocab' || !q.type) && !Array.isArray(q.homophones)) {
      const homo = map[q.word.toLowerCase()] || [];
      q.homophones = homo;
      if (homo.length) filled++;
    }
  });
  await ref.update({ questions: qs });
  console.log(`    ✓ 채움 ${filled}/${missing.length} 단어`);
  return true;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const testsOnly = process.argv.includes('--tests-only');
  const setsOnly = process.argv.includes('--sets-only');
  const testIdArg = process.argv.find(a => a.startsWith('--testId='))?.split('=')[1];
  const setIdArg = process.argv.find(a => a.startsWith('--setId='))?.split('=')[1];
  const db = getDb();

  console.log(`\n=== vocab homophones 백필 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  let updated = 0;

  // --testId / --setId 단독 케이스
  if (testIdArg) {
    if (await processDoc(db, 'genTests', testIdArg, !apply)) updated++;
  } else if (setIdArg) {
    if (await processDoc(db, 'genQuestionSets', setIdArg, !apply)) updated++;
  } else {
    // genQuestionSets (sourceType='vocab')
    if (!testsOnly) {
      console.log('[genQuestionSets] sourceType=vocab\n');
      const snap = await db.collection('genQuestionSets').where('sourceType', '==', 'vocab').get();
      console.log(`  ${snap.size}건 발견\n`);
      for (const d of snap.docs) {
        if (await processDoc(db, 'genQuestionSets', d.id, !apply)) updated++;
      }
    }

    // genTests (vocab + word 있는 questions)
    if (!setsOnly) {
      console.log('\n[genTests] testMode=vocab\n');
      const snap = await db.collection('genTests').where('testMode', '==', 'vocab').get();
      console.log(`  ${snap.size}건 발견\n`);
      for (const d of snap.docs) {
        if (await processDoc(db, 'genTests', d.id, !apply)) updated++;
      }
    }
  }

  console.log(`\n${apply ? '✓ 완료' : '(DRY-RUN — --apply 로 실제 적용)'}`);
  console.log(`업데이트${apply ? '됨' : ' 예정'}: ${updated}건\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
