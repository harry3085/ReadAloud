// 슈퍼 관리자 전용 계정 생성 CLI.
//
// 학원장(academy_admin)과 분리된 별도 계정. 어떤 학원에도 속하지 않고,
// 모든 학원 데이터에 접근 + Gemini 공식 대시보드 등 운영 도구만 사용.
//
// 사용:
//   node scripts/admin/create-super-admin.js --username sysadmin --email a@b.com --name "운영자"
//   node scripts/admin/create-super-admin.js --username sysadmin --email a@b.com --name "운영자" --apply
//   --password 미지정 시 자동 생성
//
// 결과:
//   Auth 계정 + Custom Claims { role: 'super_admin' } + users/{uid} (role='super_admin')
//   + usernameLookup/{usernameLower}

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

function parseArgs() {
  const out = { apply: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') { out.apply = true; continue; }
    const m = a.match(/^--([a-z-]+)$/);
    if (m) { out[m[1]] = args[i + 1]; i++; }
  }
  return out;
}

function genPassword() {
  return crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + '!1';
}

async function main() {
  const opts = parseArgs();
  const username = (opts.username || '').toLowerCase();
  const email = (opts.email || '').toLowerCase();
  const name = opts.name || '슈퍼 관리자';
  const password = opts.password || genPassword();

  const errs = [];
  if (!username || !/^[a-z0-9_]+$/.test(username)) errs.push('--username 영소문자/숫자/_ 만');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('--email 유효한 이메일');
  if (password.length < 6) errs.push('비밀번호 6자 이상');
  if (errs.length) {
    console.error('\n❌ 입력 오류:\n  - ' + errs.join('\n  - '));
    console.error('\n예시: node scripts/admin/create-super-admin.js --username sysadmin --email admin@kunsori.com --name "큰소리 운영자" --apply');
    process.exit(1);
  }

  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== create-super-admin ${opts.apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);
  console.log(`username:   ${username}`);
  console.log(`email:      ${email}`);
  console.log(`name:       ${name}`);
  console.log(`password:   ${password}\n`);

  // 사전 중복 체크
  const lookupRef = db.doc('usernameLookup/' + username);
  if ((await lookupRef.get()).exists) { console.error(`❌ username 이미 사용 중: ${username}`); process.exit(1); }
  try {
    const ex = await auth.getUserByEmail(email);
    if (ex) { console.error(`❌ 이메일 이미 가입됨: ${email} (uid=${ex.uid})`); process.exit(1); }
  } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }

  if (!opts.apply) { console.log('(DRY-RUN) 실제 실행은 --apply 추가.\n'); process.exit(0); }

  // 1. Auth 계정 생성
  const userRecord = await auth.createUser({ email, password, displayName: name });
  const uid = userRecord.uid;
  console.log(`✓ Auth 계정 생성: uid=${uid}`);

  // 2. Custom Claims (학원 무관)
  await auth.setCustomUserClaims(uid, { role: 'super_admin' });
  console.log(`✓ Custom Claims { role: 'super_admin' }`);

  // 3. Firestore (users + usernameLookup)
  try {
    const batch = db.batch();
    batch.set(db.doc('users/' + uid), {
      role: 'super_admin',
      username,
      name,
      email,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(lookupRef, {
      usernameLower: username,
      uid,
      email,
      role: 'super_admin',
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    console.log(`✓ Firestore users + usernameLookup 생성`);
  } catch (e) {
    console.error('❌ Firestore 실패. Auth 롤백:', e.message);
    try { await auth.deleteUser(uid); console.log('  Auth 롤백 완료'); } catch (_) {}
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ 슈퍼 관리자 생성 완료`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  username:  ${username}`);
  console.log(`  email:     ${email}`);
  console.log(`  password:  ${password}`);
  console.log(`  로그인:    raloud.vercel.app 에서 username/이메일 + 비번 입력`);
  console.log(`  진입:      자동으로 /super/ 슈퍼 관리자 앱`);
  console.log(`${'='.repeat(60)}\n`);
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
