// 진단: scores 컬렉션의 mode 값 분포 확인.
// _TYPE_LABEL_MAP (vocab/fill_blank/unscramble/mcq/subjective/recording) 외 값을
// 가진 doc 을 찾아 카운트·샘플링. 학원장 화면에서 유형 배지가 '-' 로 보이는 원인.
//
// 사용:
//   node scripts/diag/check-score-mode-values.js
//
// 옵션:
//   --academy=ID    특정 학원만 (default: 전체)

const { getDb } = require('../lib/firebase-admin');

const STANDARD_KEYS = new Set(['vocab', 'fill_blank', 'unscramble', 'mcq', 'subjective', 'recording']);

(async () => {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.split('='); return [k.replace(/^--/, ''), v ?? true];
  }));

  const db = getDb();
  console.log('\n=== scores.mode 값 분포 진단 ===\n');

  let queryRef = db.collection('scores');
  if (args.academy) {
    queryRef = queryRef.where('academyId', '==', args.academy);
    console.log(`(필터) academyId = ${args.academy}\n`);
  }

  const snap = await queryRef.get();
  console.log(`총 ${snap.size}건 조회\n`);

  const dist = {};               // value → count
  const unknownSamples = [];     // 표준 키 외 값 샘플
  const noModeSamples = [];      // mode 자체가 빈/falsy 값

  snap.forEach(d => {
    const data = d.data();
    const m = data.mode;
    const key = (m === undefined || m === null || m === '') ? '(없음/빈값)' : String(m);
    dist[key] = (dist[key] || 0) + 1;

    if (key === '(없음/빈값)') {
      if (noModeSamples.length < 5) {
        noModeSamples.push({ id: d.id, raw: m, academyId: data.academyId, date: data.date, testName: data.testName });
      }
    } else if (!STANDARD_KEYS.has(key)) {
      if (unknownSamples.length < 10) {
        unknownSamples.push({
          id: d.id, mode: key,
          academyId: data.academyId,
          date: data.date,
          testName: data.testName,
          uid: data.uid?.slice(0, 8),
        });
      }
    }
  });

  // 정렬 — 표준 키 먼저, 그 다음 알 수 없는 값
  const standardEntries = [];
  const unknownEntries = [];
  const blankEntry = [];
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    if (k === '(없음/빈값)') blankEntry.push([k, v]);
    else if (STANDARD_KEYS.has(k)) standardEntries.push([k, v]);
    else unknownEntries.push([k, v]);
  });

  console.log('— 표준 키 (정상) —');
  if (standardEntries.length === 0) console.log('  (없음)');
  standardEntries.forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${String(v).padStart(6)} 건  ✓`));

  console.log('\n— 알 수 없는 값 (배지 "-" 로 표시됨) —');
  if (unknownEntries.length === 0) console.log('  (없음) ✓ 모든 mode 값이 표준 키');
  unknownEntries.forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${String(v).padStart(6)} 건  ⚠`));

  if (blankEntry.length) {
    console.log('\n— mode 필드 자체가 비어있음 —');
    blankEntry.forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${String(v).padStart(6)} 건  ⚠`));
  }

  if (unknownSamples.length > 0) {
    console.log('\n— 알 수 없는 mode 샘플 (최대 10개) —');
    unknownSamples.forEach(s => console.log(' ', s));
  }
  if (noModeSamples.length > 0) {
    console.log('\n— mode 비어있는 doc 샘플 —');
    noModeSamples.forEach(s => console.log(' ', s));
  }

  // 권장 액션
  console.log('\n— 권장 액션 —');
  if (unknownEntries.length === 0 && blankEntry.length === 0) {
    console.log('  ✓ 정상. 만약 화면에 "-" 가 보이면 다른 원인 확인 필요.');
  } else {
    console.log('  ⚠ 마이그레이션 또는 라벨 매핑 추가 검토 필요.');
    console.log('  - 레거시 키 (word, reading-mcq, fill-blank, recording-ai) → 표준 키 대응표 작성');
    console.log('  - subj / blank / rec-ai 등 별칭이면 _TYPE_LABEL_MAP 에 이미 있음 (확인)');
  }

  process.exit(0);
})().catch(e => { console.error('\n[error]', e); process.exit(1); });
