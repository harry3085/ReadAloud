// 서버에 남은 ScoreSnap 기록 목록(읽기 전용): 세션·형식·학생 수·사진 유무
const { getDb } = require('../lib/firebase-admin');
(async () => {
  const db = getDb();
  const all = await db.collection('scoresnapSessions').get();
  const sess = all.docs.filter(d => !d.data().kind);
  for (const sd of sess) {
    const s = sd.data();
    const key = (await sd.ref.collection('key').doc('answerKey').get()).data() || {};
    const ak = key.answerKey || {};
    const st = await sd.ref.collection('students').get();
    const withImg = st.docs.filter(d => d.data().imagePath).length;
    const models = [...new Set(st.docs.map(d => (d.data().result || {}).model).filter(Boolean))].join(',');
    console.log(sd.id, '|', s.testName, '| layout', ak.layout || '-', '| 문항', (ak.questions || []).length, '| 학생', st.size, '사진', withImg, '| 모델', models, '| keyImg', key.keyImagePath ? 'Y' : 'N');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
