// Firestore users 문서가 있지만 Firebase Auth 계정이 없는 orphan 정리.
//
// 반대 방향 (Auth 만 있고 Firestore 없음) 은 cleanup:auth-orphans 사용.
//
// 사용:
//   node scripts/cleanup/firestore-orphans.js          # DRY-RUN
//   node scripts/cleanup/firestore-orphans.js --apply  # 실제 삭제
//
// 동작:
//   1. users 컬렉션 전체 스캔
//   2. 각 uid 로 Auth.getUser 시도 → user-not-found 면 orphan
//   3. apply 시: users 문서 + usernameLookup 동반 삭제
//   4. 점수/시험 등 종속 데이터는 건드리지 않음 (uid 참조만 남음)

const { getDb, getAuthAdmin } = require('../lib/firebase-admin');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== firestore-orphans ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('users').get();
  const orphans = [];

  for (const docSnap of snap.docs) {
    const uid = docSnap.id;
    const data = docSnap.data();
    try {
      await auth.getUser(uid);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        orphans.push({ uid, data });
      }
    }
  }

  console.log(`총 users: ${snap.size}`);
  console.log(`Firestore orphan: ${orphans.length}\n`);

  if (orphans.length === 0) { console.log('✅ orphan 없음.\n'); process.exit(0); }

  console.log('Orphan 목록:');
  for (const o of orphans) {
    console.log(`  uid=${o.uid.slice(0, 8)}…  name=${o.data.name || '(없음)'}  username=${o.data.username || '(없음)'}  role=${o.data.role || '(없음)'}  status=${o.data.status || '(없음)'}`);
  }

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제 삭제는 --apply 추가.\n`);
    process.exit(0);
  }

  console.log(`\n삭제 중...`);
  let usersDeleted = 0, lookupDeleted = 0, errors = 0;
  for (const o of orphans) {
    try {
      await db.doc('users/' + o.uid).delete();
      usersDeleted++;
      // usernameLookup 동반 삭제
      if (o.data.username) {
        const key = o.data.username.toLowerCase();
        try {
          const ref = db.doc('usernameLookup/' + key);
          const s = await ref.get();
          if (s.exists && s.data().uid === o.uid) {
            await ref.delete();
            lookupDeleted++;
          }
        } catch (_) {}
      }
    } catch (e) {
      errors++;
      console.log(`  ❌ ${o.data.name}: ${e.message}`);
    }
  }

  console.log(`\n─── 결과 ───`);
  console.log(`users 삭제: ${usersDeleted}`);
  console.log(`usernameLookup 동반 삭제: ${lookupDeleted}`);
  console.log(`에러: ${errors}\n✅ 완료\n`);

  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
