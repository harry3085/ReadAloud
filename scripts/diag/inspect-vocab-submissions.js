// 학생이 입력한 답안(ans.input)과 정답(q.word)의 char 단위 비교
// → 한 글자만 mismatch 인 경우 hidden char/이상 키 입력 패턴 발견

const { getDb } = require('../lib/firebase-admin');

const TARGETS = ['on top of', 'in an orderly fashion'];

function dumpChars(s) {
  const parts = [];
  for (const ch of (s || '')) {
    const cp = ch.codePointAt(0);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    const display = cp === 0x20 ? '·' : (cp < 0x20 ? '?' : ch);
    parts.push(`${display}(U+${hex})`);
  }
  return parts.join(' ');
}

(async () => {
  const db = getDb();
  console.log('\n=== 학생 응시 답안 char 진단 ===\n');

  // default 학원의 vocab genTests
  const tsSnap = await db.collection('genTests')
    .where('academyId', '==', 'default')
    .get();

  let inspected = 0;

  for (const testDoc of tsSnap.docs) {
    const td = testDoc.data();
    if ((td.testMode || td.mode) !== 'vocab') continue;
    const questions = td.questions || [];

    // base questions 에 target 단어 있는지 빠르게 사전 필터
    const hasTargetInBase = questions.some(q =>
      typeof q.word === 'string' && TARGETS.includes(q.word.toLowerCase())
    );
    if (!hasTargetInBase) continue;

    // userCompleted 하위 컬렉션
    const compSnap = await testDoc.ref.collection('userCompleted').get();
    if (compSnap.empty) continue;

    console.log(`\n━━━ ${td.name || td.title} (id=${testDoc.id}) ━━━`);

    for (const compDoc of compSnap.docs) {
      const cd = compDoc.data();
      const answers = cd.answers || [];
      const compQuestions = cd.questions || questions;

      // 학생별 snapshot 에서 target 인덱스 다시 찾기 (셔플 반영)
      const targetIdxs = [];
      compQuestions.forEach((q, idx) => {
        if (typeof q?.word === 'string' && TARGETS.includes(q.word.toLowerCase())) {
          targetIdxs.push({ idx, word: q.word });
        }
      });

      for (const { idx, word } of targetIdxs) {
        const a = answers[idx];
        if (!a) continue;
        const q = compQuestions[idx];
        const target = String(q.word || '');
        const userInput = String(a.input || '');
        const userTrim = userInput.trim().toLowerCase();
        const targetTrim = target.trim().toLowerCase();
        const isCorrect = userTrim && userTrim === targetTrim;

        // mismatch 만 dump
        if (isCorrect) continue;
        if (!userInput) continue; // 미입력은 skip

        inspected++;
        console.log(`\n  👤 user=${compDoc.id} score=${cd.score} latestScore=${cd.latestScore}`);
        console.log(`     q[${idx}] target: ${JSON.stringify(target)} (len=${target.length})`);
        console.log(`     q[${idx}] target codes: ${dumpChars(target)}`);
        console.log(`     ans.input:  ${JSON.stringify(userInput)} (len=${userInput.length})`);
        console.log(`     input codes: ${dumpChars(userInput)}`);

        // per-position diff
        const len = Math.max(target.length, userInput.length);
        const diffs = [];
        for (let i = 0; i < len; i++) {
          const tc = target[i] ?? '';
          const uc = userInput[i] ?? '';
          if (tc.toLowerCase() !== uc.toLowerCase()) {
            const tcp = tc ? `U+${tc.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}` : 'EMPTY';
            const ucp = uc ? `U+${uc.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}` : 'EMPTY';
            diffs.push(`pos[${i}]: target="${tc}"(${tcp}) vs input="${uc}"(${ucp})`);
          }
        }
        if (diffs.length) {
          console.log(`     ⚠ 차이 ${diffs.length}곳:`);
          diffs.forEach(d => console.log(`        ${d}`));
        }
      }
    }
  }

  console.log(`\n\n=== 완료 (${inspected}건 mismatch dump) ===`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
