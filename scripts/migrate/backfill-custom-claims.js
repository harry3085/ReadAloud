// 기존 모든 사용자에게 Firebase Auth Custom Claims 를 주입합니다.
//
// 매핑 규칙 (users 컬렉션 기반):
//   users/{uid}.role === 'admin'    →  claims: { academyId: 'default', role: 'academy_admin' }
//   users/{uid}.role === 'student'  →  claims: { academyId: 'default', role: 'student' }
//   role 없음/기타                   →  SKIP + 리포트
//
// 사용:
//   node scripts/migrate/backfill-custom-claims.js          # DRY-RUN
//   node scripts/migrate/backfill-custom-claims.js --apply  # 실제 주입
//
// 안전성:
//   - 이미 동일 claims 가진 사용자는 SKIP (재실행 안전, idempotent)
//   - Firebase Auth 에 없는 users 문서는 SKIP + 에러 리포트
//   - 학생 로그인 세션은 claims 반영 전까진 영향 없음 — 다음 로그인/토큰 갱신 시 적용
//
// Rate limit:
//   setCustomUserClaims 는 초당 ~10회 안전. 74명이면 약 8~10초 소요.

const { getDb, getAuthAdmin } = require('../lib/firebase-admin');

const DEFAULT_ACADEMY_ID = 'default';

function computeTargetClaims(userData) {
  const role = userData.role;
  if (role === 'admin') {
    return { academyId: DEFAULT_ACADEMY_ID, role: 'academy_admin' };
  }
  if (role === 'student') {
    return { academyId: DEFAULT_ACADEMY_ID, role: 'student' };
  }
  return null;
}

function claimsEqual(a, b) {
  if (!a || !b) return false;
  return a.academyId === b.academyId && a.role === b.role;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  const auth = getAuthAdmin();

  console.log(`\n=== backfill-custom-claims ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('users').get();
  const stats = {
    total: snap.size,
    willUpdate: 0,
    alreadyOk: 0,
    skippedNoRole: 0,
    authNotFound: 0,
    errors: 0,
  };

  const plan = [];

  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data();
    const targetClaims = computeTargetClaims(data);

    if (!targetClaims) {
      stats.skippedNoRole++;
      plan.push({ uid, name: data.name, reason: 'SKIP (role 없음/기타)', role: data.role });
      continue;
    }

    try {
      const userRecord = await auth.getUser(uid);
      const current = userRecord.customClaims || {};
      if (claimsEqual(current, targetClaims)) {
        stats.alreadyOk++;
        continue;
      }
      stats.willUpdate++;
      plan.push({
        uid,
        name: data.name || data.username,
        role: data.role,
        from: current,
        to: targetClaims,
      });
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        stats.authNotFound++;
        plan.push({ uid, name: data.name, reason: 'SKIP (Firebase Auth 계정 없음)' });
      } else {
        stats.errors++;
        plan.push({ uid, name: data.name, reason: `ERROR: ${e.message}` });
      }
    }
  }

  // 리포트 출력 (처음 10개 + 요약)
  console.log(`총 users 문서: ${stats.total}`);
  console.log(`이미 일치: ${stats.alreadyOk}`);
  console.log(`업데이트 대상: ${stats.willUpdate}`);
  console.log(`SKIP (role 없음/기타): ${stats.skippedNoRole}`);
  console.log(`SKIP (Auth 없음): ${stats.authNotFound}`);
  console.log(`에러: ${stats.errors}`);

  const updates = plan.filter((p) => p.to);
  if (updates.length > 0) {
    console.log(`\n업데이트 예시 (처음 5개):`);
    for (const p of updates.slice(0, 5)) {
      console.log(`  ${p.uid.slice(0, 8)}…  ${(p.name || '').padEnd(10)}  role=${p.role}  →  ${JSON.stringify(p.to)}`);
    }
  }

  const issues = plan.filter((p) => p.reason && p.reason.startsWith('ERROR'));
  if (issues.length > 0) {
    console.log(`\n⚠️ 에러 상세:`);
    for (const p of issues) {
      console.log(`  ${p.uid}: ${p.reason}`);
    }
  }

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제로 적용하려면 --apply 를 추가하세요.\n`);
    process.exit(0);
  }

  // 실제 적용
  console.log(`\n적용 중...`);
  let done = 0;
  for (const p of updates) {
    try {
      await auth.setCustomUserClaims(p.uid, p.to);
      done++;
      if (done % 10 === 0) process.stdout.write(`  ${done}/${updates.length}\r`);
      await sleep(100); // rate limit 여유
    } catch (e) {
      console.log(`\n  ❌ ${p.uid}: ${e.message}`);
      stats.errors++;
    }
  }

  console.log(`\n\n✅ 완료: ${done}/${updates.length} 명 claims 주입됨\n`);
  console.log(`ℹ️  학생 로그인 세션은 다음 로그인 또는 토큰 갱신 시 반영됩니다.\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
