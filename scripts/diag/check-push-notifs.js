// 특정 학원의 pushNotifications 와 userNotifications 상태 점검.
//
// 사용: node scripts/diag/check-push-notifs.js --academy raloud2

const { getDb } = require('../lib/firebase-admin');

function parseArgs() {
  const out = { academy: 'raloud2' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-z-]+)$/);
    if (m && args[i+1] !== undefined) { out[m[1]] = args[i+1]; i++; }
  }
  return out;
}

(async () => {
  const opts = parseArgs();
  const db = getDb();

  console.log(`\n=== ${opts.academy} 학원 pushNotifications 상태 ===\n`);

  // academyId 매칭 + null/missing 도 같이 보기 위해 전체 한 번 더 조회
  const filtered = await db.collection('pushNotifications')
    .where('academyId', '==', opts.academy).get();
  const all = await db.collection('pushNotifications').get();

  console.log(`총 doc: ${all.size}, academyId='${opts.academy}' 매칭: ${filtered.size}\n`);

  let withId = 0, missingId = 0, otherAcademy = 0;
  const noAcademyDocs = [];

  all.docs.forEach(d => {
    const data = d.data();
    const aid = data.academyId;
    if (aid === opts.academy) withId++;
    else if (aid == null || aid === '') {
      missingId++;
      noAcademyDocs.push({ id: d.id, title: data.title || '(no title)', date: data.date || '', target: data.target });
    } else otherAcademy++;
  });

  console.log(`├─ ${opts.academy}: ${withId}`);
  console.log(`├─ academyId 없음: ${missingId} ⚠️  ← 삭제 안 되는 원인 후보`);
  console.log(`└─ 다른 학원: ${otherAcademy}\n`);

  if (noAcademyDocs.length) {
    console.log('academyId 없는 문서들:');
    noAcademyDocs.slice(0, 10).forEach(d => {
      console.log(`  - ${d.id} | "${d.title}" | ${d.date} | target=${d.target}`);
    });
    if (noAcademyDocs.length > 10) console.log(`  ... +${noAcademyDocs.length-10}건`);
    console.log();
  }

  // userNotifications 도 같이 — pushId 없는 구버전 점검
  const unSnap = await db.collection('userNotifications').get();
  let unTotal = unSnap.size, unNoPushId = 0, unNoAcademy = 0;
  unSnap.docs.forEach(d => {
    const data = d.data();
    if (!data.pushId) unNoPushId++;
    if (!data.academyId) unNoAcademy++;
  });
  console.log(`userNotifications 전체: ${unTotal}`);
  console.log(`├─ pushId 없음 (cascade 매칭 불가): ${unNoPushId}`);
  console.log(`└─ academyId 없음: ${unNoAcademy}\n`);

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
