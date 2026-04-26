// Firebase Auth 에만 남아있고 Firestore users/{uid} 문서가 없는 orphan 계정 정리.
//
// 대표 시나리오:
//   과거 버그 있던 시절 관리자 앱의 학생 삭제가 Firestore 만 지우고 Auth 계정은 남긴 경우,
//   같은 이메일(username@kunsori.app)로 재가입 시도하면 auth/email-already-in-use 발생.
//
// 사용:
//   node scripts/cleanup/auth-orphans.js                   # DRY-RUN (전체 orphan 목록)
//   node scripts/cleanup/auth-orphans.js --apply           # 전체 orphan 삭제
//   node scripts/cleanup/auth-orphans.js --only=test2026,aaaa2026   # 특정 username 만
//   node scripts/cleanup/auth-orphans.js --only=test2026,aaaa2026 --apply
//
// 안전 필터:
//   - 이메일이 *@kunsori.app 패턴이 아닌 계정은 SKIP (관리자/개인 이메일 보호)
//   - --only 지정 시 usernameLookup 에 있는 문서도 같이 삭제 (완전 정리)

const { getDb, getAuthAdmin } = require('../lib/firebase-admin');

const DEFAULT_ACADEMY_ID = 'default';
const SAFE_EMAIL_SUFFIX = '@kunsori.app';  // 이외 이메일은 안전하게 SKIP

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlyUsernames = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim().toLowerCase()) : null;
  return { apply, onlyUsernames };
}

async function listAllAuthUsers(auth) {
  const out = [];
  let nextPageToken = undefined;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    out.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return out;
}

async function main() {
  const { apply, onlyUsernames } = parseArgs();
  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== auth-orphans ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
  if (onlyUsernames) console.log(`    --only: ${onlyUsernames.join(',')}`);
  console.log();

  // 1. 모든 Firestore users 문서의 uid 수집
  const fsUsersSnap = await db.collection('users').get();
  const fsUids = new Set(fsUsersSnap.docs.map((d) => d.id));
  console.log(`Firestore users: ${fsUids.size} 건`);

  // 2. 모든 Auth 계정 조회
  const authUsers = await listAllAuthUsers(auth);
  console.log(`Firebase Auth users: ${authUsers.length} 건`);

  // 3. orphan 식별 (Auth 에는 있으나 Firestore 에는 없음)
  const orphans = [];
  let skippedNonKunsori = 0;

  for (const u of authUsers) {
    if (fsUids.has(u.uid)) continue;  // Firestore 에 있으면 정상
    const email = u.email || '';
    if (!email.endsWith(SAFE_EMAIL_SUFFIX)) {
      skippedNonKunsori++;
      continue;
    }
    const username = email.replace(SAFE_EMAIL_SUFFIX, '');
    if (onlyUsernames && !onlyUsernames.includes(username.toLowerCase())) continue;
    orphans.push({ uid: u.uid, email, username });
  }

  console.log(`SKIP (비-kunsori 이메일 — 안전 필터): ${skippedNonKunsori}`);
  console.log(`Orphan 후보: ${orphans.length}\n`);

  if (orphans.length === 0) {
    console.log('정리할 orphan 이 없습니다.\n');
    process.exit(0);
  }

  // 목록 출력
  console.log('Orphan 목록:');
  for (const o of orphans) {
    console.log(`  ${o.uid.slice(0, 10)}…  ${o.username.padEnd(20)}  ${o.email}`);
  }

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제로 삭제하려면 --apply 추가.`);
    console.log(`특정 username 만: --only=${orphans.map(o => o.username).slice(0, 3).join(',')}\n`);
    process.exit(0);
  }

  // 실제 삭제
  console.log(`\n삭제 중...`);
  let authDeleted = 0, lookupDeleted = 0, errors = 0;
  for (const o of orphans) {
    try {
      await auth.deleteUser(o.uid);
      authDeleted++;
    } catch (e) {
      console.log(`  ❌ Auth 삭제 실패 ${o.username}: ${e.message}`);
      errors++;
      continue;
    }
    // usernameLookup 도 같이 정리
    const lookupKey = o.username.toLowerCase();
    try {
      const ref = db.collection('usernameLookup').doc(lookupKey);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.delete();
        lookupDeleted++;
      }
    } catch (e) {
      console.log(`  ⚠️  lookup 삭제 실패 ${o.username}: ${e.message}`);
    }
  }

  console.log(`\n─── 결과 ───`);
  console.log(`Auth 삭제: ${authDeleted}`);
  console.log(`usernameLookup 동반 삭제: ${lookupDeleted}`);
  console.log(`에러: ${errors}`);
  console.log(`\n✅ 완료\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
