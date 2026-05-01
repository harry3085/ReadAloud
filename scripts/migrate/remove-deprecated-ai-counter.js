// academies.usage.aiCallsThisMonth 필드 제거 (deprecated cleanup).
//
// 배경: T2/T3 (5분류 분리) 후 quota.js 가 더 이상 aiCallsThisMonth 를 +1 하지 않음.
// 다만 옛 학원 doc 에 0 또는 잔존 값이 박혀있어 super 앱 / 학원장 앱에 stale.
// 본 스크립트가 모든 학원의 usage.aiCallsThisMonth 필드 자체를 FieldValue.delete() 로 제거.
//
// 사용:
//   node scripts/migrate/remove-deprecated-ai-counter.js          # DRY-RUN
//   node scripts/migrate/remove-deprecated-ai-counter.js --apply  # 실제 제거
//
// 안전성: 멱등 (이미 없으면 skip), 다른 카운터·필드는 손대지 않음.

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== remove-deprecated-ai-counter ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('academies').get();
  let touched = 0, skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const usage = data.usage || {};
    if (usage.aiCallsThisMonth === undefined) {
      console.log(`  · ${docSnap.id.padEnd(15)} skip (이미 없음)`);
      skipped++;
      continue;
    }
    console.log(`  · ${docSnap.id.padEnd(15)} aiCallsThisMonth=${usage.aiCallsThisMonth} → 제거`);
    if (apply) {
      await docSnap.ref.update({ 'usage.aiCallsThisMonth': FieldValue.delete() });
    }
    touched++;
  }

  console.log(`\n학원 ${snap.size}개 — 제거 ${touched} / skip ${skipped}`);
  console.log(apply ? '\n✅ 완료\n' : '\n(DRY-RUN) 실제 적용은 --apply 추가.\n');
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
