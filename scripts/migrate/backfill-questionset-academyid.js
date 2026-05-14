// 1회용 마이그레이션: genQuestionSets 의 academyId 누락 doc 에
// createdBy uid 의 users.academyId 를 박는다.
//
// 사용:
//   DRY-RUN:  node scripts/migrate/backfill-questionset-academyid.js
//   APPLY:    node scripts/migrate/backfill-questionset-academyid.js --apply
//
// 배경: 멀티테넌시 도입 (2026-04-27) 이전 데이터 일부에 academyId 누락.
// 어느 학원 화면에도 안 잡혀 학원장이 수정 불가. 1회용 정리.

const { getDb } = require('../lib/firebase-admin');

const APPLY = process.argv.includes('--apply');

(async () => {
  const db = getDb();
  const snap = await db.collection('genQuestionSets').get();

  const targets = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.academyId) continue;
    targets.push({ id: doc.id, data: d });
  }

  console.log(`총 ${snap.size}개 중 academyId 누락: ${targets.length}개`);
  if (targets.length === 0) { console.log('처리할 doc 없음'); process.exit(0); }

  // createdBy uid 모아 users 일괄 조회
  const uidsNeeded = [...new Set(targets.map(t => t.data.createdBy).filter(Boolean))];
  const userMap = new Map();
  for (const uid of uidsNeeded) {
    try {
      const u = await db.doc('users/' + uid).get();
      if (u.exists) userMap.set(uid, u.data());
    } catch (_) {}
  }

  let resolved = 0, unresolved = 0;
  console.log('\n--- 처리 계획 ---');
  for (const t of targets) {
    const u = userMap.get(t.data.createdBy);
    const academyId = u?.academyId;
    const label = `[${t.id}] "${t.data.name || '?'}" (createdBy=${(t.data.createdBy||'?').slice(0,10)}...)`;
    if (academyId) {
      console.log(`  ✓ ${label} → academyId='${academyId}'`);
      resolved++;
    } else {
      console.log(`  ✗ ${label} → users 정보 없음 (skip)`);
      unresolved++;
    }
  }
  console.log(`\n해결 가능: ${resolved} · 미해결: ${unresolved}`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply 를 붙여 실행');
    process.exit(0);
  }

  console.log('\n[APPLY] 적용 시작...');
  let applied = 0;
  for (const t of targets) {
    const u = userMap.get(t.data.createdBy);
    if (!u?.academyId) continue;
    await db.collection('genQuestionSets').doc(t.id).update({ academyId: u.academyId });
    applied++;
  }
  console.log(`적용 완료: ${applied}개`);
  process.exit(0);
})().catch(e => { console.error('[error]', e); process.exit(1); });
