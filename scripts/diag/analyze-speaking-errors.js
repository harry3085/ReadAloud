// 진단: 단어말하기 시험에서 공통 오답 단어 분석
// - genTests 중 vocabOptions.format='speaking' 시험만 스캔
// - 각 시험의 userCompleted/{uid}.answers 에서 spkCorrect=false 인 항목 추출
// - 단어별 오답 횟수 + 학생이 들린 단어 (spkHeard) 빈도 카운팅
//
// 사용:
//   node scripts/diag/analyze-speaking-errors.js
//   node scripts/diag/analyze-speaking-errors.js --academy=raloud2  (학원 필터)
//   node scripts/diag/analyze-speaking-errors.js --top=30           (상위 N개)

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const top = parseInt(args.top) || 20;

  const db = getDb();
  console.log('\n=== 단어말하기 오답 단어 분석 ===\n');
  if (args.academy) console.log(`(필터) academyId = ${args.academy}\n`);

  // 1) 단어말하기 시험 찾기
  let qRef = db.collection('genTests').where('testMode', '==', 'vocab');
  if (args.academy) qRef = qRef.where('academyId', '==', args.academy);
  const testsSnap = await qRef.get();
  const speakingTests = testsSnap.docs.filter(d => d.data().vocabOptions?.format === 'speaking');
  console.log(`vocab 시험 ${testsSnap.size}건 중 말하기 시험: ${speakingTests.length}건\n`);
  if (!speakingTests.length) { console.log('데이터 없음'); process.exit(0); }

  // 2) 각 시험의 userCompleted 스캔 + answers 추출
  const wordStats = {};   // q.word(소문자) → { word, total, wrong, heard: { 'serial': 5, ... }, attempts: { 1:..., 2:... } }
  let totalAnswers = 0;
  let totalWrong = 0;
  let totalCompletions = 0;

  for (const t of speakingTests) {
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    for (const uc of ucSnap.docs) {
      totalCompletions++;
      const ucData = uc.data();
      const answers = ucData.answers || [];
      const questions = ucData.questions || [];
      for (let i = 0; i < answers.length; i++) {
        const ans = answers[i];
        if (ans.format !== 'speaking') continue;
        // questions[i].word 와 answers[i] idx 매칭
        const word = (questions[i]?.word || '').toLowerCase().trim();
        if (!word) continue;
        if (!wordStats[word]) {
          wordStats[word] = { word, total: 0, wrong: 0, heard: {}, attempts: { 1:0, 2:0 } };
        }
        const ws = wordStats[word];
        ws.total++;
        totalAnswers++;
        if (ans.spkCorrect === false) {
          ws.wrong++;
          totalWrong++;
          const heard = (ans.spkHeard || '').toLowerCase().trim();
          if (heard) ws.heard[heard] = (ws.heard[heard] || 0) + 1;
        }
        const att = ans.spkAttempts;
        if (att === 1 || att === 2) ws.attempts[att]++;
      }
    }
  }

  console.log(`스캔: ${speakingTests.length} 시험, ${totalCompletions} 응시(완료), ${totalAnswers} 단어 응답, ${totalWrong} 오답`);
  console.log(`전체 오답률: ${totalAnswers ? (totalWrong/totalAnswers*100).toFixed(1) : '-'}%\n`);

  if (totalAnswers === 0) {
    console.log('⚠ answers 스냅샷이 없습니다. CLAUDE.md 작업 규칙 7: 통과 응시만 questions/answers 저장.');
    console.log('말하기 시험 통과한 사용자가 없거나, answers 안에 word 필드가 다른 키로 박혀있을 수 있습니다.');
    process.exit(0);
  }

  // 3) 오답 횟수 정렬 + 출력
  const list = Object.values(wordStats)
    .filter(w => w.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || (b.wrong/b.total) - (a.wrong/a.total));

  console.log(`— 오답 빈도 상위 ${Math.min(top, list.length)} 단어 —\n`);
  console.log('단어'.padEnd(18) + '오답/총응답'.padEnd(15) + '오답률'.padEnd(10) + '들린 단어 (빈도)');
  console.log('─'.repeat(80));
  list.slice(0, top).forEach(w => {
    const heardTop = Object.entries(w.heard).sort((a,b) => b[1]-a[1]).slice(0, 3)
      .map(([h, n]) => `${h}(${n})`).join(', ');
    const ratio = ((w.wrong / w.total) * 100).toFixed(0) + '%';
    console.log(
      w.word.padEnd(18) +
      `${w.wrong}/${w.total}`.padEnd(15) +
      ratio.padEnd(10) +
      heardTop
    );
  });

  // 4) 동음이의어 후보 자동 탐지 — 들린 단어 빈도가 정답 단어의 50% 이상인 케이스
  console.log('\n— 🎯 동음이의어/유사발음 후보 (들린 단어가 일관되게 다른 단어로 인식) —\n');
  const homophoneCandidates = list.filter(w => {
    const sortedHeard = Object.entries(w.heard).sort((a,b) => b[1]-a[1]);
    if (!sortedHeard.length) return false;
    const [topHeard, topCount] = sortedHeard[0];
    return topHeard !== w.word && topCount >= w.wrong * 0.5;  // 오답의 50% 이상 같은 단어로 인식
  });
  if (!homophoneCandidates.length) {
    console.log('  (없음 — 오답 데이터 부족 또는 들린 단어 다양)');
  } else {
    homophoneCandidates.forEach(w => {
      const sortedHeard = Object.entries(w.heard).sort((a,b) => b[1]-a[1]);
      const [topHeard, topCount] = sortedHeard[0];
      console.log(`  ${w.word.padEnd(15)} → ${topHeard.padEnd(15)} (${topCount}/${w.wrong}회, ${((topCount/w.wrong)*100).toFixed(0)}% 일관)`);
    });
  }

  console.log('\n— 권장 액션 —');
  if (homophoneCandidates.length >= 3) {
    console.log('  ⚠ 동음이의어/유사발음 패턴 다수 발견. Phonetic 매칭 (Metaphone) 도입 권장.');
  } else if (totalWrong > 20) {
    console.log('  ⚠ 오답 다수. 단어별 케이스 분석 후 임계값 또는 dictionary 결정.');
  } else {
    console.log('  ✓ 데이터 부족. 베타 운영 더 진행 후 재분석.');
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
