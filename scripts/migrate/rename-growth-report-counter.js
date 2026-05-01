// 학원별 usage.growthReportThisMonth → growthReportCallsThisMonth 명명 일관화.
// 다른 4개 (ocr/cleanup/generator/recording) 모두 'XCallsThisMonth' 형식인데
// growth-report 만 'growthReportThisMonth' 로 다름 → 통일.
//
// 사용:
//   node scripts/migrate/rename-growth-report-counter.js          # DRY-RUN
//   node scripts/migrate/rename-growth-report-counter.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== rename growthReportThisMonth → growthReportCallsThisMonth ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('academies').get();
  console.log(`학원 ${snap.size}곳 발견\n`);

  const targets = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const usage = data.usage || {};
    const oldVal = usage.growthReportThisMonth;
    const newVal = usage.growthReportCallsThisMonth;
    targets.push({
      id: d.id,
      name: data.name || '(이름 없음)',
      oldVal: oldVal,
      newVal: newVal,
      hasOld: 'growthReportThisMonth' in usage,
      hasNew: 'growthReportCallsThisMonth' in usage,
    });
  });

  targets.forEach(t => {
    const status = t.hasOld
      ? (t.hasNew ? '⚠ 둘 다 있음' : '→ rename 대상')
      : (t.hasNew ? '✓ 이미 rename 됨' : '(필드 없음)');
    console.log(`  ${t.id} (${t.name}): old=${t.oldVal ?? '∅'} / new=${t.newVal ?? '∅'} ${status}`);
  });

  const toRename = targets.filter(t => t.hasOld);
  console.log(`\nrename 대상: ${toRename.length}개`);

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 적용)\n');
    process.exit(0);
  }

  for (const t of toRename) {
    // 옛 값 + 신 값 합산 (중복 카운트 방지)
    const summed = (t.oldVal || 0) + (t.newVal || 0);
    await db.doc(`academies/${t.id}`).update({
      'usage.growthReportCallsThisMonth': summed,
      'usage.growthReportThisMonth': FieldValue.delete(),
    });
    console.log(`  ✓ ${t.id}: growthReportCallsThisMonth = ${summed} (옛 + 신 합산)`);
  }

  console.log(`\n✅ ${toRename.length}개 학원 rename 완료\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
