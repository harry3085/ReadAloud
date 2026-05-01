// 월별 카운터 일괄 리셋 (단발성).
//
// 배경: incrementUsage 의 이전 버전이 needsReset 시 자기 카운터만 1 로 리셋하고
// 다른 분류는 그대로 두던 버그. 이전 달 잔존값이 새 달 첫 호출 후에도 남아
// 학원장 AI 사용량 페이지가 잘못된 값 표시.
//
// 본 스크립트는 KST 기준 이번 달과 다른 lastResetAt 을 가진 학원의
// 월 카운터(6개)를 0 으로 리셋 + lastResetAt 갱신.
//
// 사용:
//   node scripts/migrate/reset-monthly-counters.js          # DRY-RUN
//   node scripts/migrate/reset-monthly-counters.js --apply  # 실제 적용
//
// 안전성: 멱등 (이미 이번 달이면 skip), 일별 카운터(activeStudentsCount 등)는 손대지 않음.

const { getDb } = require('../lib/firebase-admin');

const ALL_MONTHLY_COUNTERS = [
  'ocrCallsThisMonth',
  'cleanupCallsThisMonth',
  'generatorCallsThisMonth',
  'recordingCallsThisMonth',
  'growthReportCallsThisMonth',
];

function _currentYearMonthKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  const ymNow = _currentYearMonthKST();

  console.log(`\n=== reset-monthly-counters ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
  console.log(`현재 KST month: ${ymNow}\n`);

  const academies = await db.collection('academies').get();
  let touched = 0;
  let skipped = 0;

  for (const docSnap of academies.docs) {
    const data = docSnap.data();
    const usage = data.usage || {};
    const lastResetAt = usage.lastResetAt || null;

    if (lastResetAt === ymNow) {
      console.log(`  · ${docSnap.id.padEnd(15)} skip (이미 ${ymNow})`);
      skipped++;
      continue;
    }

    const update = { 'usage.lastResetAt': ymNow };
    const before = {};
    for (const c of ALL_MONTHLY_COUNTERS) {
      update[`usage.${c}`] = 0;
      before[c] = usage[c] || 0;
    }

    const beforeStr = ALL_MONTHLY_COUNTERS.map(c => `${c.replace('CallsThisMonth','').replace('ThisMonth','')}=${before[c]}`).join(' ');
    console.log(`  · ${docSnap.id.padEnd(15)} (${lastResetAt || '-'} → ${ymNow})  ${beforeStr}`);

    if (apply) {
      await docSnap.ref.update(update);
    }
    touched++;
  }

  console.log(`\n학원 ${academies.size}개 — 리셋 ${touched} / skip ${skipped}`);
  console.log(apply ? '\n✅ 완료\n' : '\n(DRY-RUN) 실제 적용은 --apply 추가.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
