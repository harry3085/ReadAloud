// 객관식 시험 후처리 모듈 — AI 생성 결과의 자주 발생하는 오류 자동 보정
//
// 적용 시점: api/generate-quiz.js validateMCQ 직후
// 효과:
//   - a/an 정답 자동 보정 (artificial, hour, university 등 — AI 가 자주 실수)
//   - choices 셔플로 결과 모달 정답 위치 편향 제거
//
// 향후 확장 여지: 시제·조동사·주어동사 일치 등 같은 패턴으로 검증 함수 추가 가능
// 모든 검증 함수는 (q) → q 형태로 통일 — chain 으로 연결 쉬움

// ─── 1) 모음 소리 판정 ───
// 영어 발음 기반 a/an 결정. 일반 규칙 + 예외 사전.
//
// 입력: 영어 단어 (구두점·공백 trim 후 lowercase 처리됨)
// 출력: true (an 사용) / false (a 사용) / null (판단 불가)

// 모음 소리 시작 (an 사용) — 자음 글자지만 모음으로 발음
// .startsWith() 매칭이라 derived form 도 포함 (honestly, fbi-related 등)
const AN_EXCEPTIONS = [
  'hour', 'honest', 'honor', 'heir',
  'mvp', 'fbi', 'x-ray', 'sos', 'mri', 'nba', 'nfl', 'sat', 'fyi',
];

// 자음 소리 시작 (a 사용) — 모음 글자지만 자음으로 발음
const A_EXCEPTIONS = [
  'university', 'uniform', 'useful', 'unique', 'user', 'usual', 'utopia',
  'european', 'europe', 'one', 'once',
  'year', 'young', 'yellow', 'yesterday',
];

function shouldUseAn(nextWord) {
  if (!nextWord || typeof nextWord !== 'string') return null;
  // 소문자 변환 + 구두점 제거
  const w = nextWord.toLowerCase().replace(/[.,!?;:]/g, '').trim();
  if (!w) return null;

  // 예외 우선 체크 (.startsWith — derived form 까지 커버)
  if (AN_EXCEPTIONS.some(ex => w.startsWith(ex))) return true;
  if (A_EXCEPTIONS.some(ex => w.startsWith(ex))) return false;

  // 일반 규칙
  const c = w[0];
  if (c === 'a' || c === 'e' || c === 'i' || c === 'o') return true;
  if (c === 'u') return true;  // 예외에 안 걸렸으면 일반 u 는 모음 소리 (umbrella)
  return false;
}

// ─── 2) a/an 정답 자동 보정 ───
// AI 가 'a artificial' 같이 잘못 생성하면 'an artificial' 로 수정
//
// 입력/출력: question 객체 (4 choices 중 a/an 둘 다 있는 경우만 처리)
// 부수효과: console.warn 으로 보정 내역 로깅

function validateAndFixArticleQuestion(question) {
  if (!question || !Array.isArray(question.choices)) return question;

  // a / an 둘 다 보기에 있을 때만 처리 (없으면 a/an 정답 묻는 문제 X)
  const hasA = question.choices.some(c => (c.text || '').trim().toLowerCase() === 'a');
  const hasAn = question.choices.some(c => (c.text || '').trim().toLowerCase() === 'an');
  if (!hasA || !hasAn) return question;

  // 빈칸 다음 단어 추출
  const m = (question.question || '').match(/_+\s+(\S+)/);
  if (!m || !m[1]) return question;
  const nextWord = m[1];

  const useAn = shouldUseAn(nextWord);
  if (useAn === null) return question;

  // 현재 정답 확인 (a 또는 an 인 경우만)
  const currentAnswer = question.choices.find(c => c.isAnswer === true);
  if (!currentAnswer) return question;
  const currentText = (currentAnswer.text || '').trim().toLowerCase();
  if (currentText !== 'a' && currentText !== 'an') return question;  // the/X 정답이면 X

  const correctText = useAn ? 'an' : 'a';
  if (currentText === correctText) return question;  // 이미 맞음

  // 보정 — a/an choice 의 isAnswer 만 토글, the/X 는 그대로
  const fixed = {
    ...question,
    choices: question.choices.map(c => {
      const t = (c.text || '').trim().toLowerCase();
      if (t === 'a') return { ...c, isAnswer: correctText === 'a' };
      if (t === 'an') return { ...c, isAnswer: correctText === 'an' };
      return c;
    }),
    _autoFixed: true,  // 서버 응답에 카운트 위해 마커
  };
  console.warn(`[자동보정] "${nextWord}" 의 정답: ${currentText} → ${correctText}`);
  return fixed;
}

// ─── 3) 선택지 셔플 (Fisher-Yates) ───
// 결과 모달에서 정답 위치 편향 제거. 응시·인쇄 시 또 셔플되지만 무관.
function shuffleChoices(question) {
  if (!question || !Array.isArray(question.choices) || question.choices.length < 2) {
    return question;
  }
  const choices = question.choices.slice();
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { ...question, choices };
}

// ─── 4) 메인 후처리 ───
// 입력: { questions: [...] } 형태 (validateMCQ 결과)
// 출력: { questions, autoFixedCount } — 보정 건수 포함 (응답에서 학원장 안내용)
//
// 처리 순서 (중요):
//   1. validateAndFixArticleQuestion 먼저 (셔플 전 — a/an 매칭 단순)
//   2. shuffleChoices (보정 끝난 후 위치 무작위)
function postProcessMCQ(questions) {
  if (!Array.isArray(questions)) return { questions: [], autoFixedCount: 0 };
  let autoFixedCount = 0;
  const processed = questions.map(q => {
    const fixed = validateAndFixArticleQuestion(q);
    if (fixed._autoFixed) {
      autoFixedCount++;
      delete fixed._autoFixed;  // 마커 제거 (응답엔 카운트만)
    }
    return shuffleChoices(fixed);
  });
  return { questions: processed, autoFixedCount };
}

module.exports = {
  shouldUseAn,
  validateAndFixArticleQuestion,
  shuffleChoices,
  postProcessMCQ,
};
