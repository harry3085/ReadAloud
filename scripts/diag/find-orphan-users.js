// 진단: academyId 누락 / usernameLookup 누락 / Auth 누락 등 정합성 깨진 user 일괄 검출.
//
// 사용:
//   node scripts/diag/find-orphan-users.js
//
// 검사 항목:
//   1. academyId 누락 (학원장 쿼리에 안 잡히는 student/admin)
//   2. username 있는데 usernameLookup 누락 (재등록 시 Auth 충돌)
//   3. usernameLookup 있는데 users doc 없음 (orphan lookup)
//   4. users doc 있는데 Auth 없음 (orphan firestore)
//   5. super_admin 권한 정합 (Custom Claims vs users.role)

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');

(async () => {
  const auth = getAuthAdmin();
  const db = getDb();

  console.log('\n=== orphan / 정합성 진단 ===\n');

  // 1. users 전체 로드
  const usersSnap = await db.collection('users').get();
  console.log(`users 총 ${usersSnap.size}건`);

  const issues = {
    missingAcademyId: [],
    missingLookup: [],
    missingAuth: [],
    claimMismatch: [],
  };

  for (const doc of usersSnap.docs) {
    const u = doc.data();
    const uid = doc.id;

    // 1) academyId 누락 (super_admin 은 학원 무관이라 제외)
    if (!u.academyId && u.role !== 'super_admin') {
      issues.missingAcademyId.push({ uid, name: u.name, username: u.username, email: u.email, role: u.role });
    }

    // 2) usernameLookup 누락
    if (u.username) {
      const key = String(u.username).toLowerCase();
      const ld = await db.doc(`usernameLookup/${key}`).get();
      if (!ld.exists) {
        issues.missingLookup.push({ uid, name: u.name, username: u.username, role: u.role, academyId: u.academyId });
      }
    }

    // 3) Auth 존재 확인 + Custom Claims 정합
    try {
      const ar = await auth.getUser(uid);
      const claims = ar.customClaims || {};
      // super_admin 은 학원 무관, role/academyId 검사 제외
      if (u.role !== 'super_admin') {
        const expectRole = u.role === 'admin' ? 'academy_admin' : 'student';
        if (claims.role !== expectRole || claims.academyId !== u.academyId) {
          issues.claimMismatch.push({
            uid, name: u.name, username: u.username,
            firestore: { role: u.role, academyId: u.academyId },
            claims: { role: claims.role, academyId: claims.academyId },
          });
        }
      }
    } catch (e) {
      issues.missingAuth.push({ uid, name: u.name, username: u.username, email: u.email, role: u.role });
    }
  }

  // 4) usernameLookup 전체 → users doc 존재 확인
  const lookupSnap = await db.collection('usernameLookup').get();
  const orphanLookups = [];
  for (const doc of lookupSnap.docs) {
    const ld = doc.data() || {};
    const uid = ld.uid || ld.userId;
    if (!uid) {
      orphanLookups.push({ key: doc.id, reason: 'no uid field', data: ld });
      continue;
    }
    const us = await db.doc(`users/${uid}`).get();
    if (!us.exists) {
      orphanLookups.push({ key: doc.id, reason: 'users doc missing', uid });
    }
  }

  // 출력
  console.log('\n--- 1) academyId 누락 (학원장 화면에 안 잡히는 user) ---');
  if (issues.missingAcademyId.length === 0) console.log('  (없음)');
  else issues.missingAcademyId.forEach(x => console.log(`  ${x.uid}: ${x.role} / name=${x.name} / username=${x.username} / email=${x.email}`));

  console.log('\n--- 2) usernameLookup 누락 (재등록 시 Auth 충돌 위험) ---');
  if (issues.missingLookup.length === 0) console.log('  (없음)');
  else issues.missingLookup.forEach(x => console.log(`  ${x.uid}: ${x.role} / name=${x.name} / username=${x.username} / academyId=${x.academyId||'(없음)'}`));

  console.log('\n--- 3) Auth 누락 (Firestore 만 살아있는 orphan) ---');
  if (issues.missingAuth.length === 0) console.log('  (없음)');
  else issues.missingAuth.forEach(x => console.log(`  ${x.uid}: ${x.role} / name=${x.name} / username=${x.username} / email=${x.email}`));

  console.log('\n--- 4) usernameLookup 은 있는데 users doc 없음 (orphan lookup) ---');
  if (orphanLookups.length === 0) console.log('  (없음)');
  else orphanLookups.forEach(x => console.log(`  usernameLookup/${x.key}: ${x.reason}${x.uid?` (uid=${x.uid})`:''}`));

  console.log('\n--- 5) Custom Claims vs Firestore role/academyId 불일치 ---');
  if (issues.claimMismatch.length === 0) console.log('  (없음)');
  else issues.claimMismatch.forEach(x => console.log(`  ${x.uid}: ${x.name} (${x.username})\n    Firestore: ${JSON.stringify(x.firestore)}\n    Claims  : ${JSON.stringify(x.claims)}`));

  const total = issues.missingAcademyId.length + issues.missingLookup.length + issues.missingAuth.length + orphanLookups.length + issues.claimMismatch.length;
  console.log(`\n=== 총 ${total} 건 ===`);
  if (total > 0) {
    console.log('해결 방법:');
    console.log('  · academyId 누락 → users doc 의 academyId 백필 또는 완전 삭제 후 재등록');
    console.log('  · usernameLookup 누락 → 글로벌 키로 신규 생성 또는 완전 삭제');
    console.log('  · Auth 누락 → Firestore doc 정리 (학생/관리자 다시 등록 필요)');
    console.log('  · orphan lookup → lookup doc 단독 삭제');
    console.log('  · Claims 불일치 → npm run sync-claims');
  }
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
