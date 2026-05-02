// scores 컬렉션의 잔존 testMode 필드 제거.
// 안전 조건: mode 와 testMode 가 동일한 경우만. 다르면 skip + 경고.
//
// 사용:
//   node scripts/migrate/remove-score-testmode.js          # DRY-RUN
//   node scripts/migrate/remove-score-testmode.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== scores.testMode 제거 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('scores').get();
  console.log(`scores 총 ${snap.size}건`);

  const targets = [];
  const conflicts = [];

  snap.forEach(d => {
    const data = d.data();
    if (!('testMode' in data)) return;
    if (data.mode === data.testMode) {
      targets.push(d.id);
    } else {
      conflicts.push({ id: d.id, mode: data.mode, testMode: data.testMode });
    }
  });

  console.log(`testMode 제거 대상: ${targets.length}`);
  console.log(`mode/testMode 불일치 (skip): ${conflicts.length}`);
  if (conflicts.length > 0) {
    console.log('  불일치 샘플:');
    conflicts.slice(0, 5).forEach(c => console.log(' ', c));
  }

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 적용)\n');
    process.exit(0);
  }

  // 500건 단위 batch
  let done = 0;
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    const batch = db.batch();
    chunk.forEach(id => batch.update(db.doc(`scores/${id}`), { testMode: FieldValue.delete() }));
    await batch.commit();
    done += chunk.length;
    console.log(`  ✓ ${done}/${targets.length}`);
  }

  console.log(`\n✅ ${done}건 testMode 제거 완료\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
