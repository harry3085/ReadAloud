// 1회용: scores 에 통과(passed=true) 박혔는데 genTests/{testId}/userCompleted/{uid}
// 에 score 가 없는(= _writeUserCompleted setDoc 실패로 누락된) 케이스를
// scores 의 최고점 기록으로 백필.
//
// 배경: 말하기 시험 등에서 answers 안 undefined → setDoc throw → userCompleted
// 미생성 → 학생앱·학원앱 목록이 영영 "미완료". scores 는 addDoc 으로 정상.
// (2026-05-16 commit d9faa59 로 향후 차단. 이 스크립트는 기존 누락분 복구)
//
// questions/answers 스냅샷은 scores 에 없어 생략. 목록 완료 판정(userCompleted.score)
// 에 필요한 최소 필드만 박음. 상세 모달은 작업 규칙 7 의 폴백 안내로 처리됨.
//
// 사용:
//   DRY-RUN: node scripts/migrate/backfill-usercompleted-from-scores.js
//   APPLY:   node scripts/migrate/backfill-usercompleted-from-scores.js --apply
//   옵션:    --academy=default   특정 학원만
//            --mode=vocab        특정 시험 모드만 (기본: vocab,mcq,fill_blank,unscramble)

const { getDb } = require('../lib/firebase-admin');
const admin = require('firebase-admin');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
}));
const APPLY = !!args.apply;
const ACADEMY = args.academy || null;
const MODES = (args.mode ? String(args.mode).split(',') : ['vocab', 'mcq', 'fill_blank', 'unscramble']);

(async () => {
  const db = getDb();

  let q = db.collection('scores').where('passed', '==', true);
  if (ACADEMY) q = q.where('academyId', '==', ACADEMY);
  const sSnap = await q.get();
  console.log(`passed=true scores: ${sSnap.size}건 (academy=${ACADEMY || '전체'}, modes=${MODES.join(',')})`);

  // (testId, uid) 별 최고점 통과 기록
  const best = new Map();  // key = testId|uid
  sSnap.forEach(d => {
    const s = d.data();
    if (!MODES.includes(s.mode)) return;
    if (!s.testId || !s.uid) return;
    const key = s.testId + '|' + s.uid;
    const cur = best.get(key);
    if (!cur || (s.score || 0) > (cur.score || 0)) best.set(key, s);
  });
  console.log(`(testId,uid) 통과 그룹: ${best.size}개`);

  const toBackfill = [];
  let skipExisting = 0, skipNoTest = 0;

  for (const [key, s] of best) {
    const [testId, uid] = key.split('|');
    const tRef = db.doc('genTests/' + testId);
    const tSnap = await tRef.get();
    if (!tSnap.exists) { skipNoTest++; continue; }  // 레거시·삭제 시험

    const ucRef = db.doc('genTests/' + testId + '/userCompleted/' + uid);
    const ucSnap = await ucRef.get();
    const uc = ucSnap.exists ? ucSnap.data() : null;
    if (uc && uc.score !== undefined) { skipExisting++; continue; }  // 정상 — 이미 완료 기록 있음

    toBackfill.push({ testId, uid, s, tName: tSnap.data().name || '?' });
  }

  console.log('');
  console.log(`스킵: 이미 완료기록 ${skipExisting} · 레거시시험 ${skipNoTest}`);
  console.log(`백필 대상: ${toBackfill.length}건`);
  console.log('');
  toBackfill.slice(0, 40).forEach((x, i) => {
    console.log(`  ${i + 1}. [${x.s.academyId}] ${x.s.userName || x.uid.slice(0, 8)} · "${x.tName}" · ${x.s.mode} · ${x.s.score}점 (${x.s.date})`);
  });
  if (toBackfill.length > 40) console.log(`  ... 외 ${toBackfill.length - 40}건`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply 를 붙여 실행');
    process.exit(0);
  }

  console.log('\n[APPLY] 백필 시작...');
  let done = 0;
  for (const x of toBackfill) {
    const { s, testId, uid } = x;
    const today = s.date || new Date().toISOString().slice(0, 10);
    const data = {
      uid,
      userName: s.userName || s.name || '',
      latestScore: s.score ?? 0,
      latestPassed: true,
      latestDate: today,
      latestAt: admin.firestore.FieldValue.serverTimestamp(),
      score: s.score ?? 0,
      passed: true,
      passScore: s.passScore ?? 80,
      correct: s.correct ?? null,
      wrong: s.wrong ?? null,
      total: s.total ?? null,
      date: today,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      _backfilledFromScores: true,        // 복구 마커 (questions/answers 없음 식별)
      _backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // undefined 방어
    Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });
    await db.doc('genTests/' + testId + '/userCompleted/' + uid).set(data, { merge: true });
    done++;
  }
  console.log(`백필 완료: ${done}건`);
  process.exit(0);
})().catch(e => { console.error('[error]', e); process.exit(1); });
