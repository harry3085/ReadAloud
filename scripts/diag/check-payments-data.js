// payments 컬렉션 실태 — 정말 테스트 데이터만 있는지 확인
const { getDb } = require('../lib/firebase-admin');
(async () => {
  const db = getDb();
  const snap = await db.collection('payments').get();
  console.log(`\npayments 총 ${snap.size}건\n`);
  if (snap.size === 0) { console.log('비어있음 — 안전하게 삭제 가능 OR 컬렉션 자체 부재'); process.exit(0); }
  const byAcad = {}, byStatus = {};
  let oldestMs = Infinity, newestMs = 0;
  snap.forEach(d => {
    const data = d.data();
    byAcad[data.academyId || 'no-academyId'] = (byAcad[data.academyId || 'no-academyId'] || 0) + 1;
    byStatus[data.status || 'no-status'] = (byStatus[data.status || 'no-status'] || 0) + 1;
    const ms = data.createdAt?.toMillis?.() || 0;
    if (ms && ms < oldestMs) oldestMs = ms;
    if (ms && ms > newestMs) newestMs = ms;
  });
  console.log('학원별:', byAcad);
  console.log('상태별:', byStatus);
  if (oldestMs !== Infinity) console.log('가장 오래된:', new Date(oldestMs).toLocaleString());
  if (newestMs > 0) console.log('가장 최근:', new Date(newestMs).toLocaleString());
  console.log('\n샘플 3건:');
  snap.docs.slice(0, 3).forEach(d => console.log(' ', d.id, JSON.stringify(d.data())));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
