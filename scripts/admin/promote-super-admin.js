// 특정 사용자를 super_admin 으로 승격 (Custom Claims 변경).
//
// super_admin 권한:
//   - 모든 학원 데이터 접근 (Rules 의 isSuperAdmin)
//   - 신규 학원 생성 (api/createAcademy)
//   - 플랜 문서 수정 (plans/*)
//
// 기존 academy_admin 권한도 유지 (Rules isAdmin 가 academy_admin || super_admin 둘 다 통과).
//
// 사용:
//   node scripts/admin/promote-super-admin.js                   # DRY-RUN — 대상 표시만
//   node scripts/admin/promote-super-admin.js --apply           # 본인(admin username) 승격
//   node scripts/admin/promote-super-admin.js --uid <UID> --apply  # 특정 uid 승격
//
// 안전: 같은 claims 면 SKIP.

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');

const DEFAULT_ACADEMY_ID = 'default';

async function findAdminUid(db) {
  // 기본: users 컬렉션에서 username='admin' 찾기
  const snap = await db.collection('users').where('username', '==', 'admin').limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const uidArg = args.find(a => a.startsWith('--uid='));
  let uid = uidArg ? uidArg.split('=')[1] : null;

  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== promote-super-admin ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  if (!uid) {
    uid = await findAdminUid(db);
    if (!uid) {
      console.error('❌ users 컬렉션에 username=admin 사용자 없음. --uid <UID> 로 지정.');
      process.exit(1);
    }
    console.log(`자동 탐지: users.username='admin' → uid=${uid}`);
  }

  const userRecord = await auth.getUser(uid);
  const current = userRecord.customClaims || {};
  console.log(`대상: ${userRecord.email} (${userRecord.displayName || ''})`);
  console.log(`현재 claims: ${JSON.stringify(current)}`);

  const target = { academyId: DEFAULT_ACADEMY_ID, role: 'super_admin' };
  console.log(`변경 후: ${JSON.stringify(target)}`);

  if (current.role === 'super_admin' && current.academyId === DEFAULT_ACADEMY_ID) {
    console.log('\n✅ 이미 super_admin — 변경 불필요.\n');
    process.exit(0);
  }

  if (!apply) {
    console.log('\n(DRY-RUN) 실제로 변경하려면 --apply 추가.\n');
    process.exit(0);
  }

  await auth.setCustomUserClaims(uid, target);
  console.log('\n✅ 승격 완료.');
  console.log('ℹ️  기존 로그인 세션은 토큰 갱신(최대 1시간) 또는 로그아웃→재로그인 후 적용됩니다.\n');
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
