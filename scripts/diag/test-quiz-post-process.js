// 진단: api/_lib/quiz-post-process.js 동작 검증
//
// 사용:
//   node scripts/diag/test-quiz-post-process.js
//
// 6 케이스:
//   1. artificial — a → an 자동 보정
//   2. university — an → a 자동 보정
//   3. hour — a → an (silent h)
//   4. the 정답 — 손대지 않음
//   5. 셔플 분포 (100회)
//   6. 잘못된 입력 방어

const { shouldUseAn, validateAndFixArticleQuestion, shuffleChoices, postProcessMCQ } = require('../../api/_lib/quiz-post-process');

let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) { console.log('  ✓ ' + label); pass++; }
  else { console.log('  ✗ ' + label); fail++; }
}

function findAnswer(q) { return q.choices.find(c => c.isAnswer === true); }

// ─── 1. artificial: a → an ───
console.log('\n[1] artificial 케이스 (a → an)');
{
  const input = {
    question: 'A light bulb is ___ artificial source.',
    choices: [
      { text: 'a', isAnswer: true },
      { text: 'an', isAnswer: false },
      { text: 'the', isAnswer: false },
      { text: 'X', isAnswer: false },
    ],
  };
  const fixed = validateAndFixArticleQuestion(input);
  const ans = findAnswer(fixed);
  assert(ans && ans.text === 'an', '정답이 an 으로 보정됨');
  assert(fixed._autoFixed === true, '_autoFixed 마커 박힘');
}

// ─── 2. university: an → a ───
console.log('\n[2] university 케이스 (an → a)');
{
  const input = {
    question: 'She is ___ university student.',
    choices: [
      { text: 'a', isAnswer: false },
      { text: 'an', isAnswer: true },
      { text: 'the', isAnswer: false },
      { text: 'X', isAnswer: false },
    ],
  };
  const fixed = validateAndFixArticleQuestion(input);
  const ans = findAnswer(fixed);
  assert(ans && ans.text === 'a', '정답이 a 로 보정됨 (u 자음 소리)');
}

// ─── 3. hour: a → an (silent h) ───
console.log('\n[3] hour 케이스 (a → an)');
{
  const input = {
    question: 'We waited for ___ hour.',
    choices: [
      { text: 'a', isAnswer: true },
      { text: 'an', isAnswer: false },
      { text: 'the', isAnswer: false },
      { text: 'X', isAnswer: false },
    ],
  };
  const fixed = validateAndFixArticleQuestion(input);
  const ans = findAnswer(fixed);
  assert(ans && ans.text === 'an', '정답이 an 으로 보정됨 (silent h)');
}

// ─── 4. the 정답 — 손대지 않음 ───
console.log('\n[4] the 정답 — 보정 X');
{
  const input = {
    question: 'I have a cat. ___ cat is cute.',
    choices: [
      { text: 'a', isAnswer: false },
      { text: 'an', isAnswer: false },
      { text: 'the', isAnswer: true },
      { text: 'X', isAnswer: false },
    ],
  };
  const fixed = validateAndFixArticleQuestion(input);
  const ans = findAnswer(fixed);
  assert(ans && ans.text === 'the', '정답이 the 그대로 유지');
  assert(!fixed._autoFixed, '_autoFixed 마커 없음');
}

// ─── 5. 셔플 분포 (정답 위치 1~4 균등) ───
console.log('\n[5] 셔플 분포 — 100회 중 정답 위치');
{
  const input = {
    question: 'Test',
    choices: [
      { text: 'A', isAnswer: true },
      { text: 'B', isAnswer: false },
      { text: 'C', isAnswer: false },
      { text: 'D', isAnswer: false },
    ],
  };
  const positions = [0, 0, 0, 0];
  for (let i = 0; i < 100; i++) {
    const out = shuffleChoices(input);
    const idx = out.choices.findIndex(c => c.isAnswer);
    positions[idx]++;
  }
  console.log('    위치별 횟수: 1=' + positions[0] + ' / 2=' + positions[1] + ' / 3=' + positions[2] + ' / 4=' + positions[3]);
  // 균등 분포 — 각 위치 10건 이상 (대략 25%)
  const allReached = positions.every(c => c >= 10);
  assert(allReached, '4 위치 모두 10건 이상 (편향 없음)');
}

// ─── 6. 잘못된 입력 방어 ───
console.log('\n[6] 잘못된 입력 방어');
{
  let r;
  r = postProcessMCQ(null);
  assert(Array.isArray(r.questions) && r.questions.length === 0, 'null → 빈 배열');

  r = postProcessMCQ([]);
  assert(Array.isArray(r.questions) && r.questions.length === 0, '빈 배열 → 빈 배열');

  // shouldUseAn
  assert(shouldUseAn('artificial') === true, 'shouldUseAn(artificial) → true');
  assert(shouldUseAn('university') === false, 'shouldUseAn(university) → false');
  assert(shouldUseAn('hour') === true, 'shouldUseAn(hour) → true');
  assert(shouldUseAn('house') === false, 'shouldUseAn(house) → false');
  assert(shouldUseAn('one') === false, 'shouldUseAn(one) → false (자음 소리)');
  assert(shouldUseAn('umbrella') === true, 'shouldUseAn(umbrella) → true');
  assert(shouldUseAn('') === null, 'shouldUseAn(빈 문자열) → null');
}

// ─── postProcessMCQ 통합 ───
console.log('\n[통합] postProcessMCQ 자동 보정 카운트');
{
  const arr = [
    { question: 'A is ___ artificial light.', choices: [{text:'a',isAnswer:true},{text:'an',isAnswer:false},{text:'the',isAnswer:false},{text:'X',isAnswer:false}] },
    { question: 'She is ___ university student.', choices: [{text:'a',isAnswer:false},{text:'an',isAnswer:true},{text:'the',isAnswer:false},{text:'X',isAnswer:false}] },
    { question: 'I saw ___ apple.', choices: [{text:'a',isAnswer:false},{text:'an',isAnswer:true},{text:'the',isAnswer:false},{text:'X',isAnswer:false}] },  // 이미 정답
  ];
  const r = postProcessMCQ(arr);
  assert(r.autoFixedCount === 2, '자동 보정 2건 (artificial + university)');
}

console.log('\n=== 결과 ===');
console.log('통과: ' + pass + ' / 실패: ' + fail);
process.exit(fail > 0 ? 1 : 0);
