// ScoreSnap — Gemini Vision 프롬프트 빌더 + 응답 후처리 (정답지 OCR + 학생 채점)
//
// 새 워크플로우 (2026-05-11 재설계):
//   1) 정답지 1장 촬영 → buildAnswerKeyPrompt → questions 배열 OCR 추출
//   2) 학생 답안지 N장 → buildStudentGradePrompt → 학생답·이름 OCR + 채점
// 정답·문항을 Firestore 에서 안 가져옴 — 시험지 종이만 있으면 채점 가능.

// ─── 정답지 OCR 프롬프트 ───
// 학원장이 인쇄한 정답지(답지 보기 모드) 1 장을 보고 문제·정답 추출.
function buildAnswerKeyPrompt() {
  return `첨부: 정답이 표시된 시험지 1장 (인쇄지, 활자).

작업: 시험지 전체를 읽어 각 문항의 번호·문제·유형·정답·MCQ 보기 전부를 추출.

유형 식별:
- MCQ (객관식): 보기 ①②③④ 가 인쇄돼 있음. 정답 보기는 형광펜·동그라미·별표·밑줄 또는 별도 표시
- SHORT (주관식·단답·빈칸·단어·언스크램블·해석): 정답 문자열 그대로

★ MCQ 보기(choices) 추출 — 매우 중요:
- 시험지에 보기가 4개(또는 3·5개) 인쇄돼 있으면 그 개수만큼 choices 배열에 텍스트 채워. **누락 절대 금지**
- 보기 ①②③④ 옆에 인쇄된 모든 텍스트를 가능한 정확히 추출 (자동 채점에 사용)
- 보기 텍스트가 길거나 줄바꿈돼 있어도 한 줄로 합쳐서 모두 추출
- 보기 일부가 흐릿하거나 가려져 부분만 읽히면 부분이라도 채우고 그 문항 confidence 0.6 이하
- choices 배열 길이는 인쇄지의 실제 보기 개수와 정확히 일치 (보통 4)
- short 문항은 choices = []

정답 추출:
- MCQ: 표시된 보기의 위치(0=① 1=② 2=③ 3=④)를 answerIdx 에, 그 보기 텍스트를 answer 에 동시 채움
- SHORT: 정답 문자열 그대로 answer 필드
- 정답 표시가 명확하지 않으면 confidence 0.5 이하

기타:
- 문항이 분명히 N개 있는데 일부 읽지 못하면 빈 슬롯 채움 (no 보존)
- 시험지 헤더의 시험명·학원명도 추출 (선택)

응답 JSON 만 출력. 서문·설명 없이:

{
  "testName": "시험명 (헤더에서 추출, 없으면 빈 문자열)",
  "questions": [
    {
      "no": 1,
      "type": "mcq" or "short",
      "stem": "문제 텍스트",
      "choices": ["보기1", "보기2", "보기3", "보기4"],   // mcq 인 경우 인쇄지의 모든 보기, short 면 []
      "answerIdx": 1,                                    // mcq: 0~3, short 는 -1
      "answer": "정답 텍스트",                            // mcq 도 채움 (choices[answerIdx] 와 동일)
      "confidence": 0.0~1.0
    }
  ]
}`;
}

// 정답지 OCR 응답 → 정제
function postProcessAnswerKey(raw) {
  if (!raw || !Array.isArray(raw.questions)) {
    return { testName: '', questions: [], error: '응답 형식 오류' };
  }
  const questions = raw.questions.map((q, i) => ({
    no: i + 1,
    type: q.type === 'mcq' ? 'mcq' : 'short',
    stem: String(q.stem || '').trim(),
    choices: Array.isArray(q.choices) ? q.choices.map(c => String(c || '').trim()) : [],
    answerIdx: Number.isInteger(q.answerIdx) ? q.answerIdx : -1,
    answer: String(q.answer || '').trim(),
    confidence: typeof q.confidence === 'number' ? Math.max(0, Math.min(1, q.confidence)) : 0.5,
  }));
  return {
    testName: String(raw.testName || '').trim(),
    questions,
  };
}

