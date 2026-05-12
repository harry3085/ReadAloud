// 진단: 학원별 AI OCR 클린업 프리셋 + 글로벌 default 비교
//
// 사용: node scripts/diag/check-cleanup-presets.js --academy=default

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const academyId = args.academy || 'default';
  const db = getDb();

  console.log(`\n=== AI OCR 클린업 프리셋 진단 (${academyId}) ===\n`);

  // 1) 글로벌 default
  const gSnap = await db.doc('appConfig/cleanupPresets').get();
  if (gSnap.exists) {
    const g = gSnap.data();
    const gp = g.presets || [];
    console.log(`📌 글로벌 default (appConfig/cleanupPresets): ${gp.length}개`);
    gp.forEach((p, i) => {
      console.log(`  [${i+1}] name="${p.name}" id=${p.id || '-'} order=${p.order || '-'}`);
    });
  } else {
    console.log(`📌 글로벌 default 없음 (appConfig/cleanupPresets)`);
  }
  console.log();

  // 2) 학원별 프리셋 (top-level + academyId 필터)
  const lSnap = await db.collection('genCleanupPresets').where('academyId', '==', academyId).get();
  console.log(`📌 학원 ${academyId} (genCleanupPresets where academyId): ${lSnap.size}개`);
  const arr = lSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
  arr.forEach((p, i) => {
    console.log(`  [${i+1}] doc=${p.docId.slice(0,12)} name="${p.name}" order=${p.order ?? '-'} isDefault=${p.isDefault || false} createdAt=${p.createdAt?.toDate?.()?.toISOString?.()?.slice(0,19) || '-'}`);
  });
  console.log();

  // 3) 중복 탐지
  console.log('— 🔍 중복 탐지 (이름 기준) —');
  const nameCount = {};
  arr.forEach(p => {
    nameCount[p.name] = (nameCount[p.name] || 0) + 1;
  });
  const dups = Object.entries(nameCount).filter(([_, c]) => c >= 2);
  if (dups.length === 0) {
    console.log('  (중복 없음)');
  } else {
    dups.forEach(([name, count]) => {
      console.log(`  "${name}" → ${count}개`);
      arr.filter(p => p.name === name).forEach(p => {
        console.log(`    doc=${p.docId.slice(0,12)} createdAt=${p.createdAt?.toDate?.()?.toISOString?.()?.slice(0,19) || '-'} prompt 앞 50자: "${(p.prompt||'').slice(0,50)}..."`);
      });
    });
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
