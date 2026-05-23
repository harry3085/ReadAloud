// 학생/관리자 비밀번호 강제 리셋 (Admin SDK 사용 — Auth lockout 우회).
//
// 사용:
//   node scripts/admin/reset-password.js --username <username> --password <newPw>
//   node scripts/admin/reset-password.js --uid <uid> --password <newPw>
//   node scripts/admin/reset-password.js --email <email> --password <newPw>
//
// 동작: auth.updateUser(uid, {password: newPw}) — 즉시 적용, Auth lockout 도 자동 해제.

const { getAuthAdmin, getDb } = require('../lib/firebase-admin');

function getArg(name) {
  const args = process.argv.slice(2);
  const eqIdx = args.findIndex(a => a.startsWith('--' + name + '='));
  if (eqIdx >= 0) return args[eqIdx].split('=').slice(1).join('=');
  const flagIdx = args.indexOf('--' + name);
  if (flagIdx >= 0) return args[flagIdx + 1];
  return null;
}

async function main() {
  const username = getArg('username');
  const uid = getArg('uid');
  const email = getArg('email');
  const password = getArg('password');

  if (!password) { console.error('--password 필수'); process.exit(1); }
  if (password.length < 6) { console.error('비밀번호 6자 이상'); process.exit(1); }
  if (!username && !uid && !email) {
    console.error('--username / --uid / --email 중 하나 필수');
    process.exit(1);
  }

  const auth = getAuthAdmin();
  const db = getDb();

  let targetUid = uid;
  let targetInfo = '';

  if (!targetUid && username) {
    const lookup = await db.doc('usernameLookup/' + username.toLowerCase()).get();
    if (!lookup.exists) { console.error(`usernameLookup/${username.toLowerCase()} 없음`); process.exit(1); }
    targetUid = lookup.data().uid;
    targetInfo = `username=${username}`;
  }
  if (!targetUid && email) {
    const u = await auth.getUserByEmail(email);
    targetUid = u.uid;
    targetInfo = `email=${email}`;
  }

  // user 문서 확인
  const userDoc = await db.doc('users/' + targetUid).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  console.log(`\n대상: uid=${targetUid.slice(0, 8)}…  name=${userData.name || '(없음)'}  username=${userData.username || targetInfo}  academyId=${userData.academyId || '(없음)'}\n`);

  await auth.updateUser(targetUid, { password });
  console.log(`✅ 비밀번호 변경 완료. 즉시 새 비번으로 로그인 가능 (Auth lockout 도 자동 해제).\n`);
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
