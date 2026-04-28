// 학원 백업 JSON 으로부터 복원 — super_admin 운영자용 CLI.
//
// 사용:
//   node scripts/admin/restore-academy.js --file academy-backup-XXX.json
//   node scripts/admin/restore-academy.js --file academy-backup-XXX.json --apply
//   node scripts/admin/restore-academy.js --file academy-backup-XXX.json --apply --password tempPw1234!
//
// 옵션:
//   --file <path>      백업 JSON 파일 (필수)
//   --apply            실제 복원 (없으면 DRY-RUN)
//   --password <pw>    Auth 사용자에게 일괄 부여할 임시 비번 (기본 자동 생성, 8자+)
//   --force            기존 academies/{id} 가 있어도 덮어쓰기 (위험)
//
// 복원 범위:
//   ✓ academies/{id}
//   ✓ 15 컬렉션 (notices/scores/payments/hwFiles/groups/genTests/genQuestionSets/
//                genBooks/genChapters/genPages/pushNotifications/userNotifications/
//                genCleanupPresets/users/apiUsage)
//   ✓ genTests/{id}/userCompleted 서브컬렉션
//   ✓ usernameLookup (users.username 기반 재구성)
//   ✓ Firebase Auth 계정 + Custom Claims (uid 강제 지정으로 옛 uid 유지)
//
// 복원 못 하는 것:
//   ✗ Storage 파일 (숙제파일/녹음파일 binary) — 백업에 없음
//   ✗ Auth password — 임시 비번 부여 (모든 사용자에게 동일)
//
// 안전:
//   - DRY-RUN 기본
//   - academies/{id} 이미 존재 시 거부 (--force 로 우회)
//   - Auth uid 충돌 시 skip + 리포트
//   - apply 결과: 임시 비번 출력 (학원장/학생에게 전달용)

const fs = require('fs');
const { getAuthAdmin, getDb } = require('../lib/firebase-admin');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') { out.apply = true; continue; }
    if (a === '--force') { out.force = true; continue; }
    const m = a.match(/^--([a-z-]+)$/);
    if (m) { out[m[1]] = args[i + 1]; i++; }
  }
  return out;
}