// ─── 학생 답안지 채점 프롬프트 (정답지 + 학생 답안 비교) ───
// 정답지에서 추출된 questions 를 텍스트로 명시 + 학생 답안지 이미지 첨부.
// 시험지 레이아웃이 같으니 위치 매칭 자연스러움.
function buildStudentGradePrompt(answerKeyQuestions) {
  const lines = (answerKeyQuestions || []).map((q, i) => {
    const n = i + 1;
    if (q.type === 'mcq') {
      const choices = (q.choices || []).map((c, j) => {
        const mark = ['①', '②', '③', '④', '⑤'][j] || `(${j + 1})`;
        return `${mark} ${c}`;
      }).join(' ');
      return `Q${n} [MCQ] "${q.stem}"\n   ${choices}\n   → 정답 텍스트: "${q.answer}"`;
    }
    return `Q${n} [SHORT] "${q.stem}" → 정답: "${q.answer}"`;
  }).join('\n\n');

  return `첨부: 학생 답안지 한 장 (사진).

시험 구조 (정답지에서 이미 추출됨):

${lines}

작업:
1. 시험지 헤더의 "이름:" 옆에 학생이 쓴 손글씨 이름 추출
2. 각 문항에서 학생 답만 추출해서 정답과 비교

규칙:
- 학생 이름: 손글씨 그대로 (한글·영문). 빈칸·판독 불가면 빈 문자열
- MCQ: 학생이 동그라미·체크·V 표시 친 보기의 텍스트 추출 (인쇄된 보기 텍스트 그대로). 선지 위치보다 텍스트 매칭이 우선
- SHORT: 학생이 줄 위에 손글씨로 적은 글자 그대로 추출
- 단답 채점: 대소문자 무시, 공백·문장부호 무시, 동의어 X (정답과 정확 일치)
- 학생이 아무것도 안 썼거나 판독 불가하면 studentAnswer 빈 문자열, confidence 0.3 이하
- 정답이 위에 명시돼 있다고 그걸 학생 답으로 넘기지 말 것
- questions 수와 정확히 일치하는 answers 배열 반환

응답 JSON 만 출력. 서문·설명 없이:

{
  "studentName": "추출된 학생 이름 (없으면 빈 문자열)",
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

// 학생 채점 응답 → 정제 (기존 postProcessGradingResult 와 동일하되 studentName 보존)
function postProcessStudentGrade(raw, expectedCount) {
  if (!raw || !Array.isArray(raw.answers)) {
    return {
      studentName: '',
      answers: [],
      correctCount: 0,
      totalQuestions: expectedCount || 0,
      scorePercent: 0,
      wrongNumbers: [],
      uncertainQuestions: [],
      error: '응답 형식 오류',
    };
  }

  let answers = raw.answers.slice(0, expectedCount || raw.answers.length);
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
  answers = answers.map((a, i) => ({
    no: i + 1,
    type: a.type || 'short',
    studentAnswer: String(a.studentAnswer || '').trim(),
    correctAnswer: String(a.correctAnswer || '').trim(),
    isCorrect: a.isCorrect === true,
    confidence: typeof a.confidence === 'number' ? Math.max(0, Math.min(1, a.confidence)) : 0.5,
  }));
  answers.forEach(a => {
    if (!a.studentAnswer && a.confidence > 0.5) a.confidence = 0.3;
  });
  const uncertain = new Set(Array.isArray(raw.uncertainQuestions) ? raw.uncertainQuestions : []);
  answers.forEach(a => { if (a.confidence < 0.9) uncertain.add(a.no); });
  const correctCount = answers.filter(a => a.isCorrect).length;
  const totalQuestions = answers.length;

  return {
    studentName: String(raw.studentName || '').trim(),
    answers,
    correctCount,
    totalQuestions,
    scorePercent: totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0,
    wrongNumbers: answers.filter(a => !a.isCorrect).map(a => a.no),
    uncertainQuestions: Array.from(uncertain).sort((a, b) => a - b),
  };
}

module.exports = {
  buildAnswerKeyPrompt,
  postProcessAnswerKey,
  buildStudentGradePrompt,
  postProcessStudentGrade,
};
