// academies.usage 에서 실제로 사용하지 않는 placeholder 카운터 두 개를 제거.
//
// 제거 대상:
//   - usage.mcqCallsThisMonth   — generate-quiz 는 'ai' 카운터로 들어가므로 별도 mcq 카운터 안 씀
//   - usage.storageBytes        — Storage 사용량 추적 코드 자체가 없음
//
// 보존:
//   - usage.activeStudentsCount      — api/createStudent.js 가 increment
//   - usage.aiCallsThisMonth         — api/_lib/quota.js 가 increment
//   - usage.recordingCallsThisMonth  — api/_lib/quota.js 가 increment
//   - usage.lastResetAt              — api/_lib/quota.js 가 월별 리셋 트리거로 사용
//
// 사용:
//   node scripts/migrate/remove-dead-usage-fields.js          # DRY-RUN
//   node scripts/migrate/remove-dead-usage-fields.js --apply  # 실제 삭제
//
// 멱등성: 이미 없으면 건드리지 않음.

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DEAD_FIELDS = ['mcqCallsThisMonth', 'storageBytes'];

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== remove-dead-usage-fields ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);
  console.log('제거 대상:', DEAD_FIELDS.join(', '));
  console.log();

  const snap = await db.collection('academies').get();
  let toUpdate = 0;
  let alreadyOk = 0;
  const updates = [];

  for (const doc of snap.docs) {
    const usage = doc.data().usage || {};
    const present = DEAD_FIELDS.filter(k => k in usage);
    if (present.length === 0) {
      alreadyOk++;
      console.log(`• ${doc.id.padEnd(16)}  alreadyOk`);
      continue;
    }
    toUpdate++;
    console.log(`• ${doc.id.padEnd(16)}  remove: ${present.join(', ')}`);
    const patch = {};
    for (const k of present) patch[`usage.${k}`] = FieldValue.delete();
    updates.push({ ref: doc.ref, patch });
  }

  if (apply && toUpdate > 0) {
    let batch = db.batch();
    let n = 0;
    for (const { ref, patch } of updates) {
      batch.update(ref, patch);
      n++;
      if (n >= 450) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n > 0) await batch.commit();
  }

  console.log(`\n─── 요약 ───`);
  console.log(`전체:        ${snap.size}`);
  console.log(`업데이트:    ${toUpdate}`);
  console.log(`이미 처리됨: ${alreadyOk}`);

  if (!apply) console.log(`\n(DRY-RUN) 실제로 쓰려면 --apply 추가.\n`);
  else console.log(`\n✅ 완료.\n`);

  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
