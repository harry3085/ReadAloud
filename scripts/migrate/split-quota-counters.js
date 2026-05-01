// academies.usage 의 5분류 카운터 백필 (T4).
//
// T2/T3 에서 quota.js 가 5분류로 분리됨 — academies/{id}.usage 에도 새 필드 4개 추가:
//   ocrCallsThisMonth, cleanupCallsThisMonth, generatorCallsThisMonth, growthReportCallsThisMonth
//
// 기존 필드는 그대로 유지:
//   - aiCallsThisMonth          (deprecated, 더 이상 +1 안 됨 — 별도 cleanup 시점에 제거)
//   - recordingCallsThisMonth   (그대로 사용)
//   - activeStudentsCount       (그대로 사용)
//   - lastResetAt               (그대로 사용)
//
// 사용:
//   node scripts/migrate/split-quota-counters.js          # DRY-RUN
//   node scripts/migrate/split-quota-counters.js --apply  # 실제 백필
//
// 안전성: 멱등 (이미 필드 있으면 skip), 기존 값 덮어쓰지 않음.

const { getDb } = require('../lib/firebase-admin');

const NEW_COUNTERS = [
  'ocrCallsThisMonth',
  'cleanupCallsThisMonth',
  'generatorCallsThisMonth',
  'growthReportCallsThisMonth',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== split-quota-counters ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const academies = await db.collection('academies').get();
  let touched = 0;
  let skipped = 0;

  for (const docSnap of academies.docs) {
    const data = docSnap.data();
    const usage = data.usage || {};

    const updates = {};
    for (const k of NEW_COUNTERS) {
      if (usage[k] === undefined) {
        updates[`usage.${k}`] = 0;
      }
    }

    if (Object.keys(updates).length === 0) {
      console.log(`  · ${docSnap.id.padEnd(15)} skip (이미 5분류 카운터 있음)`);
      skipped++;
      continue;
    }

    const addedKeys = Object.keys(updates).map(k => k.replace('usage.', '')).join(', ');
    console.log(`  · ${docSnap.id.padEnd(15)} +[${addedKeys}]`);

    if (apply) {
      await docSnap.ref.update(updates);
    }
    touched++;
  }

  console.log(`\n학원 ${academies.size}개 — 갱신 ${touched} / skip ${skipped}`);
  console.log(apply ? '\n✅ 완료\n' : '\n(DRY-RUN) 실제 적용은 --apply 추가.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
