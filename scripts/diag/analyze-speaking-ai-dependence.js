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
// spkSource 값: 'webspeech'(1·2차 통과/스킵) | 'ai'(3차 AI 응답) | 'ai-error'(3차 AI 서버오류)
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
  const src = { webspeech: 0, ai: 0, 'ai-error': 0, other: 0 };
  const attemptDist = { 1: 0, 2: 0, 3: 0, other: 0 };
  let totalSpeakingAns = 0;
  let aiCorrect = 0, aiWrong = 0;
  let scannedComps = 0, skippedByDate = 0;
  const wordToAi = {};   // word → AI 까지 간 횟수 (어떤 단어가 AI 의존 높은지)

  for (const t of speakingTests) {
    const ucSnap = await db.collection('genTests').doc(t.id).collection('userCompleted').get();
    for (const uc of ucSnap.docs) {
      const c = uc.data();
      const ymd = _compYmd(c);
      if (!inRange(ymd)) { skippedByDate++; continue; }
      const answers = Array.isArray(c.answers) ? c.answers : [];
      if (!answers.length) continue;
      scannedComps++;
      for (const a of answers) {
        if (!a || a.format !== 'speaking') continue;
        totalSpeakingAns++;
        const sCount = parseInt(a.spkAttempts);
        if (sCount === 1 || sCount === 2 || sCount === 3) attemptDist[sCount]++;
        else attemptDist.other++;
        const s = a.spkSource || 'other';
        if (s === 'webspeech') src.webspeech++;
        else if (s === 'ai') src.ai++;
        else if (s === 'ai-error') src['ai-error']++;
        else src.other++;
        if (s === 'ai' || s === 'ai-error') {
          const w = String(a._word || a.word || '').toLowerCase().trim();
          if (w) wordToAi[w] = (wordToAi[w] || 0) + 1;
          if (a.spkCorrect) aiCorrect++; else aiWrong++;
        }
      }
    }
  }

  const pct = (n) => totalSpeakingAns ? (n / totalSpeakingAns * 100).toFixed(1) + '%' : '0%';
  const aiTotal = src.ai + src['ai-error'];

  console.log(`스캔된 통과 응시(userCompleted): ${scannedComps}건` + (skippedByDate ? ` (기간 밖 제외 ${skippedByDate}건)` : ''));
  console.log(`말하기 답안 총합: ${totalSpeakingAns}개\n`);

  console.log('── 판정 경로 비율 (핵심 지표) ──');
  console.log(`  1·2차 Web Speech 해결 : ${src.webspeech}  (${pct(src.webspeech)})`);
  console.log(`  3차 AI 도달          : ${aiTotal}  (${pct(aiTotal)})  ← 503 에 노출되는 비율`);
  console.log(`     └ AI 응답 성공     : ${src.ai}  (${pct(src.ai)})`);
  console.log(`     └ AI 서버오류      : ${src['ai-error']}  (${pct(src['ai-error'])})`);
  console.log(`  기타/레거시(미상)    : ${src.other}  (${pct(src.other)})`);
  console.log('');
  console.log('── 시도 횟수 분포 ──');
  console.log(`  1회 통과: ${attemptDist[1]}  /  2회: ${attemptDist[2]}  /  3회(AI): ${attemptDist[3]}  /  기타: ${attemptDist.other}`);
  console.log('');
  if (aiTotal) {
    console.log('── AI 경로 채점 결과 ──');
    console.log(`  정답: ${aiCorrect}  /  오답: ${aiWrong}`);
    console.log('');
  }

  const aiWords = Object.entries(wordToAi).sort((a, b) => b[1] - a[1]).slice(0, top);
  if (aiWords.length) {
    console.log(`── AI 까지 가장 자주 간 단어 Top ${aiWords.length} ──`);
    for (const [w, n] of aiWords) console.log(`  ${w} : ${n}`);
    console.log('');
  }

  console.log('── 해석 가이드 ──');
  console.log('  · 3차 AI 도달 비율이 낮으면(예: <10%) 503 영향은 소수 케이스 — 현 안전망(9초+재시도)으로 충분');
  console.log('  · 비율이 높으면(예: >25%) 503 추세 시 폴백 재배치/채점 방식 재검토 우선순위 ↑');
  console.log('  · 정확한 503·타임아웃 절대 빈도는 Vercel 로그/Cloud Console 과 함께 보세요');
  console.log('');
  process.exit(0);
})().catch(e => { console.error('진단 실패:', e); process.exit(1); });
