// 진단: userCompleted 는 있지만 scores 의 최고점이 userCompleted.score 보다 높은
// "최신 최고점 미반영" 케이스 전수검사. (김다윤 케이스 — 재응시 최고점이
// _writeUserCompleted setDoc 실패로 미반영. 주로 말하기 시험 undefined 버그)
//
// 백필 9건(userCompleted 아예 없음)과 구분 — 여긴 userCompleted.score 존재하나 stale.
//
// 사용: node scripts/diag/check-stale-usercompleted.js [--academy=default]

const { getDb } = require('../lib/firebase-admin');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
}));
const ACADEMY = args.academy || null;
const MODES = ['vocab', 'mcq', 'fill_blank', 'unscramble'];

(async () => {
  const db = getDb();
  let q = db.collection('scores').where('passed', '==', true);
  if (ACADEMY) q = q.where('academyId', '==', ACADEMY);
  const sSnap = await q.get();

  // (testId, uid) 별 최고점 통과 기록
  const best = new Map();
  sSnap.forEach(d => {
    const s = d.data();
    if (!MODES.includes(s.mode) || !s.testId || !s.uid) return;
    const key = s.testId + '|' + s.uid;
    const cur = best.get(key);
    if (!cur || (s.score || 0) > (cur.score || 0)) best.set(key, s);
  });
  console.log(`passed scores ${sSnap.size}건 → (testId,uid) 그룹 ${best.size}개`);

  const stale = [];
  const tFmtCache = new Map();
  for (const [key, s] of best) {
    const [testId, uid] = key.split('|');
    if (!tFmtCache.has(testId)) {
      const t = await db.doc('genTests/' + testId).get();
      tFmtCache.set(testId, t.exists ? { name: t.data().name || '?', fmt: t.data().vocabOptions?.format || '-', mode: t.data().testMode } : null);
    }
    const tinfo = tFmtCache.get(testId);
    if (!tinfo) continue;  // 레거시·삭제 시험

    const uc = await db.doc('genTests/' + testId + '/userCompleted/' + uid).get();
    if (!uc.exists) continue;          // userCompleted 아예 없음 = 백필 대상 (별건)
    const c = uc.data();
    if (c.score === undefined) continue; // 동일 — 백필 대상
    if ((s.score || 0) > (c.score || 0)) {
      stale.push({
        academyId: s.academyId, userName: s.userName || uid.slice(0, 8),
        tName: tinfo.name, fmt: tinfo.fmt, mode: tinfo.mode,
        ucScore: c.score, maxScore: s.score, maxDate: s.date,
        ucDate: c.date || '-',
      });
    }
  }

  console.log('');
  console.log(`=== 최신 최고점 미반영 (stale): ${stale.length}건 ===`);
  // format 별 집계
  const byFmt = {};
  stale.forEach(x => { const k = x.mode + '/' + x.fmt; byFmt[k] = (byFmt[k] || 0) + 1; });
  console.log('유형별:', JSON.stringify(byFmt));
  console.log('');
  stale.sort((a, b) => (b.maxScore - b.ucScore) - (a.maxScore - a.ucScore));
  stale.forEach((x, i) => {
    console.log(`  ${i + 1}. [${x.academyId}] ${x.userName} · "${x.tName.slice(0, 38)}" · ${x.mode}/${x.fmt}`);
    console.log(`     userCompleted ${x.ucScore}점(${x.ucDate}) → scores 최고 ${x.maxScore}점(${x.maxDate}) · 차 +${x.maxScore - x.ucScore}`);
  });
  process.exit(0);
})().catch(e => { console.error('[error]', e); process.exit(1); });
