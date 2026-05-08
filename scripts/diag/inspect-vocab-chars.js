// 단어 스펠링 채점 오류 진단 — q.word 내 hidden character 검출
//
// 사용 사례:
//   - 정답을 입력했는데 알파벳 한 개가 오답 처리됨
//   - default 학원, '26마더텅 중 1 ch9 Words' 의 'on top of' / 'in an orderly fashion'
//
// 출력:
//   - 두 단어가 들어있는 모든 genQuestionSets / genTests 문서 검색
//   - 각 문자의 codePoint 16진수 출력
//   - 일반 ASCII (U+0020 space, U+0027 ', U+002D -, U+0061~0x7A 영소문자) 외 발견 시 ⚠ 표시

const { getDb } = require('../lib/firebase-admin');

const TARGETS = ['on top of', 'in an orderly fashion'];

// 일반 ASCII range — 이 외 char 가 나오면 의심
const ASCII_OK = (cp) => (
  cp === 0x20 ||                  // space
  cp === 0x27 ||                  // straight apostrophe
  cp === 0x2D ||                  // hyphen-minus
  (cp >= 0x41 && cp <= 0x5A) ||   // A-Z
  (cp >= 0x61 && cp <= 0x7A)      // a-z
);

function dumpChars(s) {
  const parts = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    const flag = ASCII_OK(cp) ? '' : ' ⚠';
    const display = cp === 0x20 ? '·' : (cp < 0x20 || cp === 0x7F ? '?' : ch);
    parts.push(`${display}(U+${hex}${flag})`);
  }
  return parts.join(' ');
}

function loose(s) {
  // 비교용 — visible 만 비교
  return String(s || '').toLowerCase();
}

(async () => {
  const db = getDb();
  console.log('\n=== 단어 스펠링 hidden char 진단 ===\n');
  console.log('타겟:', TARGETS.map(t => JSON.stringify(t)).join(', '));
  console.log();

  for (const target of TARGETS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔎 "${target}" (length ${target.length})`);
    console.log(`   타겟 자체 codes: ${dumpChars(target)}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // 1) genQuestionSets
    const qsSnap = await db.collection('genQuestionSets').get();
    let foundQs = 0;
    for (const doc of qsSnap.docs) {
      const d = doc.data();
      const questions = d.questions || [];
      questions.forEach((q, idx) => {
        if (typeof q.word !== 'string') return;
        if (loose(q.word) !== loose(target)) return;
        foundQs++;
        const codes = dumpChars(q.word);
        const exact = q.word === target;
        console.log(`\n📋 genQuestionSets / ${d.name} (id=${doc.id})`);
        console.log(`   academy=${d.academyId} sourceType=${d.sourceType}`);
        console.log(`   q[${idx}].word: ${JSON.stringify(q.word)} (len=${q.word.length}) ${exact ? '✓ exact' : '⚠ NOT exact'}`);
        console.log(`   codes: ${codes}`);
        if (q.meaning) console.log(`   meaning: ${JSON.stringify(q.meaning)}`);
      });
    }
    if (foundQs === 0) console.log(`\n   genQuestionSets: 매칭 없음`);

    // 2) genTests
    const tsSnap = await db.collection('genTests').get();
    let foundTs = 0;
    for (const doc of tsSnap.docs) {
      const d = doc.data();
      const questions = d.questions || [];
      questions.forEach((q, idx) => {
        if (typeof q.word !== 'string') return;
        if (loose(q.word) !== loose(target)) return;
        foundTs++;
        const codes = dumpChars(q.word);
        const exact = q.word === target;
        const dateStr = d.createdAt?.toDate?.().toISOString()?.slice(0, 10) || '?';
        console.log(`\n📝 genTests / ${d.name || d.title} (id=${doc.id})`);
        console.log(`   academy=${d.academyId} testMode=${d.testMode || d.mode} createdAt=${dateStr}`);
        console.log(`   q[${idx}].word: ${JSON.stringify(q.word)} (len=${q.word.length}) ${exact ? '✓ exact' : '⚠ NOT exact'}`);
        console.log(`   codes: ${codes}`);
        if (q.meaning) console.log(`   meaning: ${JSON.stringify(q.meaning)}`);
      });
    }
    if (foundTs === 0) console.log(`\n   genTests: 매칭 없음`);
  }

  console.log('\n\n=== 완료 ===');
  console.log('범례: · = U+0020 space / ⚠ = ASCII 외 (NBSP/zero-width 등 의심)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
