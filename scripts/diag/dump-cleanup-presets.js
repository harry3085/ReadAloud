// default 학원의 genCleanupPresets 를 _CLEANUP_DEFAULT_PRESETS 형식으로 출력.
// 출력 결과를 admin/js/app.js 의 const _CLEANUP_DEFAULT_PRESETS 에 그대로 붙여넣기.
//
// 사용: node scripts/diag/dump-cleanup-presets.js [--academy default]

const { getDb } = require('../lib/firebase-admin');

function parseArgs() {
  const out = { academy: 'default' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--([a-z-]+)$/);
    if (m && args[i+1] !== undefined) { out[m[1]] = args[i+1]; i++; }
  }
  return out;
}

(async () => {
  const opts = parseArgs();
  const db = getDb();
  const snap = await db.collection('genCleanupPresets')
    .where('academyId', '==', opts.academy)
    .orderBy('order', 'asc')
    .get();

  console.log(`\n=== ${opts.academy} 학원의 genCleanupPresets (${snap.size}개) ===\n`);

  const list = snap.docs.map(d => {
    const data = d.data();
    return {
      name: data.name || '',
      description: data.description || '',
      prompt: data.prompt || '',
      order: data.order ?? 0,
      isDefault: !!data.isDefault,
    };
  });

  console.log('// ─── 아래 내용을 _CLEANUP_DEFAULT_PRESETS 배열에 복붙 ───\n');
  console.log('const _CLEANUP_DEFAULT_PRESETS = [');
  list.forEach((p, i) => {
    console.log('  {');
    console.log(`    name: ${JSON.stringify(p.name)},`);
    console.log(`    description: ${JSON.stringify(p.description)},`);
    console.log('    prompt: `' + p.prompt.replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\$\{/g, '\\${') + '`,');
    console.log(`    order: ${p.order}, isDefault: ${p.isDefault},`);
    console.log('  },');
  });
  console.log('];');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
