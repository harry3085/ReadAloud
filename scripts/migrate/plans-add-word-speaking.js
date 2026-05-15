// plans/{planId}.byTier[tier].wordSpeakingPerMonth 필드 추가 (2026-05-15)
// 단어시험 (api/check-word.js) 이 'recording' 한도 공유 → 별도 카운터·한도 분리.
// 초기값 null = 무제한 (super_admin 이 직접 입력 전까지 제한 없음).
//
// 사용:
//   node scripts/migrate/plans-add-word-speaking.js          # DRY-RUN
//   node scripts/migrate/plans-add-word-speaking.js --apply

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const apply = process.argv.includes('--apply');
  const db = getDb();

  console.log(`\n=== plans byTier 에 wordSpeakingPerMonth: null 추가 ${apply ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('plans').get();
  console.log(`plans ${snap.size}개 발견\n`);

  const targets = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const byTier = data.byTier || {};
    const tierKeys = Object.keys(byTier);
    targets.push({
      id: d.id,
      name: data.displayName || d.id,
      tierKeys,
      byTier,
    });
  });

  targets.forEach(t => {
    console.log(`  ${t.id} (${t.name}): ${t.tierKeys.length} tier`);
    t.tierKeys.forEach(tier => {
      const has = 'wordSpeakingPerMonth' in (t.byTier[tier] || {});
      const cur = t.byTier[tier]?.wordSpeakingPerMonth;
      console.log(`    - tier ${tier}: ${has ? `이미 있음 (${cur})` : '→ null 추가'}`);
    });
  });

  if (!apply) {
    console.log('\n(DRY-RUN — --apply 로 실제 적용)\n');
    process.exit(0);
  }

  for (const t of targets) {
    const updates = {};
    let added = 0;
    t.tierKeys.forEach(tier => {
      if (!('wordSpeakingPerMonth' in (t.byTier[tier] || {}))) {
        updates[`byTier.${tier}.wordSpeakingPerMonth`] = null;
        added++;
      }
    });
    if (added > 0) {
      await db.doc(`plans/${t.id}`).update(updates);
      console.log(`  ✓ ${t.id}: ${added} tier 에 wordSpeakingPerMonth: null 추가`);
    } else {
      console.log(`  - ${t.id}: 변경 없음`);
    }
  }

  console.log('\n✓ 완료\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
