// 진단: 특정 username 의 users / usernameLookup / Auth 상태 + academyId 일치 검증.
//
// 사용:
//   node scripts/diag/check-user-state.js <admin_username> <student_username>
//
// 출력:
//   - admin user.academyId
//   - student user.academyId
//   - usernameLookup 양쪽 (글로벌 키)
//   - Auth Custom Claims
//   - academyId 일치 여부 + 진단 결론

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');

async function dumpUserByUsername(username) {
  const db = getDb();
  const auth = getAuthAdmin();
  const lookupKey = String(username || '').toLowerCase();

  console.log(`\n--- ${username} ---`);
  // 1. usernameLookup/{username}
  const lookup = await db.doc(`usernameLookup/${lookupKey}`).get();
  if (!lookup.exists) {
    console.log(`  usernameLookup/${lookupKey}: (없음)`);
    return null;
  }
  const ld = lookup.data() || {};
  console.log(`  usernameLookup/${lookupKey}:`, JSON.stringify(ld));

  const uid = ld.uid || ld.userId;
  if (!uid) {
    console.log(`  ⚠ lookup 에 uid 없음`);
    return null;
  }

  // 2. users/{uid}
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    console.log(`  users/${uid}: (없음 — orphan lookup!)`);
  } else {
    const u = userSnap.data() || {};
    console.log(`  users/${uid}:`, {
      name: u.name,
      email: u.email,
      username: u.username,
      role: u.role,
      academyId: u.academyId,
      status: u.status,
      groupId: u.groupId,
    });
  }

  // 3. Auth + Custom Claims
  try {
    const userRecord = await auth.getUser(uid);
    console.log(`  Auth: email=${userRecord.email}, disabled=${userRecord.disabled}`);
    console.log(`  Custom Claims:`, JSON.stringify(userRecord.customClaims || {}));
  } catch (e) {
    console.log(`  Auth: (없음 — orphan users doc!) — ${e.code || e.message}`);
  }

  return { uid, lookup: ld, user: userSnap.exists ? userSnap.data() : null };
}

async function findUsersByName(name) {
  const db = getDb();
  console.log(`\n--- users where name == "${name}" ---`);
  const snap = await db.collection('users').where('name', '==', name).get();
  if (snap.empty) {
    console.log(`  (매칭 없음)`);
    return [];
  }
  const out = [];
  snap.forEach(doc => {
    const u = doc.data();
    console.log(`  ${doc.id}: academyId=${u.academyId}, role=${u.role}, username=${u.username}, email=${u.email}, status=${u.status}`);
    out.push({ uid: doc.id, ...u });
  });
  return out;
}

(async () => {
  const adminUsername = process.argv[2];
  const studentUsername = process.argv[3];

  if (!adminUsername || !studentUsername) {
    console.error('사용: node scripts/diag/check-user-state.js <admin_username> <student_username>');
    process.exit(1);
  }

  console.log(`\n=== 학생 등록 문제 진단 ===`);
  console.log(`학원장: ${adminUsername} / 학생: ${studentUsername}`);

  const admin = await dumpUserByUsername(adminUsername);
  const student = await dumpUserByUsername(studentUsername);

  // 이름으로도 추가 검색 (username 다른 잔존 doc 발견용)
  await findUsersByName('이민서');

  console.log(`\n=== 진단 결론 ===`);
  if (!admin || !admin.user) {
    console.log('⚠ 학원장 계정 자체에 문제. usernameLookup 또는 users doc 누락.');
    process.exit(0);
  }
  if (!student) {
    console.log('학생 username 으로 조회되지 않음. 등록이 lookup 까지 진행 안 됐거나 이미 정리됨.');
    process.exit(0);
  }

  const adminAcademy = admin.user.academyId;
  const studentAcademy = student.user?.academyId;
  console.log(`학원장 academyId: ${adminAcademy}`);
  console.log(`학생 academyId  : ${studentAcademy}`);

  if (adminAcademy && studentAcademy && adminAcademy === studentAcademy) {
    console.log('✓ academyId 일치. 다른 원인 (groupId / status / role 필터?) 확인 필요.');
  } else if (!studentAcademy) {
    console.log('⚠ 학생 doc 의 academyId 가 비어있음 — 학원장 쿼리에 안 잡힘.');
    console.log('   해결: users/' + student.uid + ' 에 academyId=' + adminAcademy + ' 박기');
  } else {
    console.log(`⚠ academyId 불일치 — 학생이 다른 학원 소속으로 저장됨.`);
    console.log(`   해결 후보: (a) 학생 doc academyId 를 ${adminAcademy} 로 수정, 또는 (b) 학생 완전 삭제 후 재등록`);
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