function genPassword() {
  return crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + '!1';
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function reviveTimestamps(obj) {
  if (Array.isArray(obj)) return obj.map(reviveTimestamps);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && ISO_PATTERN.test(v) && !isNaN(Date.parse(v))) {
        out[k] = Timestamp.fromDate(new Date(v));
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = reviveTimestamps(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return obj;
}

async function main() {
  const opts = parseArgs();
  if (!opts.file) { console.error('--file <백업.json> 필수'); process.exit(1); }
  if (!fs.existsSync(opts.file)) { console.error('파일 없음: ' + opts.file); process.exit(1); }

  const password = opts.password || genPassword();
  if (password.length < 6) { console.error('--password 6자 이상'); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  if (!data.academy || !data.academy.id) { console.error('잘못된 백업 형식 (academy.id 없음)'); process.exit(1); }
  if (!data.collections) { console.error('collections 없음'); process.exit(1); }

  const academyId = data.academy.id;
  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== restore-academy ${opts.apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);
  console.log(`백업 파일: ${opts.file}`);
  console.log(`학원 ID: ${academyId}`);
  console.log(`학원명: ${data.academy.name}`);
  console.log(`백업 시점: ${data._exportedAt || '(없음)'}`);
  console.log(`임시 비번: ${password}\n`);

  // 사전 충돌 검사
  const acadRef = db.doc('academies/' + academyId);
  const acadSnap = await acadRef.get();
  if (acadSnap.exists && !opts.force) {
    console.error(`❌ 학원 이미 존재: academies/${academyId}`);
    console.error('   기존 데이터를 덮어쓰려면 --force 추가 (위험)');
    process.exit(1);
  }

  const cols = Object.keys(data.collections).filter(c => c !== 'genTests_userCompleted');
  let totalDocs = 0;
  const stats = {};
  for (const c of cols) {
    const arr = data.collections[c] || [];
    stats[c] = arr.length;
    totalDocs += arr.length;
  }
  const ucMap = data.collections.genTests_userCompleted || {};
  const ucCount = Object.values(ucMap).reduce((s, arr) => s + (arr.length || 0), 0);
  console.log('복원 대상:');
  for (const c of cols) console.log(`  ${c.padEnd(25)} ${stats[c]}`);
  console.log(`  ${'genTests/userCompleted'.padEnd(25)} ${ucCount}`);
  console.log(`  ${'합계'.padEnd(25)} ${totalDocs + ucCount}\n`);

  // Auth 사용자
  const authUsers = (data.collections.users || []).filter(u => u.role === 'admin' || u.role === 'student');
  console.log(`Auth 계정 생성 대상: ${authUsers.length} (admin/student)`);

  if (!opts.apply) { console.log(`\n(DRY-RUN) 실제 복원은 --apply 추가.\n`); process.exit(0); }

  // === 실제 복원 ===
  console.log('\n복원 중...\n');

  // 1. academies
  await acadRef.set(reviveTimestamps(data.academy));
  console.log(`✓ academies/${academyId}`);

  // 2. 일반 컬렉션 (users 제외 — Auth 처리 후 마지막에)
  const generalCols = cols.filter(c => c !== 'users');
  for (const col of generalCols) {
    const docs = data.collections[col] || [];
    if (docs.length === 0) continue;
    let batch = db.batch();
    let inBatch = 0;
    for (const d of docs) {
      const id = d.id;
      const { id: _, ...rest } = d;
      const ref = db.collection(col).doc(id);
      batch.set(ref, reviveTimestamps(rest));
      inBatch++;
      if (inBatch >= 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    console.log(`✓ ${col}: ${docs.length}`);
  }

  // 3. Auth 계정 + users 문서 + usernameLookup + Custom Claims
  let authCreated = 0, authSkipped = 0, authErrors = 0;
  const tempCreds = [];
  for (const u of authUsers) {
    const uid = u.id;
    const email = u.email;
    if (!email) { authSkipped++; console.log(`  ⚠ skip (email 없음): ${u.username}`); continue; }
    try {
      // Auth 생성 (옛 uid 유지)
      try {
        await auth.createUser({ uid, email, password, displayName: u.name || '' });
        authCreated++;
      } catch (e) {
        if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
          // 이미 존재 — uid 유지 update
          await auth.updateUser(uid, { email, password, displayName: u.name || '' });
          console.log(`  ↻ Auth 이미 존재 — 갱신: ${u.username}`);
        } else throw e;
      }
      // Custom Claims
      const role = u.role === 'admin' ? 'academy_admin' : 'student';
      await auth.setCustomUserClaims(uid, { academyId, role });
      // users 문서
      const { id: _, ...userRest } = u;
      await db.doc('users/' + uid).set(reviveTimestamps(userRest));
      // usernameLookup
      if (u.username) {
        await db.doc('usernameLookup/' + u.username.toLowerCase()).set({
          academyId,
          usernameLower: u.username.toLowerCase(),
          uid,
          email,
          role,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tempCreds.push({ username: u.username, email, role: u.role, name: u.name });
    } catch (e) {
      authErrors++;
      console.log(`  ❌ ${u.username}: ${e.message}`);
    }
  }
  console.log(`\n✓ Auth: 생성 ${authCreated} / 갱신 ${authUsers.length - authCreated - authSkipped - authErrors} / skip ${authSkipped} / 에러 ${authErrors}`);

  // 4. genTests/userCompleted 서브컬렉션
  let ucDone = 0;
  for (const testId of Object.keys(ucMap)) {
    const docs = ucMap[testId] || [];
    if (docs.length === 0) continue;
    let batch = db.batch();
    let inBatch = 0;
    for (const d of docs) {
      const id = d.id;
      const { id: _, ...rest } = d;
      const ref = db.collection('genTests').doc(testId).collection('userCompleted').doc(id);
      batch.set(ref, reviveTimestamps(rest));
      inBatch++;
      if (inBatch >= 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    ucDone += docs.length;
  }
  console.log(`✓ genTests/userCompleted: ${ucDone}`);

  // 5. 결과 리포트
  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ 복원 완료');
  console.log(`${'='.repeat(60)}`);
  console.log(`임시 비번 (모든 사용자 동일): ${password}`);
  console.log(`사용자에게 비번 전달 후 변경 권장.`);
  console.log(`\n복원된 사용자 (${tempCreds.length}):`);
  for (const c of tempCreds) {
    console.log(`  ${c.role.padEnd(8)} ${(c.username || '').padEnd(20)} ${c.email}  (${c.name || '-'})`);
  }
  console.log(`${'='.repeat(60)}\n`);

  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
