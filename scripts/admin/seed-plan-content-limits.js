// plans/{planId}.byTier[구간] 에 콘텐츠 한도 4개 키 추가 시드 (2026-05-14)
// noticesPerAcademy / draftsPerAcademy / sentMessagesPerAcademy / hwFilesPerAcademy
// 사용: node scripts/admin/seed-plan-content-limits.js [--apply]

const { getDb } = require('../lib/firebase-admin');

const SEED = {
  free: {
    '10':  { noticesPerAcademy: 10, draftsPerAcademy: 20, sentMessagesPerAcademy: 20, hwFilesPerAcademy: 10 },
  },
  lite: {
    '30':  { noticesPerAcademy: 20, draftsPerAcademy: 50, sentMessagesPerAcademy: 50, hwFilesPerAcademy: 30 },
  },
  standard: {
    '30':  { noticesPerAcademy: 30, draftsPerAcademy: 80, sentMessagesPerAcademy: 100, hwFilesPerAcademy: 50 },
    '60':  { noticesPerAcademy: 30, draftsPerAcademy: 80, sentMessagesPerAcademy: 100, hwFilesPerAcademy: 50 },
    '100': { noticesPerAcademy: 30, draftsPerAcademy: 80, sentMessagesPerAcademy: 100, hwFilesPerAcademy: 50 },
  },
  pro: {
    '30':  { noticesPerAcademy: 50, draftsPerAcademy: 100, sentMessagesPerAcademy: 200, hwFilesPerAcademy: 100 },
    '60':  { noticesPerAcademy: 50, draftsPerAcademy: 100, sentMessagesPerAcademy: 200, hwFilesPerAcademy: 100 },
    '100': { noticesPerAcademy: 50, draftsPerAcademy: 100, sentMessagesPerAcademy: 200, hwFilesPerAcademy: 100 },
  },
};

const apply = process.argv.includes('--apply');

(async () => {
  const db = getDb();
  console.log(`\n=== plans 콘텐츠 한도 시드 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  let updated = 0, skipped = 0;
  for (const [planId, tiers] of Object.entries(SEED)) {
    const ref = db.collection('plans').doc(planId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  [skip] plans/${planId} 없음`);
      skipped++;
      continue;
    }
    const cur = snap.data();
    const byTier = cur.byTier || {};
    const newByTier = { ...byTier };
    let changed = false;
    for (const [tier, fields] of Object.entries(tiers)) {
      const before = byTier[tier] || {};
      const after = { ...before };
      for (const [k, v] of Object.entries(fields)) {
        if (after[k] === undefined) {
          after[k] = v;
          changed = true;
        }
      }
      newByTier[tier] = after;
    }
    if (!changed) {
      console.log(`  [skip] plans/${planId} 모든 키 이미 존재`);
      skipped++;
      continue;
    }
    console.log(`  [update] plans/${planId} byTier ↓`);
    for (const [tier, fields] of Object.entries(tiers)) {
      const after = newByTier[tier];
      const diff = Object.keys(fields).filter(k => (byTier[tier]||{})[k] === undefined);
      if (diff.length) console.log(`    ${tier}: ${diff.map(k => `${k}=${after[k]}`).join(', ')}`);
    }
    if (apply) {
      await ref.update({ byTier: newByTier });
      updated++;
    }
  }
  console.log(`\n결과: ${apply ? '업데이트' : 'DRY-RUN 업데이트'} ${updated}건 / 스킵 ${skipped}건`);
  if (!apply) console.log('실제 적용: --apply 옵션 추가');
  process.exit(0);
})();
