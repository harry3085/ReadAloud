// 말하기 시험 1건의 userCompleted 구조 dump (디버깅용)
const { getDb } = require('../lib/firebase-admin');

(async () => {
  const db = getDb();
  const testsSnap = await db.collection('genTests').where('testMode', '==', 'vocab').get();
  const speaking = testsSnap.docs.filter(d => d.data().vocabOptions?.format === 'speaking');
  if (!speaking.length) { console.log('말하기 시험 없음'); process.exit(0); }

  for (const t of speaking) {
    console.log('\n시험:', t.id, t.data().name, '|', t.data().academyId);
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    console.log('  응시자:', ucSnap.size);
    ucSnap.docs.slice(0, 2).forEach(uc => {
      const d = uc.data();
      console.log('\n  --- uid', uc.id, ', name:', d.userName, '---');
      console.log('  score:', d.score, 'passed:', d.passed, 'latestScore:', d.latestScore, 'latestPassed:', d.latestPassed);
      console.log('  questions 길이:', (d.questions || []).length);
      console.log('  answers 길이:', (d.answers || []).length);
      if (d.answers?.[0]) {
        console.log('  answers[0]:', JSON.stringify(d.answers[0]));
      }
      if (d.questions?.[0]) {
        console.log('  questions[0]:', JSON.stringify(d.questions[0]).slice(0, 200));
      }
    });
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
