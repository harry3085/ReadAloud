// 학원 branding 필드 백필 — 화이트라벨 시스템(2026-05-06) 도입
// 사용:
//   node scripts/migrate/backfill-branding.js          # DRY-RUN
//   node scripts/migrate/backfill-branding.js --apply  # 적용

const { getDb, getAdmin } = require('../lib/firebase-admin');

(async () => {
  const apply = process.argv.includes('--apply');
  getAdmin();
  const admin = require('firebase-admin');
  const db = getDb();

  console.log(`\n=== 학원 branding 백필 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('academies').get();
  console.log(`총 ${snap.size}개 학원\n`);

  let count = 0, skipped = 0;
  let batch = db.batch();

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.branding) {
      skipped++;
      console.log(`  - ${doc.id} (${d.name || '-'}): 이미 branding 있음, skip`);
      continue;
    }
    const branding = {
      presetId: 'coral',
      catchphrase: '',
      logoUrl: '',
      logo192Url: '',
      logo512Url: '',
      logoUploadedAt: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'system_migration_2026-05-06',
    };
    if (apply) {
      batch.update(doc.ref, { branding });
      count++;
      if (count % 400 === 0) { await batch.commit(); batch = db.batch(); }
    } else {
      count++;
    }
    console.log(`  ${apply ? '✓' : '·'} ${doc.id} (${d.name || '-'}): branding 백필`);
  }
  if (apply && count % 400 !== 0) await batch.commit();

  console.log(`\n${apply ? '✅' : '🔍'} ${count}개 ${apply ? '백필 완료' : '백필 예정'} / ${skipped}개 skip`);
  if (!apply) console.log('실제 적용은 --apply 추가\n');
})().catch(e => { console.error(e); process.exit(1); });
