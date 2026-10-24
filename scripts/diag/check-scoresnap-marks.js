// ScoreSnap 기록의 마킹(V) 상태 점검 — 읽기 전용. 사용: node scripts/diag/check-scoresnap-marks.js "<시험이름 일부>"
const { getDb } = require('../lib/firebase-admin');
const Q = process.argv[2] || 'Brick';
(async () => {
  const db = getDb();
  const ss = await db.collection('scoresnapSessions').where('kind', '==', null).get().catch(() => null);
  const all = await db.collection('scoresnapSessions').get();
  const sess = all.docs.filter(d => !d.data().kind && String(d.data().testName || '').includes(Q));
  for (const sd of sess) {
    const s = sd.data();
    console.log('='.repeat(70)); console.log(sd.id, s.testName, 'Q', s.questionCount, '학생', s.studentCount);
    const key = (await sd.ref.collection('key').doc('answerKey').get()).data() || {};
    console.log('정답지 layout', key.answerKey && key.answerKey.layout, '문항', (key.answerKey && key.answerKey.questions || []).length);
    const st = await sd.ref.collection('students').get();
    for (const d of st.docs) {
      const x = d.data(); const r = x.result; if (!r) { console.log(' -', d.id, x.status); continue; }
      const wrong = (r.answers || []).filter(a => !a.isCorrect).map(a => a.no);
      const p = r.markPos || {};
      const nums = Object.keys(p.nums || {}).map(Number).sort((a, b) => a - b);
      const found = wrong.filter(n => (p.nums || {})[n]);
      console.log(` - ${r.studentName || '(이름없음)'} ${r.correctCount}/${r.totalQuestions} | 틀림 ${wrong.length}: [${wrong.join(',')}] | markPos v${p.v} 번호위치 ${nums.length}개 | 틀린것 위치있음 ${found.length}/${wrong.length} | markPath ${x.markPath ? 'Y' : 'N'} missing ${x.markMissing}`);
      if (nums.length) console.log('    위치 있는 번호:', nums.join(','));
    }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
