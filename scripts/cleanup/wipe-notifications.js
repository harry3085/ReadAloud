// pushNotifications + userNotifications 일괄 삭제 (관리자 SDK — Rules 우회).
//
// 옛 테스트 데이터 정리용. 새로 발송하는 알림은 영향 없음.
//
// 사용:
//   node scripts/cleanup/wipe-notifications.js                        # DRY-RUN, 전체
//   node scripts/cleanup/wipe-notifications.js --academy raloud2      # DRY-RUN, raloud2 만
//   node scripts/cleanup/wipe-notifications.js --apply                # 전체 학원 삭제
//   node scripts/cleanup/wipe-notifications.js --apply --academy raloud2  # raloud2 만

const { getDb } = require('../lib/firebase-admin');

function parseArgs() {
  const out = { apply: false, academy: null };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') out.apply = true;
    else if (args[i] === '--academy' && args[i+1]) { out.academy = args[i+1]; i++; }
  }
  return out;
}

async function deleteCollection(db, collName, academyFilter, apply) {
  let q = db.collection(collName);
  if (academyFilter) q = q.where('academyId', '==', academyFilter);
  const snap = await q.get();

  console.log(`${collName}: ${snap.size}건${academyFilter?` (academyId=${academyFilter})`:' (전체)'}`);

  if (snap.empty) return 0;

  if (apply) {
    // batch (500건 한도)
    const chunks = [];
    for (let i = 0; i < snap.docs.length; i += 400) chunks.push(snap.docs.slice(i, i + 400));
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    console.log(`  ✓ 삭제 완료`);
  }
  return snap.size;
}

(async () => {
  const opts = parseArgs();
  const db = getDb();

  console.log(`\n=== wipe-notifications ${opts.apply ? '(APPLY ⚠️)' : '(DRY-RUN)'} ===`);
  console.log(`범위: ${opts.academy ? `학원 ${opts.academy} 만` : '전체 학원'}\n`);

  const pn = await deleteCollection(db, 'pushNotifications', opts.academy, opts.apply);
  const un = await deleteCollection(db, 'userNotifications', opts.academy, opts.apply);

  console.log(`\n총 ${pn + un}건 ${opts.apply ? '삭제됨' : '대상'}`);
  if (!opts.apply) console.log('(DRY-RUN — 실제 삭제는 --apply 추가)\n');
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
