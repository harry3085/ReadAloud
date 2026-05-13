// genTests 각 doc 에 targetUids[] / targetGroups[] / targetAll 평면 필드 추가.
// 기존엔 targets[] 객체 배열만 있어 server-side array-contains 매칭 불가능.
//
// targets[] = [{ type:'all'|'class'|'student', id, name, groupName? }]
//
// 마이그레이션 규칙:
//   - targets[*].type='all' 존재 → targetAll=true
//   - targets[*].type='class' → targetGroups.push(groupName || name)
//   - targets[*].type='student' → targetUids.push(id)
//   - targets[] 비어있고 옛 'target' 필드 있으면 폴백:
//       - target='all' → targetAll=true
//       - targetUid 존재 → targetUids.push(targetUid)
//
// 사용:
//   node scripts/migrate/backfill-test-targets.js          # DRY-RUN
//   node scripts/migrate/backfill-test-targets.js --apply  # 적용

const { getDb } = require('../lib/firebase-admin');

function buildTargetIndex(t) {
  const out = { targetUids: [], targetGroups: [], targetAll: false };
  const tgs = Array.isArray(t.targets) ? t.targets : [];
  for (const x of tgs) {
    if (!x || typeof x !== 'object') continue;
    if (x.type === 'all') out.targetAll = true;
    else if (x.type === 'class') {
      const g = x.groupName || x.name;
      if (g && !out.targetGroups.includes(g)) out.targetGroups.push(g);
    } else if (x.type === 'student') {
      if (x.id && !out.targetUids.includes(x.id)) out.targetUids.push(x.id);
    }
  }
  // 폴백 — targets[] 비어있는 옛 doc
  if (tgs.length === 0) {
    if (t.target === 'all' || t.targetType === 'all') out.targetAll = true;
    if (t.targetUid && !out.targetUids.includes(t.targetUid)) out.targetUids.push(t.targetUid);
    // 옛 'targetName' = 반 이름 추정 가능하지만 명확하지 않음 — 안전하게 skip
  }
  return out;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== backfill genTests targetUids/targetGroups/targetAll ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('genTests').get();
  console.log(`총 시험 ${snap.size}개 발견\n`);

  const stats = { alreadyHasField: 0, willSet: 0, all: 0, classOnly: 0, studentOnly: 0, mixed: 0, empty: 0 };
  const targets = [];

  snap.docs.forEach(d => {
    const data = d.data();
    const hasField = ('targetUids' in data) || ('targetGroups' in data) || ('targetAll' in data);
    if (hasField) { stats.alreadyHasField++; return; }
    const idx = buildTargetIndex(data);
    stats.willSet++;
    if (idx.targetAll) stats.all++;
    else if (idx.targetGroups.length > 0 && idx.targetUids.length === 0) stats.classOnly++;
    else if (idx.targetUids.length > 0 && idx.targetGroups.length === 0) stats.studentOnly++;
    else if (idx.targetGroups.length > 0 || idx.targetUids.length > 0) stats.mixed++;
    else stats.empty++;
    targets.push({
      id: d.id,
      name: data.name || '(이름 없음)',
      academyId: data.academyId || '',
      testMode: data.testMode || '',
      ...idx,
    });
  });

  console.log(`상태 분포:`);
  console.log(`  - 이미 필드 있음 (skip): ${stats.alreadyHasField}`);
  console.log(`  - 신규 backfill: ${stats.willSet}`);
  console.log(`    · 전체 대상 (targetAll): ${stats.all}`);
  console.log(`    · 반만 (targetGroups): ${stats.classOnly}`);
  console.log(`    · 학생만 (targetUids): ${stats.studentOnly}`);
  console.log(`    · 혼합 (반+학생): ${stats.mixed}`);
  console.log(`    · 비어있음 (옛 데이터, 매칭 안 됨): ${stats.empty}\n`);

  // 학원별 분포
  const byAcademy = {};
  targets.forEach(t => { byAcademy[t.academyId] = (byAcademy[t.academyId] || 0) + 1; });
  console.log(`학원별 분포:`);
  Object.entries(byAcademy).forEach(([aid, cnt]) => console.log(`  ${aid}: ${cnt}개`));
  console.log('');

  console.log(`샘플 (최대 10건):`);
  targets.slice(0, 10).forEach(t => {
    console.log(`  ${t.id} [${t.academyId}] (${t.testMode}) "${t.name}" → all=${t.targetAll} grps=[${t.targetGroups.join(',')}] uids=${t.targetUids.length}`);
  });
  console.log('');

  if (!apply) {
    console.log('(DRY-RUN — --apply 로 실제 적용)\n');
    process.exit(0);
  }

  let batch = db.batch();
  let inBatch = 0;
  let total = 0;
  for (const t of targets) {
    batch.update(db.doc(`genTests/${t.id}`), {
      targetAll: t.targetAll,
      targetGroups: t.targetGroups,
      targetUids: t.targetUids,
    });
    inBatch++;
    total++;
    if (inBatch >= 400) {
      await batch.commit();
      console.log(`  ✓ batch commit (${total}/${targets.length})`);
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
    console.log(`  ✓ final batch commit (${total}/${targets.length})`);
  }

  console.log(`\n✅ ${total}개 시험 backfill 완료\n`);
  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
