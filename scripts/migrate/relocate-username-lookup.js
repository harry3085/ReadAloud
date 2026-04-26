// usernameLookup 키를 학원 prefix 없는 글로벌 유니크 형식으로 이전.
//   기존: usernameLookup/{academyId}_{usernameLower}
//   신규: usernameLookup/{usernameLower}
//
// 사용:
//   node scripts/migrate/relocate-username-lookup.js          # DRY-RUN
//   node scripts/migrate/relocate-username-lookup.js --apply  # 실제 이전
//
// 동작:
//   1. usernameLookup 컬렉션 전체 스캔
//   2. ID 가 `{academyId}_{usernameLower}` 패턴인 문서 식별 (default_/raloud2_ 등)
//   3. 이미 평문 ID 가 존재하면 충돌 — 보고하고 SKIP
//   4. apply 시: 새 ID 로 set + 옛 ID delete (batch 단위)
//
// 안전성:
//   - DRY-RUN 기본
//   - 충돌(같은 username 이 두 학원에 있으면) 자동 멈춤 + 리포트
//   - 이미 평문 ID 인 문서는 그대로 두고 skip

const { getDb } = require('../lib/firebase-admin');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== relocate-username-lookup ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('usernameLookup').get();
  console.log(`총 문서: ${snap.size}`);

  // ID 분류
  const prefixed = []; // {academyId}_{username} 패턴
  const flat = new Set(); // 이미 평문 ID

  for (const docSnap of snap.docs) {
    const id = docSnap.id;
    const data = docSnap.data();
    // 패턴 추정: id 에 underscore 가 있고, data.usernameLower 와 id 가 다르면 prefixed
    const usernameLower = data.usernameLower;
    if (usernameLower && id !== usernameLower && id.endsWith('_' + usernameLower)) {
      prefixed.push({ oldId: id, newId: usernameLower, data });
    } else if (usernameLower && id === usernameLower) {
      flat.add(id);
    } else {
      // 모호 — 일단 그대로 둠
      console.log(`  ? 모호: id=${id} usernameLower=${usernameLower || '(없음)'}`);
    }
  }

  console.log(`prefix 형식: ${prefixed.length} 건`);
  console.log(`평문 형식: ${flat.size} 건\n`);

  // 충돌 검사
  const conflicts = [];
  const newIdCounts = new Map();
  for (const p of prefixed) {
    newIdCounts.set(p.newId, (newIdCounts.get(p.newId) || 0) + (flat.has(p.newId) ? 1 : 0) + 1);
  }
  // 같은 newId 로 2건 이상이면 충돌
  const seenNewIds = new Map();
  for (const p of prefixed) {
    if (!seenNewIds.has(p.newId)) seenNewIds.set(p.newId, []);
    seenNewIds.get(p.newId).push(p);
  }
  for (const [newId, list] of seenNewIds.entries()) {
    if (list.length > 1 || flat.has(newId)) {
      conflicts.push({ newId, prefixedList: list, hasFlat: flat.has(newId) });
    }
  }

  if (conflicts.length > 0) {
    console.log(`⚠️  충돌 ${conflicts.length} 건:`);
    for (const c of conflicts) {
      console.log(`  newId=${c.newId} (flat 존재: ${c.hasFlat})`);
      for (const p of c.prefixedList) {
        console.log(`    - oldId=${p.oldId} academyId=${p.data.academyId} uid=${p.data.uid?.slice(0, 8)}…`);
      }
    }
    console.log(`\n충돌 해소 후 재실행하세요. (학원별로 username 이 같은 학생/관리자가 있으면 한쪽 username 변경 필요)\n`);
    process.exit(1);
  }

  if (prefixed.length === 0) {
    console.log(`✅ 이전할 문서 없음.\n`);
    process.exit(0);
  }

  console.log(`이전 대상 샘플:`);
  for (const p of prefixed.slice(0, 5)) {
    console.log(`  ${p.oldId} → ${p.newId}  (academyId=${p.data.academyId})`);
  }

  if (!apply) {
    console.log(`\n(DRY-RUN) 실제 실행은 --apply 추가.\n`);
    process.exit(0);
  }

  console.log(`\n이전 중...`);
  let batch = db.batch();
  let inBatch = 0;
  let done = 0;

  for (const p of prefixed) {
    const newRef = db.collection('usernameLookup').doc(p.newId);
    const oldRef = db.collection('usernameLookup').doc(p.oldId);
    batch.set(newRef, p.data);
    batch.delete(oldRef);
    inBatch += 2;
    if (inBatch >= 450) {
      await batch.commit();
      done += inBatch / 2;
      process.stdout.write(`  ${done}/${prefixed.length}\r`);
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
    done += inBatch / 2;
  }

  console.log(`\n\n✅ 완료: ${done}/${prefixed.length} 건 이전됨\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[error]', err);
  process.exit(1);
});
