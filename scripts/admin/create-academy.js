// 신규 학원 생성 CLI 스크립트.
//
// Admin SDK 로 직접 academies + users + Auth 생성. (api/createAcademy.js 와 동일 동작이지만
// 서버 거치지 않고 로컬에서 즉시 실행 — super_admin ID 토큰 필요 없음)
//
// 사용:
//   node scripts/admin/create-academy.js --name "ABC공부방" --subdomain "abc" \
//     --admin-email "owner@abc.com" --plan "lite" --limit 30
//
//   node scripts/admin/create-academy.js --name "..." --subdomain "..." \
//     --admin-email "..." --plan "..." --limit ...  --apply
//
// 옵션:
//   --name        학원명 (필수)
//   --subdomain   학원 ID (영소문자/숫자/_-, 필수, 'default' 금지)
//   --admin-email 학원장 이메일 (필수)
//   --plan        lite | standard | pro (기본: lite)
//   --limit       학생 수 한도 30/60/100 (기본: 30)
//   --grandfathered <원>  (선택) 얼리어답터 가격 보장
//   --password <pw>       (선택) 학원장 임시 비밀번호. 미지정 시 자동 생성
//   --apply       실제 실행 (없으면 DRY-RUN)
//
// 안전:
//   - DRY-RUN 기본
//   - subdomain 'default' 금지
//   - 이미 존재하는 학원 / 이메일 차단
//   - Firestore 실패 시 Auth 롤백

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
    if (m) {
      out[m[1]] = args[i + 1];
      i++;
    }
  }
  return out;
}

function generateRandomPassword() {
  return crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + '!1';
}

async function main() {
  const opts = parseArgs();

  const name = opts.name;
  const subdomain = (opts.subdomain || '').toLowerCase();
  const adminEmail = (opts['admin-email'] || '').toLowerCase();
  const planId = opts.plan || 'lite';
  const studentLimit = parseInt(opts.limit) || 30;
  const grandfatheredPrice = opts.grandfathered ? Number(opts.grandfathered) : null;
  const password = opts.password || generateRandomPassword();

  // 검증
  const errs = [];
  if (!name) errs.push('--name 필수');
  if (!subdomain || !/^[a-z0-9_-]+$/.test(subdomain)) errs.push('--subdomain 영소문자/숫자/_- 만');
  if (subdomain === 'default') errs.push("'default' 는 예약된 학원 ID");
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errs.push('--admin-email 유효한 이메일');
  if (!['lite', 'standard', 'pro'].includes(planId)) errs.push("--plan 은 lite|standard|pro");
  if (errs.length) {
    console.error('\n❌ 입력 오류:\n  - ' + errs.join('\n  - '));
    console.error('\n예시: node scripts/admin/create-academy.js --name "ABC공부방" --subdomain "abc" --admin-email "owner@abc.com" --plan "lite" --limit 30 --apply');
    process.exit(1);
  }

  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== create-academy ${opts.apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);
  console.log(`학원명:      ${name}`);
  console.log(`subdomain:   ${subdomain}`);
  console.log(`학원장 이메일: ${adminEmail}`);
  console.log(`plan:        ${planId}`);
  console.log(`학생 한도:    ${studentLimit}`);
  if (grandfatheredPrice) console.log(`보장 가격:    ${grandfatheredPrice}`);
  console.log(`임시 비밀번호: ${password}\n`);

  // 사전 중복 체크
  const academyRef = db.doc(`academies/${subdomain}`);
  if ((await academyRef.get()).exists) {
    console.error(`❌ 이미 존재하는 학원: academies/${subdomain}`);
    process.exit(1);
  }
  const planRef = db.doc(`plans/${planId}`);
  if (!(await planRef.get()).exists) {
    console.error(`❌ 존재하지 않는 plan: plans/${planId}`);
    process.exit(1);
  }
  try {
    const existing = await auth.getUserByEmail(adminEmail);
    if (existing) {
      console.error(`❌ 이미 존재하는 Auth 계정: ${adminEmail} (uid=${existing.uid})`);
      process.exit(1);
    }
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  if (!opts.apply) {
    console.log('(DRY-RUN) 실제 실행은 --apply 추가.\n');
    process.exit(0);
  }

  // 1. 학원장 Auth 계정 생성
  const userRecord = await auth.createUser({
    email: adminEmail,
    password,
    displayName: `${name} 학원장`,
  });
  const adminUid = userRecord.uid;
  console.log(`✓ Auth 계정 생성: uid=${adminUid}`);

  // 2. Custom Claims
  await auth.setCustomUserClaims(adminUid, { academyId: subdomain, role: 'academy_admin' });
  console.log(`✓ Custom Claims 주입`);

  // 3. Firestore (academies + users) batch
  try {
    const batch = db.batch();
    batch.set(academyRef, {
      id: subdomain,
      name,
      subdomain,
      planId,
      billingStatus: 'active',
      studentLimit,
      grandfatheredPrice,
      subscribedAt: FieldValue.serverTimestamp(),
      planExpiresAt: null,
      settings: { recordingIntegrity: { minVoiceActivity: 0.7, minDurationSec: 30, maxDurationSec: 600 } },
      usage: {
        activeStudentsCount: 0,
        aiCallsThisMonth: 0,
        mcqCallsThisMonth: 0,
        recordingCallsThisMonth: 0,
        storageBytes: 0,
        lastResetAt: new Date().toISOString().slice(0, 7),
      },
      createdBy: 'cli',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // 학원장 username = subdomain 그대로 (접미사 없음, 2026-04-27 정책)
    const adminUsername = subdomain;
    const adminUsernameLower = adminUsername.toLowerCase();
    batch.set(db.doc(`users/${adminUid}`), {
      academyId: subdomain,
      role: 'admin',
      username: adminUsername,
      name: `${name} 학원장`,
      email: adminEmail,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.doc(`usernameLookup/${adminUsernameLower}`), {
      academyId: subdomain,
      usernameLower: adminUsernameLower,
      uid: adminUid,
      email: adminEmail,
      role: 'academy_admin',
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    console.log(`✓ Firestore academies + users 생성`);
  } catch (e) {
    console.error('❌ Firestore 실패. Auth 롤백 시도:', e.message);
    try { await auth.deleteUser(adminUid); console.log('  Auth 롤백 완료'); } catch (_) {}
    process.exit(1);
  }

  // 4. 결과 출력
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ 학원 생성 완료`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  학원 ID:        ${subdomain}`);
  console.log(`  학원장 이메일:    ${adminEmail}`);
  console.log(`  임시 비밀번호:    ${password}`);
  console.log(`  학원장 username: ${subdomain}_admin`);
  console.log(`  → 학원장에게 위 정보 전달, 첫 로그인 후 비밀번호 변경 권장.`);
  console.log(`${'='.repeat(60)}\n`);

  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
