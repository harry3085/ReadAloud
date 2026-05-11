// 진단: 오늘 녹음숙제 AI 인식 실패 분포 분석
// - genTests 중 testMode='recording' + academyId 필터
// - userCompleted/{uid} 의 latestAttemptAt / latestFailedAt / completedAt 가 오늘 (KST) 인 것
// - 케이스 분류:
//   A) completedAt 오늘            → 통과
//   B) latestFailedAt 오늘         → 미통과 (AI 점수 미달)
//   C) latestErrorStage 있음+오늘  → AI 호출/업로드 실패 (upload/eval/firestore)
//
// 사용:
//   node scripts/diag/analyze-recording-failures-today.js
//   node scripts/diag/analyze-recording-failures-today.js --academy=default
//   node scripts/diag/analyze-recording-failures-today.js --date=2026-05-11

const { getDb } = require('../lib/firebase-admin');

function _ymdKST(d = new Date()) {
  // KST = UTC+9
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
  console.log(`\n=== 녹음숙제 AI 인식 실패 분석 (${academyId} · ${targetYmd}) ===\n`);

  // 1) 시험 추리기
  const testsSnap = await db.collection('genTests')
    .where('academyId', '==', academyId)
    .where('testMode', '==', 'recording')
    .get();
  console.log(`녹음숙제 시험 (전체 기간): ${testsSnap.size}건`);

  if (!testsSnap.size) { console.log('데이터 없음'); process.exit(0); }

  // 2) userCompleted 스캔
  const cases = {
    passed: [],    // A) 통과
    failed: [],    // B) AI 점수 미달
    errored: [],   // C) AI 호출/업로드 실패
  };
  const errorStages = {};   // upload/eval/firestore 분포
  const errorMessages = {}; // message 빈도
  const failedScores = [];  // B 케이스 점수 분포

  for (const t of testsSnap.docs) {
    const tData = t.data();
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    for (const uc of ucSnap.docs) {
      const c = uc.data();
      const uid = c.uid || uc.id;
      const userName = c.userName || uid.slice(0, 8);

      // A) 통과 - completedAt 오늘
      if (_isSameKstDay(c.completedAt, targetYmd)) {
        cases.passed.push({ testId: t.id, testName: tData.name || '(이름없음)', uid, userName, score: c.score });
        continue;
      }

      // C) 에러 - latestAttemptAt 오늘 + latestErrorStage 있음
      if (_isSameKstDay(c.latestAttemptAt, targetYmd) && c.latestErrorStage) {
        cases.errored.push({
          testId: t.id, testName: tData.name || '(이름없음)', uid, userName,
          stage: c.latestErrorStage,
          message: c.latestErrorMessage || '',
        });
        const st = c.latestErrorStage;
        errorStages[st] = (errorStages[st] || 0) + 1;
        const msgKey = (c.latestErrorMessage || '').slice(0, 80);
        if (msgKey) errorMessages[msgKey] = (errorMessages[msgKey] || 0) + 1;
        continue;
      }

      // B) 미통과 - latestFailedAt 오늘
      if (_isSameKstDay(c.latestFailedAt, targetYmd)) {
        const score = c.latestFailedScore;
        cases.failed.push({
          testId: t.id, testName: tData.name || '(이름없음)', uid, userName,
          score, passScore: c.passScore || tData.passScore || 70,
        });
        if (typeof score === 'number') failedScores.push(score);
        continue;
      }
    }
  }

  // 3) 요약
  const total = cases.passed.length + cases.failed.length + cases.errored.length;
  console.log(`오늘 응시 활동: ${total}건`);
  console.log(`  ✅ 통과 (A): ${cases.passed.length}건`);
  console.log(`  ⚠ 미통과 (B - 점수 미달): ${cases.failed.length}건`);
  console.log(`  🚨 에러 (C - AI 호출/업로드 실패): ${cases.errored.length}건`);
  if (total === 0) { console.log('\n오늘 응시 데이터 없음.'); process.exit(0); }

  const errRate = (cases.errored.length / total * 100).toFixed(1);
  const failRate = (cases.failed.length / total * 100).toFixed(1);
  console.log(`\n에러 비율: ${errRate}% · 미통과 비율: ${failRate}%`);

  // 4) C 케이스 상세
  if (cases.errored.length) {
    console.log('\n— 🚨 C) AI 호출/업로드 실패 —');
    console.log('단계별 분포:');
    Object.entries(errorStages).sort((a,b) => b[1]-a[1]).forEach(([s, n]) => {
      console.log(`  ${s.padEnd(12)} ${n}건`);
    });

    console.log('\n에러 메시지 빈도 (상위 5):');
    const sortedMsgs = Object.entries(errorMessages).sort((a,b) => b[1]-a[1]).slice(0, 5);
    sortedMsgs.forEach(([msg, n]) => {
      console.log(`  [${n}건] ${msg || '(빈 메시지)'}`);
    });

    console.log('\n케이스 샘플 (최대 10):');
    cases.errored.slice(0, 10).forEach(c => {
      console.log(`  ${c.userName.padEnd(12)} / ${c.testName.slice(0, 30).padEnd(32)} / ${c.stage.padEnd(10)} / ${c.message.slice(0, 50)}`);
    });
  }

  // 5) B 케이스 상세
  if (cases.failed.length) {
    console.log('\n— ⚠ B) AI 점수 미달 —');
    if (failedScores.length) {
      const sorted = [...failedScores].sort((a,b) => a-b);
      const avg = (failedScores.reduce((a,b) => a+b, 0) / failedScores.length).toFixed(1);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`점수 분포: min=${min} · median=${median} · avg=${avg} · max=${max}`);

      // 점수대별 분포
      const buckets = { '0-30': 0, '31-50': 0, '51-69': 0, '70+': 0 };
      failedScores.forEach(s => {
        if (s <= 30) buckets['0-30']++;
        else if (s <= 50) buckets['31-50']++;
        else if (s < 70) buckets['51-69']++;
        else buckets['70+']++;
      });
      console.log('점수대별:');
      Object.entries(buckets).forEach(([range, n]) => {
        if (n > 0) console.log(`  ${range.padEnd(8)} ${n}건`);
      });
    }

    console.log('\n케이스 샘플 (최대 10):');
    cases.failed.slice(0, 10).forEach(c => {
      console.log(`  ${c.userName.padEnd(12)} / ${c.testName.slice(0, 30).padEnd(32)} / ${c.score}점 (통과 ${c.passScore}점)`);
    });
  }

  // 6) apiUsage 카운터 확인
  console.log('\n— 📊 apiUsage/{academyId}_{date} 카운터 —');
  try {
    const usageDoc = await db.collection('apiUsage').doc(`${academyId}_${targetYmd}`).get();
    if (usageDoc.exists) {
      const u = usageDoc.data();
      const byEp = u.byEndpoint || {};
      console.log(`  check-recording: ${byEp['check-recording'] || 0}회`);
      console.log(`  ocr: ${byEp['ocr'] || 0}회 · cleanup: ${byEp['cleanup-ocr'] || 0}회 · generate: ${byEp['generate-quiz'] || 0}회 · growth: ${byEp['growth-report'] || 0}회`);
    } else {
      console.log('  (오늘 카운터 없음)');
    }
  } catch (_) { console.log('  (조회 실패)'); }

  // 7) 권장 액션
  console.log('\n— 권장 액션 —');
  if (cases.errored.length >= 3) {
    console.log('  ⚠ C 케이스 다수 — Vercel 로그 확인 + 폴백 체인 timeout 분석 권장');
    console.log('    1) Gemini 503/429 폴백 누적 (~36s) vs 클라 timeout 충돌');
    console.log('    2) Storage 업로드 단계 (stage=upload) 면 학생 네트워크 또는 Storage Rules');
    console.log('    3) eval 단계 다수면 AI 응답 파싱 실패 (rawSnippet 확인)');
  }
  if (cases.failed.length >= cases.passed.length * 2) {
    console.log('  ⚠ B 케이스 다수 — 통과점수 또는 평가구간 설정 점검 권장');
    console.log('    시험 배정 모달: 통과점수 / 평가구간 / 최소·최대 녹음시간 / 성실도 임계값');
  }
  if (total < 5) {
    console.log('  ✓ 데이터 부족 — 학생 응시 누적 후 재분석');
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
