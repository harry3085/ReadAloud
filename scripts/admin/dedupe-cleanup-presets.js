// 학원별 클린업 프리셋 중복 정리
//
// 규칙 (사용자 결정):
// - 글로벌 default (appConfig/cleanupPresets) 와 prompt 동일한 학원 doc 들 = 학원장 미수정 = 1개만 유지
// - 글로벌 default 와 prompt 다른 doc = 학원장 커스텀. keep. 단 같은 prompt 끼리는 1개
// - 글로벌에 없는 이름의 doc = 학원장 커스텀. 같은 prompt 끼리만 dedupe
// - prompt 정규화: trim + collapse whitespace
//
// 사용:
//   node scripts/admin/dedupe-cleanup-presets.js                    (DRY-RUN, 모든 학원)
//   node scripts/admin/dedupe-cleanup-presets.js --academy=default  (DRY-RUN, 특정 학원)
//   node scripts/admin/dedupe-cleanup-presets.js --apply            (실제 삭제)

const { getDb } = require('../lib/firebase-admin');

function _normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const academyFilter = args.academy;
  const apply = !!args.apply;

  const db = getDb();
  console.log(`\n=== 클린업 프리셋 중복 정리 ${apply ? '[APPLY]' : '[DRY-RUN]'} ===\n`);

  // 1) 글로벌 default 로드
  const gSnap = await db.doc('appConfig/cleanupPresets').get();
  const globalDefaults = (gSnap.exists ? (gSnap.data().presets || []) : []);
  const globalByName = {};
  globalDefaults.forEach(p => { if (p?.name) globalByName[p.name] = _normalize(p.prompt); });
  console.log(`글로벌 default: ${globalDefaults.length}개`);
  globalDefaults.forEach(p => console.log(`  - "${p.name}" (prompt ${_normalize(p.prompt).length}자)`));
  console.log();

  // 2) 학원 목록
  let academies;
  if (academyFilter) {
    academies = [{ id: academyFilter }];
  } else {
    const acSnap = await db.collection('academies').get();
    academies = acSnap.docs.map(d => ({ id: d.id }));
  }

  let totalKept = 0, totalDeleted = 0;
  const deletedRefs = [];

  for (const ac of academies) {
    const academyId = ac.id;
    const lSnap = await db.collection('genCleanupPresets').where('academyId', '==', academyId).get();
    if (!lSnap.size) continue;

    console.log(`\n— 학원 "${academyId}" — ${lSnap.size}개 프리셋 —`);
    const docs = lSnap.docs.map(d => ({
      docId: d.id,
      ref: d.ref,
      ...d.data(),
      _promptNorm: _normalize(d.data().prompt),
      _createdMs: d.data().createdAt?.toMillis?.() || 0,
    }));

    // 이름별 그룹화
    const byName = {};
    docs.forEach(p => {
      const n = p.name || '_unnamed';
      if (!byName[n]) byName[n] = [];
      byName[n].push(p);
    });

    let kept = 0, deleted = 0;
    for (const [name, group] of Object.entries(byName)) {
      if (group.length === 1) {
        kept++;
        continue;
      }
      // 정렬 — 가장 오래된 것 우선 (createdAt 작은 순)
      group.sort((a, b) => a._createdMs - b._createdMs);

      const globalPrompt = globalByName[name];  // 글로벌 default 에 같은 이름 있나
      const keepers = new Set();  // 유지할 docId

      if (globalPrompt !== undefined) {
        // 글로벌 default 와 prompt 동일한 첫 1개 keep + 나머지 다른 prompt 끼리도 1개씩
        const matchingGlobal = group.filter(p => p._promptNorm === globalPrompt);
        if (matchingGlobal.length > 0) {
          keepers.add(matchingGlobal[0].docId);  // 글로벌 매칭 첫 1개
        }
        // 글로벌과 다른 prompt 들 — 학원장 커스텀. prompt 별로 1개씩 keep
        const customGroups = {};
        group.filter(p => p._promptNorm !== globalPrompt).forEach(p => {
          if (!customGroups[p._promptNorm]) customGroups[p._promptNorm] = p;
        });
        Object.values(customGroups).forEach(p => keepers.add(p.docId));
      } else {
        // 글로벌에 없는 이름 (옛 학원장 커스텀) — prompt 별 1개씩
        const customGroups = {};
        group.forEach(p => {
          if (!customGroups[p._promptNorm]) customGroups[p._promptNorm] = p;
        });
        Object.values(customGroups).forEach(p => keepers.add(p.docId));
      }

      const toDelete = group.filter(p => !keepers.has(p.docId));
      const toKeep = group.filter(p => keepers.has(p.docId));
      console.log(`  "${name}" — ${group.length}개 → keep ${toKeep.length} / delete ${toDelete.length}`);
      toKeep.forEach(p => console.log(`    ✓ keep   doc=${p.docId.slice(0,12)} createdAt=${new Date(p._createdMs).toISOString().slice(0,19)}`));
      toDelete.forEach(p => {
        console.log(`    ✗ delete doc=${p.docId.slice(0,12)} createdAt=${new Date(p._createdMs).toISOString().slice(0,19)}`);
        deletedRefs.push(p.ref);
      });
      kept += toKeep.length;
      deleted += toDelete.length;
    }

    console.log(`  소계: keep ${kept} / delete ${deleted}`);
    totalKept += kept;
    totalDeleted += deleted;
  }

  console.log(`\n=== 최종 ===`);
  console.log(`전체: keep ${totalKept} / delete ${totalDeleted}`);

  if (!apply) {
    console.log(`\n(DRY-RUN — 실제 삭제하려면 --apply 추가)`);
    process.exit(0);
  }

  // 실제 삭제
  console.log(`\n삭제 진행...`);
  for (const ref of deletedRefs) {
    try { await ref.delete(); } catch (e) { console.error(`삭제 실패 ${ref.id}: ${e.message}`); }
  }
  console.log(`✓ ${deletedRefs.length}건 삭제 완료`);

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
