// 진단: 학원장 admin 계정의 Custom Claims 확인
// 사용: node scripts/diag/check-admin-claims.js [username|email]

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');

(async () => {
  const target = process.argv[2] || 'admin';
  const auth = getAuthAdmin();
  const db = getDb();

  console.log(`\n=== Custom Claims 진단: "${target}" ===\n`);

  let user = null;
  // 1) usernameLookup 으로 uid 찾기
  if (!target.includes('@')) {
    try {
      const lookupSnap = await db.collection('usernameLookup').doc(target).get();
      if (lookupSnap.exists) {
        const uid = lookupSnap.data().uid;
        console.log(`usernameLookup/${target} → uid: ${uid}`);
        user = await auth.getUser(uid);
      } else {
        console.log(`usernameLookup/${target} 없음. email 패턴으로 검색해보세요.`);
      }
    } catch (e) { console.warn('lookup 실패', e.message); }
  } else {
    try { user = await auth.getUserByEmail(target); } catch (e) { console.warn('email 검색 실패', e.message); }
  }

  if (!user) {
    console.log('\n사용자 찾지 못함. 다른 username 또는 email 시도.');
    process.exit(1);
  }

  console.log('\n— Auth 사용자 정보 —');
  console.log(`  uid:      ${user.uid}`);
  console.log(`  email:    ${user.email}`);
  console.log(`  disabled: ${user.disabled}`);
  console.log(`  claims:   ${JSON.stringify(user.customClaims || {}, null, 2)}`);

  console.log('\n— Firestore users 도큐먼트 —');
  try {
    const u = await db.collection('users').doc(user.uid).get();
    if (u.exists) {
      const d = u.data();
      console.log(`  role:      ${d.role}`);
      console.log(`  academyId: ${d.academyId}`);
      console.log(`  username:  ${d.username}`);
      console.log(`  status:    ${d.status}`);
    } else {
      console.log('  (users 도큐먼트 없음)');
    }
  } catch (e) { console.warn('  users fetch 실패', e.message); }

  // Claims 진단
  console.log('\n— 진단 —');
  const claims = user.customClaims || {};
  if (!claims.role) {
    console.log('  ❌ claims.role 없음 → adminAction.js 가 차단 (admin 만 가능 에러)');
    console.log('     해결: setCustomUserClaims 으로 직접 박거나 sync-claims 실행');
  } else if (claims.role !== 'admin' && claims.role !== 'super_admin') {
    console.log(`  ❌ claims.role = "${claims.role}" → admin 아님`);
  } else if (claims.role === 'admin' && !claims.academyId) {
    console.log('  ❌ claims.academyId 없음 → adminAction.js 가 차단');
  } else {
    console.log(`  ✓ claims OK (role=${claims.role}, academyId=${claims.academyId || '-'})`);
    console.log('     아직 에러 나면 토큰 stale — 로그아웃 후 재로그인 필요');
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
