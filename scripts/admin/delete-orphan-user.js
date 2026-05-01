// orphan 학생 (academyId 누락 + usernameLookup 없음) 완전 정리.
// Auth + users doc 모두 삭제. lookup 은 이미 없으면 skip.
//
// 사용:
//   node scripts/admin/delete-orphan-user.js <uid>          # DRY-RUN
//   node scripts/admin/delete-orphan-user.js <uid> --apply  # 실제 삭제

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');

(async () => {
  const uid = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!uid) {
    console.error('사용: node scripts/admin/delete-orphan-user.js <uid> [--apply]');
    process.exit(1);
  }

  const auth = getAuthAdmin();
  const db = getDb();

  console.log(`\n=== orphan 학생 정리 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
  console.log(`uid: ${uid}\n`);

  // 1. users doc 확인
  const userSnap = await db.doc(`users/${uid}`).get();
  if (userSnap.exists) {
    const u = userSnap.data();
    console.log(`users/${uid}: name=${u.name}, username=${u.username}, email=${u.email}, academyId=${u.academyId||'(없음)'}`);
  } else {
    console.log(`users/${uid}: (없음)`);
  }

  // 2. Auth 확인
  let authRecord = null;
  try {
    authRecord = await auth.getUser(uid);
    console.log(`Auth: email=${authRecord.email}, disabled=${authRecord.disabled}`);
  } catch (e) {
    console.log(`Auth: (없음) — ${e.code || e.message}`);
  }

  // 3. usernameLookup 확인 (username 기반)
  let lookupKey = null;
  if (userSnap.exists && userSnap.data().username) {
    lookupKey = String(userSnap.data().username).toLowerCase();
    const ld = await db.doc(`usernameLookup/${lookupKey}`).get();
    console.log(`usernameLookup/${lookupKey}: ${ld.exists ? JSON.stringify(ld.data()) : '(없음)'}`);
  }

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 삭제)');
    process.exit(0);
  }

  // 실제 삭제
  console.log('\n--- 삭제 진행 ---');
  if (authRecord) {
    await auth.deleteUser(uid);
    console.log(`✓ Auth 삭제`);
  }
  if (userSnap.exists) {
    await db.doc(`users/${uid}`).delete();
    console.log(`✓ users/${uid} 삭제`);
  }
  if (lookupKey) {
    const ld = await db.doc(`usernameLookup/${lookupKey}`).get();
    if (ld.exists) {
      await db.doc(`usernameLookup/${lookupKey}`).delete();
      console.log(`✓ usernameLookup/${lookupKey} 삭제`);
    }
  }

  console.log('\n✅ 정리 완료. 학원장 앱에서 재등록 가능.');
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
