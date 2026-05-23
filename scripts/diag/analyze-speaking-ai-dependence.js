// 진단: 단어 말하기 — AI(check-word) 의존 비율 + 503/에러 영향 측정
//
// 목적: "단어 말하기 응답 중 몇 %가 3차 AI까지 가는가" + "그 AI 경로의 에러 비율"
//   을 숫자로 보고, 폴백 재배치/채점 방식 손질 여부를 감이 아닌 데이터로 결정.
//
// 데이터 한계 (CLAUDE.md 작업규칙 7):
//   userCompleted 는 "최고점 통과 응시"만 questions/answers 스냅샷 저장.
//   → 미통과/재응시 분은 안 잡힘. 비율은 "통과 응시 기준 표본 추정치".
//   타임아웃(B-1) 케이스는 finalize 안 되어 answers 에 미기록 → 여기 안 잡힘.
//   503/타임아웃의 정확한 절대 빈도는 Vercel 로그/Cloud Console 이 정확.
//   이 스크립트는 "AI 의존도(=503에 노출되는 비율)" 추정용.
//
// spkSource 값 (2026-05-23 신 흐름):
//   'webspeech-1' = 1차 영어 STT 통과
//   'webspeech-2' = 2차 한국어 STT 통과 (한글 발음표기 매칭)
//   'webspeech-3' = 3차 빈칸 문장 STT 통과
// 옛 값 (호환):
//   'webspeech' = 1·2차 Web Speech 통과 (옛 흐름)
//   'ai'        = 3차 AI(check-word) 응답 통과
//   'ai-error'  = 3차 AI 서버오류
//
// 사용:
//   node scripts/diag/analyze-speaking-ai-dependence.js
//   node scripts/diag/analyze-speaking-ai-dependence.js --days=7
//   node scripts/diag/analyze-speaking-ai-dependence.js --from=2026-05-12 --to=2026-05-18
//   node scripts/diag/analyze-speaking-ai-dependence.js --academy=raloud2 --days=14
//   node scripts/diag/analyze-speaking-ai-dependence.js --top=30

const { getDb } = require('../lib/firebase-admin');

// UTC Date → KST 'YYYY-MM-DD'
function _ymdKST(d) {
  if (!d) return '';
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}

