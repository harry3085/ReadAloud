// 학원별 5분류 한도·사용량 상태 진단 (T9).
//
// 사용:
//   node scripts/diag/check-quota-state.js
//
// 출력:
//   - 학원별 5분류 카운터 / 한도 / 사용률 % / override 여부
//   - 80%+ / 95%+ 학원 요약

const { getDb } = require('../lib/firebase-admin');

const QUOTA_FIELDS = [
  { counter: 'ocrCallsThisMonth',       limitKey: 'ocrPerMonth',          label: 'OCR' },
  { counter: 'cleanupCallsThisMonth',   limitKey: 'cleanupPerMonth',      label: 'Cleanup' },
  { counter: 'generatorCallsThisMonth', limitKey: 'generatorPerMonth',    label: 'Generator' },
  { counter: 'recordingCallsThisMonth', limitKey: 'recordingPerMonth',    label: '녹음' },
  { counter: 'growthReportThisMonth',   limitKey: 'growthReportPerMonth', label: '리포트' },
];

function _ymKST() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7); }

async function main() {
  const db = getDb();
  console.log(`\n=== quota-state (KST ${_ymKST()}) ===\n`);

  const [acadSnap, planSnap] = await Promise.all([
    db.collection('academies').orderBy('createdAt', 'asc').get(),
    db.collection('plans').get(),
  ]);
  const planMap = {};
  planSnap.docs.forEach(d => { planMap[d.id] = d.data(); });

  const warned80 = [];
  const warned95 = [];

  for (const docSnap of acadSnap.docs) {
    const a = docSnap.data();
    const u = a.usage || {};
    const cl = a.customLimits || {};
    const planId = a.planId || 'lite';
    const plan = planMap[planId] || {};
    const tier = String(a.studentLimit || 30);
    const byTier = plan.byTier || {};
    const tl = byTier[tier] || byTier['30'] || byTier[Object.keys(byTier)[0]] || {};

    const overrideKeys = Object.keys(cl).filter(k => cl[k] != null);
    const overrideTag = overrideKeys.length
      ? `, override: ${overrideKeys.map(k => `${k}=${cl[k]}`).join(', ')}`
      : '';

    console.log(`▶ ${docSnap.id} (${plan.displayName || planId} · ${tier}명${overrideTag})`);
    console.log(`  학생: ${u.activeStudentsCount || 0}/${cl.maxStudents ?? a.studentLimit ?? '∞'}`);
    console.log(`  lastResetAt: ${u.lastResetAt || '-'}`);

    for (const f of QUOTA_FIELDS) {
      const cur = u[f.counter] || 0;
      const limFromCustom = cl[f.limitKey];
      const limFromTier = tl[f.limitKey];
      const lim = limFromCustom ?? limFromTier;
      const hasOverride = limFromCustom !== undefined;

      const limStr = (typeof lim === 'number' && isFinite(lim)) ? lim : '∞';
      const pct = (typeof lim === 'number' && lim > 0) ? Math.round((cur / lim) * 100) : 0;
      const tag = pct >= 95 ? '  ⚠⚠ 95%↑' : pct >= 80 ? '  ⚠ 80%↑' : '';
      const overrideStar = hasOverride ? ' ★' : '';

      console.log(`    ${f.label.padEnd(10)} ${String(cur).padStart(5)}/${String(limStr).padEnd(6)} ${String(pct).padStart(3)}%${overrideStar}${tag}`);

      if (pct >= 95) warned95.push(`${docSnap.id}/${f.label}`);
      else if (pct >= 80) warned80.push(`${docSnap.id}/${f.label}`);
    }
    console.log();
  }

  console.log(`─────────────────────────────────────────────`);
  console.log(`요약: 학원 ${acadSnap.size}개`);
  console.log(`  80%↑: ${warned80.length} ${warned80.length ? '(' + warned80.join(', ') + ')' : ''}`);
  console.log(`  95%↑: ${warned95.length} ${warned95.length ? '(' + warned95.join(', ') + ')' : ''}`);
  console.log();
  process.exit(0);
}

main().catch(err => { console.error('\n[error]', err); process.exit(1); });
