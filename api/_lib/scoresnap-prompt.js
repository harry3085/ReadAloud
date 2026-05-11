// ScoreSnap — Gemini Vision 채점 프롬프트 빌더 + 응답 후처리
// 핵심: 시험 구조(질문·선지·정답)를 텍스트로 명시해주고 학생 답만 추출.
// 정답지 OCR 불필요 — questions 이 이미 genTests 에 박혀있어 그대로 사용.

const _CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

// 객관식 정답 인덱스 — choices 배열 안 isAnswer=true 위치 (없으면 -1)
function _findMcqAnswerIdx(q) {
  if (!Array.isArray(q.choices)) return -1;
  return q.choices.findIndex(c =>
    (typeof c === 'object' && (c.isAnswer === true)) ||
    (typeof c === 'string' && c === q.answer)
  );
}

// 한 문항을 프롬프트 라인으로 변환
function _formatQuestionLine(q, idx) {
  const n = idx + 1;
  const type = (q.type || q.questionType || '').toLowerCase();

  // 객관식
  if (type === 'mcq' || Array.isArray(q.choices)) {
    const choices = (q.choices || []).map((c, j) => {
      const text = typeof c === 'object' ? (c.text || c.choice || '') : String(c);
      return `${_CIRCLED[j] || (j + 1)} ${text}`;
    }).join(' ');
    const answerIdx = _findMcqAnswerIdx(q);
    const answerMark = answerIdx >= 0 ? (_CIRCLED[answerIdx] || `(${answerIdx + 1})`) : '(?)';
    const stem = q.question || q.prompt || q.sentence || '';
    return `Q${n} [MCQ] "${stem}"\n   ${choices}\n   → 정답: ${answerMark}`;
  }

  // 빈칸채우기 / 단어시험 / 주관식 — 학생이 손글씨로 작성
  const stem = q.question || q.prompt || q.sentence || q.word || q.text || '';
  // 정답 문자열 추출 (필드명 다양)
  const answer = q.answer
    || (Array.isArray(q.blanks) ? q.blanks.join(' / ') : '')
    || q.correctAnswer
    || q.meaning
    || '';
  const typeLabel = type === 'fill_blank' ? 'FILL'
                  : type === 'vocab'      ? 'VOCAB'
                  : type === 'subjective' ? 'SUBJ'
                  : type === 'unscramble' ? 'UNSCR'
                  : 'SHORT';
  return `Q${n} [${typeLabel}] "${stem}" → 정답: "${answer}"`;
}

// 시험 questions 배열 → Gemini Vision 프롬프트
function buildGradingPrompt(questions) {
  const lines = (questions || []).map(_formatQuestionLine).join('\n\n');

  return `첨부: 학생 답안지 한 장 (사진).

시험 구조는 이미 알고 있으니 그대로 사용:

${lines}

작업: 사진에서 각 문항의 학생 답만 추출해서 정답과 비교.

규칙:
- MCQ: 학생이 동그라미·체크·V표시 친 번호(①②③④)를 식별
- FILL/VOCAB/SUBJ/UNSCR/SHORT: 학생이 줄 위에 손글씨로 적은 글자 그대로 추출
- 단답 채점: 대소문자 무시, 공백·문장부호 무시, 동의어 인정 X (정답과 정확 일치)
- 학생이 아무것도 안 썼거나 판독 불가하면 studentAnswer 빈 문자열, confidence 0.3 이하
- 정답이 위에 명시되어 있다고 해서 그걸 학생 답으로 넘겨주지 말 것
- 시험 구조에 없는 문항을 만들어내지 말 것 (questions 수와 정확히 일치)

응답 JSON 만 출력. 서문·설명 없이:

{
  "answers": [
    {
      "no": 1,
      "type": "mcq" or "short",
      "studentAnswer": "...",
      "correctAnswer": "...",
      "isCorrect": true|false,
      "confidence": 0.0~1.0
    }
  ],
  "uncertainQuestions": [confidence 0.8 미만 문항 번호]
}`;
}

// Gemini 응답 → 클라이언트가 쓰기 좋은 형태로 정제
// - totalScore/correctCount 는 AI 신뢰 X → isCorrect 배열로 직접 카운트
// - confidence < 0.9 항목 자동으로 uncertainQuestions 에 보강
// - 빈 답 + 높은 confidence 의심 패턴 보정
function postProcessGradingResult(rawResult, expectedCount) {
  if (!rawResult || !Array.isArray(rawResult.answers)) {
    return {
      answers: [],
      correctCount: 0,
      totalQuestions: expectedCount || 0,
      scorePercent: 0,
      wrongNumbers: [],
      uncertainQuestions: [],
      error: '응답 형식 오류',
    };
  }

  // 안전 캡 — AI 가 questions 보다 많이 만들었으면 잘라냄
  let answers = rawResult.answers.slice(0, expectedCount || rawResult.answers.length);

  // 부족하면 빈 답으로 채움 (학생이 답 안 쓴 케이스로 처리)
  while (expectedCount && answers.length < expectedCount) {
    answers.push({
      no: answers.length + 1,
      type: 'short',
      studentAnswer: '',
      correctAnswer: '',
      isCorrect: false,
      confidence: 0.3,
    });
  }

  // no 필드 정규화 (1부터 순서대로)
  answers = answers.map((a, i) => ({
    no: i + 1,
    type: a.type || 'short',
    studentAnswer: String(a.studentAnswer || '').trim(),
    correctAnswer: String(a.correctAnswer || '').trim(),
    isCorrect: a.isCorrect === true,
    confidence: typeof a.confidence === 'number' ? Math.max(0, Math.min(1, a.confidence)) : 0.5,
  }));

  // 빈 답 + 높은 confidence 보정 — AI 가 못 봤는데 확신한 경우 의심
  answers.forEach(a => {
    if (!a.studentAnswer && a.confidence > 0.5) {
      a.confidence = 0.3;
    }
  });

  // uncertainQuestions — AI 가 준 것 + confidence<0.9 자동 보강
  const uncertain = new Set(Array.isArray(rawResult.uncertainQuestions) ? rawResult.uncertainQuestions : []);
  answers.forEach(a => {
    if (a.confidence < 0.9) uncertain.add(a.no);
  });

  const correctCount = answers.filter(a => a.isCorrect).length;
  const totalQuestions = answers.length;

  return {
    answers,
    correctCount,
    totalQuestions,
    scorePercent: totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0,
    wrongNumbers: answers.filter(a => !a.isCorrect).map(a => a.no),
    uncertainQuestions: Array.from(uncertain).sort((a, b) => a - b),
  };
}

module.exports = { buildGradingPrompt, postProcessGradingResult };
