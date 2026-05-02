// 진단: scores 컬렉션의 mode/testMode 필드 실태 확인.
// CLAUDE.md 는 mode 가 표준이라 함. 마이그레이션 잔존 검출용.

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const db = getDb();
  console.log('\n=== scores 컬렉션 mode/testMode 진단 ===\n');

  const snap = await db.collection('scores').get();
  console.log(`scores 총 ${snap.size}건\n`);

  let hasOnlyMode = 0;
  let hasOnlyTestMode = 0;
  let hasBoth = 0;
  let hasNeither = 0;
  const samples = { onlyTestMode: [], both: [], neither: [] };

  snap.forEach(d => {
    const data = d.data();
    const m = 'mode' in data;
    const t = 'testMode' in data;
    if (m && t) {
      hasBoth++;
      if (samples.both.length < 3) samples.both.push({ id: d.id, mode: data.mode, testMode: data.testMode });
    } else if (m) {
      hasOnlyMode++;
    } else if (t) {
      hasOnlyTestMode++;
      if (samples.onlyTestMode.length < 3) samples.onlyTestMode.push({ id: d.id, testMode: data.testMode });
    } else {
      hasNeither++;
      if (samples.neither.length < 3) samples.neither.push({ id: d.id, score: data.score });
    }
  });

  console.log(`mode 만 있음:     ${hasOnlyMode}`);
  console.log(`testMode 만 있음: ${hasOnlyTestMode}  ${hasOnlyTestMode > 0 ? '⚠ 마이그레이션 필요' : '✓'}`);
  console.log(`둘 다 있음:       ${hasBoth}  ${hasBoth > 0 ? '⚠ testMode 잔존' : '✓'}`);
  console.log(`둘 다 없음:       ${hasNeither}`);

  if (samples.onlyTestMode.length > 0) {
    console.log('\nonlyTestMode 샘플:');
    samples.onlyTestMode.forEach(s => console.log(' ', s));
  }
  if (samples.both.length > 0) {
    console.log('\n둘 다 있음 샘플:');
    samples.both.forEach(s => console.log(' ', s));
  }
  if (samples.neither.length > 0) {
    console.log('\n둘 다 없음 샘플:');
    samples.neither.forEach(s => console.log(' ', s));
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
