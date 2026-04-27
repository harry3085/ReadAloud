// apiUsage 컬렉션을 학원별 키로 이전.
//   기존: apiUsage/{YYYY-MM-DD}                  (글로벌 — academyId 필드 없음)
//   신규: apiUsage/{academyId}_{YYYY-MM-DD}      (학원별 + academyId 필드)
//
// 옛 글로벌 데이터는 default 학원으로 간주 (멀티테넌시 전 데이터).
//
// 사용:
//   node scripts/migrate/relocate-api-usage.js          # DRY-RUN
//   node scripts/migrate/relocate-api-usage.js --apply  # 실제 이전

const { getDb } = require('../lib/firebase-admin');

const DEFAULT_ACADEMY_ID = 'default';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== relocate-api-usage ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('apiUsage').get();
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

  const toRelocate = [];
  const alreadyNew = [];
  for (const docSnap of snap.docs) {
    const id = docSnap.id;
    if (dateOnlyPattern.test(id)) {
      toRelocate.push({ oldId: id, newId: `${DEFAULT_ACADEMY_ID}_${id}`, data: docSnap.data() });
    } else {
      alreadyNew.push(id);
    }
  }

  console.log(`총 문서: ${snap.size}`);
  console.log(`옛 글로벌 (이전 대상): ${toRelocate.length}`);
  console.log(`이미 신규 형식: ${alreadyNew.length}\n`);

  if (toRelocate.length === 0) { console.log('✅ 이전할 문서 없음.\n'); process.exit(0); }

  console.log('이전 대상 (처음 5개):');
  for (const r of toRelocate.slice(0, 5)) {
    console.log(`  ${r.oldId} → ${r.newId}  total=${r.data.total || 0}`);
  }

  if (!apply) { console.log(`\n(DRY-RUN) 실제 이전은 --apply 추가.\n`); process.exit(0); }

  console.log(`\n이전 중...`);
  let batch = db.batch();
  let inBatch = 0, done = 0;
  for (const r of toRelocate) {
    const newRef = db.collection('apiUsage').doc(r.newId);
    const oldRef = db.collection('apiUsage').doc(r.oldId);
    batch.set(newRef, { ...r.data, academyId: DEFAULT_ACADEMY_ID, date: r.oldId });
    batch.delete(oldRef);
    inBatch += 2;
    if (inBatch >= 450) {
      await batch.commit();
      done += inBatch / 2;
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) { await batch.commit(); done += inBatch / 2; }

  console.log(`\n✅ 완료: ${done}/${toRelocate.length} 건 이전됨\n`);
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
