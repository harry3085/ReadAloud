// plans/{planId}.byTier 안 콘텐츠 한도 키 현재값 dump
const { getDb } = require('../lib/firebase-admin');
const KEYS = ['noticesPerAcademy', 'draftsPerAcademy', 'sentMessagesPerAcademy', 'hwFilesPerAcademy'];

(async () => {
  const db = getDb();
  const snap = await db.collection('plans').get();
  console.log('\n=== plans byTier 콘텐츠 한도 현재값 ===\n');
  for (const d of snap.docs) {
    const plan = d.data();
    const byTier = plan.byTier || {};
    console.log(`[${d.id}] ${plan.displayName || d.id}`);
    for (const tier of Object.keys(byTier).sort((a,b) => parseInt(a) - parseInt(b))) {
      const t = byTier[tier];
      const vals = KEYS.map(k => `${k.replace('PerAcademy','')}=${t[k] ?? '없음'}`).join(', ');
      console.log(`  ${tier}명: ${vals}`);
    }
    console.log('');
  }
  process.exit(0);
})();
