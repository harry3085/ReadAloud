// users 컬렉션의 academyId / role 과 Firebase Auth Custom Claims 동기화.
//
// 사용 사례:
//   - 사용자 academyId 를 수동으로 수정한 후 Custom Claims 가 stale 인 경우
//   - migrate:backfill-claims 이후 신규 변경분 보정
//
// 사용:
//   node scripts/admin/sync-claims.js                        # DRY-RUN (전체 비교 리포트)
//   node scripts/admin/sync-claims.js --apply                # 불일치 일괄 보정
//   node scripts/admin/sync-claims.js --uid <uid> --apply    # 특정 사용자만
//
// 동작:
//   1. users 컬렉션 전체 (또는 --uid) 스캔
//   2. 각 user 의 academyId/role 과 Auth Custom Claims 비교
//   3. 불일치 시 setCustomUserClaims(uid, {academyId, role}) 호출
//   4. role 매핑: 'admin' → 'academy_admin', 'student' → 'student'

const { getDb, getAuthAdmin } = require('../lib/firebase-admin');

function normalizeRole(role) {
  if (role === 'admin') return 'academy_admin';
  if (role === 'student') return 'student';
  if (role === 'super_admin') return 'super_admin';
  if (role === 'academy_admin') return 'academy_admin';
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const uidArg = args.find(a => a.startsWith('--uid='))?.split('=')[1]
    || (args.includes('--uid') ? args[args.indexOf('--uid') + 1] : null);

  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== sync-claims ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  let snap;
  if (uidArg) {
    const d = await db.doc('users/' + uidArg).get();
    if (!d.exists) { console.error('user 문서 없음: ' + uidArg); process.exit(1); }
    snap = { docs: [d] };
  } else {
    snap = await db.collection('users').get();
  }

  const stats = { total: 0, ok: 0, mismatch: 0, missing: 0, fixed: 0, errors: 0, skipped: 0 };
  const mismatches = [];

  for (const docSnap of snap.docs) {
    stats.total++;
    const data = docSnap.data();
    const uid = docSnap.id;
    const targetAcademyId = data.academyId || null;
    const targetRole = normalizeRole(data.role);

    if (!targetAcademyId || !targetRole) {
      stats.skipped++;
      continue;
    }

    let user;
    try {
      user = await auth.getUser(uid);
    } catch (e) {
      stats.errors++;
      console.log(`  ❌ Auth 사용자 없음: uid=${uid.slice(0, 8)}… name=${data.name}`);
      continue;
    }

    const currentClaims = user.customClaims || {};
    const claimsAcademyId = currentClaims.academyId || null;
    const claimsRole = currentClaims.role || null;

    const academyMismatch = claimsAcademyId !== targetAcademyId;
    const roleMismatch = claimsRole !== targetRole;
    const claimsMissing = !claimsAcademyId || !claimsRole;

    // super_admin Claims 보유자는 보호 — academy_admin 으로 강등 안 함
    // (수동 promote-super-admin 결과를 보존)
    if (claimsRole === 'super_admin' && targetRole === 'academy_admin' && !academyMismatch) {
      stats.ok++;
      continue;
    }

    if (!academyMismatch && !roleMismatch) {
      stats.ok++;
      continue;
    }

    if (claimsMissing) stats.missing++;
    else stats.mismatch++;

    mismatches.push({
      uid,
      name: data.name,
      username: data.username,
      target: { academyId: targetAcademyId, role: targetRole },
      current: { academyId: claimsAcademyId, role: claimsRole },
    });

    if (apply) {
      try {
        await auth.setCustomUserClaims(uid, {
          academyId: targetAcademyId,
          role: targetRole,
        });
        stats.fixed++;
        console.log(`  ✓ ${data.name?.padEnd(10)} ${data.username?.padEnd(20)} (${claimsAcademyId || '없음'}/${claimsRole || '없음'}) → (${targetAcademyId}/${targetRole})`);
      } catch (e) {
        stats.errors++;
        console.log(`  ❌ ${data.name}: ${e.message}`);
      }
    }
  }

  console.log(`\n─── 결과 ───`);
  console.log(`총 사용자: ${stats.total}`);
  console.log(`OK (일치): ${stats.ok}`);
  console.log(`Claims 누락: ${stats.missing}`);
  console.log(`Claims 불일치: ${stats.mismatch}`);
  console.log(`SKIP (academyId/role 없음): ${stats.skipped}`);
  if (apply) {
    console.log(`수정 완료: ${stats.fixed}`);
    console.log(`에러: ${stats.errors}`);
  } else if (mismatches.length > 0) {
    console.log(`\n불일치 내역:`);
    for (const m of mismatches.slice(0, 20)) {
      console.log(`  ${(m.name || '').padEnd(10)} ${(m.username || '').padEnd(20)} target=(${m.target.academyId}/${m.target.role}) current=(${m.current.academyId || '없음'}/${m.current.role || '없음'})`);
    }
    if (mismatches.length > 20) console.log(`  ... 외 ${mismatches.length - 20}건`);
  }
  if (!apply) console.log(`\n(DRY-RUN) 실제 보정은 --apply 추가.\n`);
  else console.log(`\n⚠️ 사용자에게 로그아웃 → 재로그인 안내 (토큰 갱신 필요).\n`);

  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