// userCompleted 문서의 응시 일자 (KST 'YYYY-MM-DD') — completedAt > latestAt > date
function _compYmd(c) {
  const ts = c.completedAt || c.latestAt;
  if (ts && typeof ts.toDate === 'function') return _ymdKST(ts.toDate());
  if (typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.date)) return c.date.slice(0, 10);
  return '';
}

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));
  const top = parseInt(args.top) || 20;

  // 기간 범위 결정 (KST 'YYYY-MM-DD' 문자열 비교)
  let fromYmd = '', toYmd = '';
  if (args.from) fromYmd = String(args.from).slice(0, 10);
  if (args.to) toYmd = String(args.to).slice(0, 10);
  if (!fromYmd && args.days) {
    const n = parseInt(args.days);
    if (isFinite(n) && n > 0) {
      const now = new Date();
      fromYmd = _ymdKST(new Date(now.getTime() - (n - 1) * 24 * 3600 * 1000));
      toYmd = _ymdKST(now);
    }
  }
  const inRange = (ymd) => {
    if (!ymd) return !(fromYmd || toYmd);   // 날짜 없는 doc 은 기간 지정 시 제외
    if (fromYmd && ymd < fromYmd) return false;
    if (toYmd && ymd > toYmd) return false;
    return true;
  };

  const db = getDb();
  console.log('\n=== 단어 말하기 AI 의존 비율 진단 ===\n');
  if (args.academy) console.log(`(필터) academyId = ${args.academy}`);
  if (fromYmd || toYmd) console.log(`(기간) ${fromYmd || '처음'} ~ ${toYmd || '오늘'} (KST)`);
  else console.log('(기간) 전체');
  console.log('');

  // 1) 말하기 시험 찾기
  let qRef = db.collection('genTests').where('testMode', '==', 'vocab');
  if (args.academy) qRef = qRef.where('academyId', '==', args.academy);
  const testsSnap = await qRef.get();
  const speakingTests = testsSnap.docs.filter(d => d.data().vocabOptions?.format === 'speaking');
  console.log(`vocab 시험 ${testsSnap.size}건 중 말하기 시험: ${speakingTests.length}건\n`);
  if (!speakingTests.length) { console.log('데이터 없음'); process.exit(0); }

  // 2) userCompleted 스캔 + answers(format='speaking') 집계
  // 신 흐름(2026-05-23~): webspeech-1/2/3 / 옛 흐름: webspeech / ai / ai-error
  const src = { 'webspeech-1': 0, 'webspeech-2': 0, 'webspeech-3': 0, webspeech: 0, ai: 0, 'ai-error': 0, other: 0 };
  const attemptDist = { 1: 0, 2: 0, 3: 0, other: 0 };
  let totalSpeakingAns = 0;
  let aiCorrect = 0, aiWrong = 0;
  let scannedComps = 0, skippedByDate = 0;
  const wordToAi = {};   // word → AI 까지 간 횟수 (옛 흐름 데이터만 — 신 흐름엔 AI 없음)
  let hintUsedTotal = 0, hintUsedCount = 0;  // 신 흐름 힌트 사용 (점수 영향 X, 학습 보조)

  for (const t of speakingTests) {
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    for (const uc of ucSnap.docs) {
      const c = uc.data();
      const ymd = _compYmd(c);
      if (!inRange(ymd)) { skippedByDate++; continue; }
      const answers = Array.isArray(c.answers) ? c.answers : [];
      const questions = Array.isArray(c.questions) ? c.questions : [];
      if (!answers.length) continue;
      scannedComps++;
      for (let i = 0; i < answers.length; i++) {
        const a = answers[i];
        if (!a || a.format !== 'speaking') continue;
        totalSpeakingAns++;
        const sCount = parseInt(a.spkAttempts);
        if (sCount === 1 || sCount === 2 || sCount === 3) attemptDist[sCount]++;
        else attemptDist.other++;
        const s = String(a.spkSource || 'other').toLowerCase();
        if (s === 'webspeech-1') src['webspeech-1']++;
        else if (s === 'webspeech-2') src['webspeech-2']++;
        else if (s === 'webspeech-3') src['webspeech-3']++;
        else if (s === 'webspeech') src.webspeech++;
        else if (s === 'ai') src.ai++;
        else if (s === 'ai-error') src['ai-error']++;
        else src.other++;
        if (s === 'ai' || s === 'ai-error') {
          const q = questions[i] || {};
          const w = String(a._word || a.word || q.word || '').toLowerCase().trim();
          if (w) wordToAi[w] = (wordToAi[w] || 0) + 1;
          if (a.spkCorrect) aiCorrect++; else aiWrong++;
        }
        // 신 흐름 힌트 사용 집계
        const hu = parseInt(a.spkHintUsed);
        if (isFinite(hu) && hu > 0) { hintUsedTotal += hu; hintUsedCount++; }
      }
    }
  }

  const pct = (n) => totalSpeakingAns ? (n / totalSpeakingAns * 100).toFixed(1) + '%' : '0%';
  const aiTotal = src.ai + src['ai-error'];
  const newFlowTotal = src['webspeech-1'] + src['webspeech-2'] + src['webspeech-3'];

  console.log(`스캔된 통과 응시(userCompleted): ${scannedComps}건` + (skippedByDate ? ` (기간 밖 제외 ${skippedByDate}건)` : ''));
  console.log(`말하기 답안 총합: ${totalSpeakingAns}개\n`);

  console.log('── 신 흐름 차수별 통과 분포 (2026-05-23~) ──');
  console.log(`  1차 영어 STT 통과     : ${src['webspeech-1']}  (${pct(src['webspeech-1'])})  ← 이상적 (정확한 발음)`);
  console.log(`  2차 한국어 STT 통과   : ${src['webspeech-2']}  (${pct(src['webspeech-2'])})  ← 한국식 발음으로라도 인식`);
  console.log(`  3차 빈칸 문장 통과    : ${src['webspeech-3']}  (${pct(src['webspeech-3'])})  ← 문장 안에서 매칭 (학습 보조)`);
  console.log(`     합계 (신 흐름)     : ${newFlowTotal}  (${pct(newFlowTotal)})`);
  console.log('');
  console.log('── 옛 흐름 (호환 데이터) ──');
  console.log(`  1·2차 Web Speech 해결 : ${src.webspeech}  (${pct(src.webspeech)})`);
  console.log(`  3차 AI 도달          : ${aiTotal}  (${pct(aiTotal)})  ← 503 에 노출되던 비율 (Phase 3 후 폐기)`);
  console.log(`     └ AI 응답 성공     : ${src.ai}  (${pct(src.ai)})`);
  console.log(`     └ AI 서버오류      : ${src['ai-error']}  (${pct(src['ai-error'])})`);
  console.log(`  기타/레거시(미상)    : ${src.other}  (${pct(src.other)})`);
  console.log('');
  console.log('── 시도 횟수 분포 ──');
  console.log(`  1회 통과: ${attemptDist[1]}  /  2회: ${attemptDist[2]}  /  3회: ${attemptDist[3]}  /  기타: ${attemptDist.other}`);
  console.log('');
  if (hintUsedCount) {
    console.log('── 힌트 사용 (신 흐름) ──');
    console.log(`  힌트 사용 답안: ${hintUsedCount}개 (${pct(hintUsedCount)})  /  평균 힌트 글자: ${(hintUsedTotal / hintUsedCount).toFixed(1)}`);
    console.log('');
  }
  if (aiTotal) {
    console.log('── 옛 AI 경로 채점 결과 ──');
    console.log(`  정답: ${aiCorrect}  /  오답: ${aiWrong}`);
    console.log('');
  }

  const aiWords = Object.entries(wordToAi).sort((a, b) => b[1] - a[1]).slice(0, top);
  if (aiWords.length) {
    console.log(`── 옛 흐름: AI 까지 자주 간 단어 Top ${aiWords.length} ──`);
    for (const [w, n] of aiWords) console.log(`  ${w} : ${n}`);
    console.log('');
  }

  console.log('── 해석 가이드 (신 흐름) ──');
  console.log('  · 1차 통과 비율이 높으면(예: >60%) 정확한 발음 학습 효과 좋음');
  console.log('  · 2차 통과 비율 ↑ = 학생들이 한국식 발음에 의존 — 영어 발음 코칭 필요');
  console.log('  · 3차 통과 비율 ↑ = 단어 단독 발음 어려움 — 빈칸 문장 학습 보조가 효과');
  console.log('  · 신 흐름은 AI 호출 0 — 503 위험 없음. 옛 흐름 비율은 시간 지나며 자연 감소');
  console.log('');
  process.exit(0);
})().catch(e => { console.error('진단 실패:', e); process.exit(1); });
