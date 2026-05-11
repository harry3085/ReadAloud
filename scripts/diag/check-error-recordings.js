// 진단: 오늘 eval 에러 케이스의 userCompleted 에 recordings 배열이 있는지
//
// 사용: node scripts/diag/check-error-recordings.js --academy=default

const { getDb } = require('../lib/firebase-admin');

function _ymdKST(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function _isSameKstDay(ts, ymd) {
  if (!ts) return false;
  try {
    const ms = ts.toMillis ? ts.toMillis() : (ts._seconds ? ts._seconds * 1000 : 0);
    if (!ms) return false;
    return _ymdKST(new Date(ms)) === ymd;
  } catch (_) { return false; }
}

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const academyId = args.academy || 'default';
  const targetYmd = args.date || _ymdKST();

  const db = getDb();
  console.log(`\n=== 에러 케이스 recordings 배열 진단 (${academyId} · ${targetYmd}) ===\n`);

  const testsSnap = await db.collection('genTests')
    .where('academyId', '==', academyId)
    .where('testMode', '==', 'recording')
    .get();

  let errorCount = 0;
  let withRecordings = 0;
  let withoutRecordings = 0;
  const cases = [];

  for (const t of testsSnap.docs) {
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    for (const uc of ucSnap.docs) {
      const c = uc.data();
      if (!_isSameKstDay(c.latestAttemptAt, targetYmd) || !c.latestErrorStage) continue;
      errorCount++;
      const hasRecs = Array.isArray(c.recordings) && c.recordings.length > 0;
      if (hasRecs) {
        withRecordings++;
      } else {
        withoutRecordings++;
      }
      cases.push({
        testName: (t.data().name || '').slice(0, 35),
        userName: c.userName || uc.id.slice(0, 8),
        stage: c.latestErrorStage,
        hasRecs,
        recCount: hasRecs ? c.recordings.length : 0,
        urls: hasRecs ? c.recordings.map(r => (r.audioUrl || '').slice(0, 60)) : [],
      });
    }
  }

  console.log(`에러 케이스 총 ${errorCount}건:`);
  console.log(`  ✓ recordings 있음: ${withRecordings}건 (재평가 즉시 가능)`);
  console.log(`  ✗ recordings 없음: ${withoutRecordings}건 (Storage list 필요)`);
  console.log();

  cases.forEach(c => {
    const mark = c.hasRecs ? '✓' : '✗';
    console.log(`${mark} [${c.stage}] ${c.userName.padEnd(12)} ${c.testName} (recs=${c.recCount})`);
    c.urls.forEach((u, i) => console.log(`     round${i+1}: ${u}...`));
  });

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
