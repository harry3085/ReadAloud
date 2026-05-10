// 진단: genQuestionSets / genTests 의 vocab 문제 세트에서 homophones 채워진 상태 확인
// - 단어별 동음이의어 등록 현황 dump
// - 특정 단어 검색 가능 (--word=piece)
// - 특정 학원 필터 (--academy=raloud2)
//
// 사용:
//   node scripts/diag/dump-homophones.js                    (전체 학원, 모든 vocab 세트)
//   node scripts/diag/dump-homophones.js --academy=raloud2  (학원 필터)
//   node scripts/diag/dump-homophones.js --word=piece       (단어 검색 — 어떤 세트에 있는지)
//   node scripts/diag/dump-homophones.js --missing-only     (homophones 비어있는 세트만)

const { getDb } = require('../lib/firebase-admin');

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));

  const db = getDb();
  console.log('\n=== 단어시험 동음이의어 채움 현황 ===\n');
  if (args.academy) console.log(`(필터) academyId = ${args.academy}`);
  if (args.word) console.log(`(검색) word = ${args.word}`);
  if (args['missing-only']) console.log('(필터) homophones 비어있는 단어만');
  console.log();

  // genQuestionSets — vocab 세트만
  let qRef = db.collection('genQuestionSets').where('sourceType', '==', 'vocab');
  if (args.academy) qRef = qRef.where('academyId', '==', args.academy);
  const snap = await qRef.get();
  console.log(`vocab 세트 ${snap.size}건 스캔\n`);

  let totalWords = 0;
  let withHomophones = 0;
  let totalHomoCount = 0;
  const wordSearchResults = [];

  for (const d of snap.docs) {
    const data = d.data();
    const questions = data.questions || [];
    const setHomoCount = questions.filter(q => Array.isArray(q.homophones) && q.homophones.length > 0).length;
    const hasHomos = setHomoCount > 0;

    if (args['missing-only'] && hasHomos) continue;

    if (args.word) {
      // 특정 단어 검색
      const matches = questions.filter(q =>
        String(q.word || '').toLowerCase().includes(args.word.toLowerCase())
      );
      if (matches.length) {
        wordSearchResults.push({
          setId: d.id,
          setName: data.name || '(이름 없음)',
          academyId: data.academyId || '?',
          createdAt: data.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || '?',
          aiModel: data.aiModel || '?',
          words: matches.map(q => ({
            word: q.word,
            homophones: Array.isArray(q.homophones) ? q.homophones : [],
          })),
        });
      }
      continue;
    }

    // 일반 dump
    console.log(`📦 ${data.name || '(이름 없음)'} [${data.academyId || '?'}]`);
    console.log(`   id: ${d.id} · 생성: ${data.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || '?'} · 모델: ${data.aiModel || '?'}`);
    console.log(`   단어 ${questions.length}개 중 ${setHomoCount}개에 동음이의어 등록`);
    if (hasHomos && !args['missing-only']) {
      questions
        .filter(q => Array.isArray(q.homophones) && q.homophones.length > 0)
        .slice(0, 10)
        .forEach(q => {
          console.log(`     • ${q.word} → [${q.homophones.join(', ')}]`);
        });
      if (setHomoCount > 10) console.log(`     ... 외 ${setHomoCount - 10}개`);
    }
    console.log();

    totalWords += questions.length;
    totalHomoCount += setHomoCount;
    if (hasHomos) withHomophones++;
  }

  if (args.word) {
    if (!wordSearchResults.length) {
      console.log(`'${args.word}' 검색 결과 없음`);
    } else {
      console.log(`'${args.word}' 검색 결과 — ${wordSearchResults.length} 세트\n`);
      wordSearchResults.forEach(r => {
        console.log(`📦 ${r.setName} [${r.academyId}]`);
        console.log(`   id: ${r.setId} · 생성: ${r.createdAt} · 모델: ${r.aiModel}`);
        r.words.forEach(w => {
          const homo = w.homophones.length ? `[${w.homophones.join(', ')}]` : '❌ (동음이의어 없음)';
          console.log(`   • ${w.word} → ${homo}`);
        });
        console.log();
      });
    }
  } else {
    console.log('=== 요약 ===');
    console.log(`총 세트: ${snap.size} (동음이의어 1개 이상 있는 세트: ${withHomophones})`);
    console.log(`총 단어: ${totalWords} · 동음이의어 등록 단어: ${totalHomoCount}`);
    if (totalWords > 0) {
      console.log(`커버리지: ${(totalHomoCount / totalWords * 100).toFixed(1)}%`);
    }
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
