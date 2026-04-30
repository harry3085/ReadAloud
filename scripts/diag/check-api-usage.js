// apiUsage 컬렉션 구조 빠른 진단

const { getDb } = require('../lib/firebase-admin');

async function main() {
  const db = getDb();
  const snap = await db.collection('apiUsage').limit(10).get();
  console.log(`\napiUsage 문서 ${snap.size}개 미리보기 (최대 10개):\n`);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(`- ${d.id}`);
    const json = JSON.stringify(data, (k, v) => {
      if (v && typeof v === 'object' && v._seconds !== undefined) {
        return new Date(v._seconds * 1000).toISOString();
      }
      return v;
    }, 2);
    console.log(`  ${json.replace(/\n/g, '\n  ')}\n`);
  });

  console.log('=== 오늘 날짜로 합계 (KST 기준) ===');
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const todaySnap = await db.collection('apiUsage').where('date', '==', today).get();
  let total = 0;
  todaySnap.forEach(d => { total += d.data().total || 0; });
  console.log(`오늘(${today}) apiUsage 문서: ${todaySnap.size}개, total 합계: ${total}\n`);

  process.exit(0);
}

main().catch(e => { console.error('[error]', e); process.exit(1); });
