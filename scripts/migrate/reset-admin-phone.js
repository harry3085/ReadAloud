// users.phone === 'admin' 학생 6명 phone 빈 문자열로 reset
// 2026-05-06 — 원인 미상의 placeholder 잔재 정리
// 사용:
//   node scripts/migrate/reset-admin-phone.js          # DRY-RUN
//   node scripts/migrate/reset-admin-phone.js --apply  # 적용

const { getDb, getAdmin } = require('../lib/firebase-admin');

(async () => {
  const apply = process.argv.includes('--apply');
  getAdmin();
  const admin = require('firebase-admin');
  const db = getDb();

  console.log(`\n=== users.phone='admin' 정리 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('users').where('role', '==', 'student').get();
  const targets = [];
  for (const d of snap.docs) {
    const u = d.data();
    if (typeof u.phone === 'string' && /^admin$/i.test(u.phone.trim())) {
      targets.push({ id: d.id, ref: d.ref, username: u.username, name: u.name, academy: u.academyId });
    }
  }

  if (targets.length === 0) {
    console.log('대상 없음. 종료.');
    return;
  }

  console.log(`대상 ${targets.length}명:\n`);
  for (const t of targets) {
    console.log(`  ${apply ? '✓' : '·'} [${t.academy}] ${t.username} (${t.name}) — phone: 'admin' → ''`);
  }

  if (apply) {
    let batch = db.batch();
    targets.forEach((t, i) => {
      batch.update(t.ref, {
        phone: '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if ((i + 1) % 400 === 0) {
        // commit & new batch (rare here)
      }
    });
    await batch.commit();
    console.log(`\n✅ ${targets.length}명 phone 필드 빈 문자열 reset 완료`);
  } else {
    console.log(`\n🔍 DRY-RUN. 실제 적용은 --apply 추가\n`);
  }
})().catch(e => { console.error(e); process.exit(1); });
