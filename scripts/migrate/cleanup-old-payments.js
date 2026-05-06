// 기존 payments 컬렉션 전체 삭제 (테스트 데이터)
// billings 신규 컬렉션으로 교체 작업 (2026-05-02 결제 관리 v2)
//
// 사용:
//   node scripts/migrate/cleanup-old-payments.js          # DRY-RUN
//   node scripts/migrate/cleanup-old-payments.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== payments 컬렉션 정리 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('payments').get();
  console.log(`총 ${snap.size}건 발견`);

  if (snap.size === 0) {
    console.log('비어있음. 종료.');
    process.exit(0);
  }

  snap.docs.forEach(d => {
    const data = d.data();
    console.log(`  ${d.id}: ${data.userName || '?'} (${data.academyId}) · ${data.title} · ${data.amount?.toLocaleString() || 0}원 · ${data.status}`);
  });

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 삭제)\n');
    process.exit(0);
  }

  let deleted = 0;
  for (let i = 0; i < snap.size; i += 400) {
    const chunk = snap.docs.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  console.log(`\n✅ ${deleted}건 삭제 완료\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
