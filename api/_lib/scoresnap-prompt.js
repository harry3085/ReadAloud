// ScoreSnap — Gemini Vision 프롬프트 빌더 + 응답 후처리 (정답지 OCR + 학생 채점)
//
// 새 워크플로우 (2026-05-11 재설계):
//   1) 정답지 1장 촬영 → buildAnswerKeyPrompt → questions 배열 OCR 추출
//   2) 학생 답안지 N장 → buildStudentGradePrompt → 학생답·이름 OCR + 채점
// 정답·문항을 Firestore 에서 안 가져옴 — 시험지 종이만 있으면 채점 가능.

// ─── 정답지 OCR 프롬프트 ───
// 학원장이 인쇄한 정답지(답지 보기 모드) 1 장을 보고 문제·정답 추출.
function buildAnswerKeyPrompt(opts) {
  const forceNumbered = !!(opts && opts.forceNumbered);
  const forceNote = forceNumbered
    ? '★★ 이 시험지는 번호형(layout "numbered")이다. 표 형식이 아니다. 모든 문항을 questions 에 담고 layout 은 반드시 "numbered" 로 응답하라. (여러 단으로 나뉜 번호 목록·영어↔한글이 섞인 문제도 번호형이다)' + String.fromCharCode(10) + String.fromCharCode(10)
    : '';
  const forceTail = forceNumbered
    ? String.fromCharCode(10) + String.fromCharCode(10) + '★★ 다시 강조: layout 은 "numbered", "table" 필드는 쓰지 말고, 모든 문항(번호·문제·정답)을 questions 배열에 담아라. questions 가 비어 있으면 안 된다.'
    : '';
  return `${forceNote}첨부: 정답이 표시된 시험지 1장 (인쇄지, 활자).

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

★ 시험지 형식 구분 (layout):
- 일반 시험지: 번호 한 줄에 문제 하나 + 정답 하나 → layout "numbered" (기본). 위 형식대로 questions 에 담는다.
  · **다음은 모두 "numbered"**: 번호 목록이 여러 단(좌우로 2~4개 묶음)으로 나뉜 시험지 / 줄마다 영어↔한글 방향이 섞여 있는 시험지 / 번호·문제·정답이 한 줄에 나란히 있는 시험지. 열 머리글이 없는 목록은 표가 아니다.
- **표 형식 시험지**: **표 맨 위에 열 이름이 인쇄된 머리글 줄이 있고**(예: 뜻 | 현재 | 과거 | 과거분사), 한 번호(행)에 여러 칸이 있는 표. 학생에게는 기준이 되는 한 칸(예: 현재형)만 인쇄하고 나머지 칸을 채우게 하는 시험지.
  **머리글 줄이 없으면 표가 아니다 → numbered.**
  → layout "table". questions 는 빈 배열 [] 로 두고, 대신 table 에 담는다:
  · hasHeaderRow: 열 이름이 적힌 머리글 줄이 실제로 인쇄돼 있으면 true
  · columns: 표의 열 이름을 왼쪽에서 오른쪽 순서로 (예: ["뜻","현재","과거","과거분사"])
  · givenColumn: 학생에게 주어지는(인쇄되는) 기준 열. 영어 기본형·현재형처럼 시험 문제가 되는 열 (불규칙동사표면 "현재")
  · rows: 각 줄 [{ "no": 번호, "cells": { "뜻": "...", "현재": "...", "과거": "...", "과거분사": "..." } }]
  · 모든 칸을 정답지에 인쇄된 그대로 읽는다 (빈 칸이 있으면 "")

응답 JSON 만 출력. 서문·설명 없이:

{
  "layout": "numbered" or "table",
  "table": { "hasHeaderRow": true, "columns": [], "givenColumn": "", "rows": [] },     // layout 이 table 일 때만 채움. numbered 면 생략
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
}`+forceTail;
}

// 정답지 OCR 응답 → 정제
// 표 형식 정답지 → 칸 하나가 한 문항인 questions 로 펼침. stem = "기준값 [열이름]" (예: "leave [과거]")
function _flattenKeyTable(table) {
  const cols = (table.columns || []).map(c => String(c || '').trim()).filter(Boolean);
  let given = String(table.givenColumn || '').trim();
  // 기준 칸은 AI 추정이 흔들리므로(같은 표를 '뜻' 또는 '현재' 로 답함), 불규칙동사표처럼 '현재' 열이 있으면 항상 '현재' 로 고정
  if (cols.includes('현재')) given = '현재';
  else if (!cols.includes(given)) given = cols[0] || '';
  const answerColumns = cols.filter(c => c !== given);
  const questions = [];
  (table.rows || []).forEach((row, ri) => {
    const cells = (row && row.cells) || {};
    const g = String(cells[given] || '').trim();
    if (!g) return;
    answerColumns.forEach(col => {
      questions.push({
        no: questions.length + 1, type: 'short',
        stem: `${g} [${col}]`, choices: [], answerIdx: -1,
        answer: String(cells[col] || '').trim(), confidence: 0.9,
        row: Number.isInteger(row.no) ? row.no : ri + 1, col, given: g,
      });
    });
  });
  return { givenColumn: given, answerColumns, questions };
}

function postProcessAnswerKey(raw) {
  if (raw && raw.layout === 'table') {
    // 머리글 줄이 없거나 열이 2개 미만이면 표가 아니라 번호형을 잘못 판단한 것 → 호출부가 번호형으로 다시 읽도록 표시
    const t = raw.table || {};
    if (t.hasHeaderRow !== true || !Array.isArray(t.columns) || t.columns.length < 2 || !Array.isArray(t.rows) || t.rows.length < 2) {
      return { testName: String(raw.testName || '').trim(), questions: [], _tableRejected: true };
    }
  }
  if (raw && raw.layout === 'table' && raw.table && Array.isArray(raw.table.rows) && raw.table.rows.length) {
    const f = _flattenKeyTable(raw.table);
    if (f.questions.length) {
      return {
        testName: String(raw.testName || '').trim(),
        layout: 'table', givenColumn: f.givenColumn, answerColumns: f.answerColumns,
        questions: f.questions,
      };
    }
  }
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
// 정답지 questions 를 K번호로 나열 + 학생 답안지 이미지 첨부.
// ★ 정답지와 학생 시험지는 문제 순서가 서로 다를 수 있다(랜덤 순서 인쇄).
//   → 위치가 아니라 "문제 내용(영단어·문장·보기)"으로 정답지 문항(K번호)을 찾아 대응시킨다.
//   → 번호(no)는 학생 시험지에 인쇄된 번호를 따른다.
function buildStudentGradePrompt(answerKeyQuestions) {
  const lines = (answerKeyQuestions || []).map((q, i) => {
    const k = `K${i + 1}`;
    if (q.type === 'mcq') {
      const choices = (q.choices || []).map((c, j) => {
        const mark = ['①', '②', '③', '④', '⑤'][j] || `(${j + 1})`;
        return `${mark} ${c}`;
      }).join(' ');
      return `${k} [MCQ] "${q.stem}"\n   ${choices}\n   → 정답 텍스트: "${q.answer}"`;
    }
    return `${k} [SHORT] "${q.stem}" → 정답: "${q.answer}"`;
  }).join('\n\n');

  return `첨부: 학생 답안지 한 장 (사진).

정답지 문항 목록 (K번호 = 정답지 기준 식별자):

${lines}

★ 가장 중요 — 순서가 다를 수 있다:
- 학생 시험지는 정답지와 문제 순서가 다르다(랜덤 순서로 인쇄됨). 번호가 같다고 같은 문제가 아니다.
- 학생 시험지의 각 문항에 인쇄된 문제(영단어·문장·보기 등)를 **글자 그대로** stemSeen 에 적어라. (서버가 stemSeen 으로 정답지 문항을 찾아 짝짓는다. 가장 중요한 필드)
- 위 정답지 목록에서 **같은 문제**를 찾아 그 K번호를 keyNo 로도 적어라(보조). 위치·순서로 짝짓지 말 것.
- 출력 answers 는 **학생 시험지에 인쇄된 번호 순서(no)** 로 작성. no 는 학생 시험지에 인쇄된 번호 그대로.
- **문제 수는 학생 시험지 기준이다.** 정답지 목록이 학생 시험지보다 문항이 많거나(같은 문제가 중복 등재되어 있을 수 있다) 일부가 학생지에 없을 수 있다. 학생 시험지에 인쇄된 문항만 answers 에 적고, 정답지에만 있는 문항은 만들어 내지 말 것.
- 정답지 목록의 문항 하나는 정확히 한 번만 사용.
- ★ 학생이 답을 쓰지 않은 **빈칸 문항도 반드시 answers 에 포함**한다(그 문항의 번호·stemSeen 을 읽고 studentAnswer 는 빈 문자열). 학생 시험지에 인쇄된 모든 번호 행을 빠짐없이 적을 것 — 총 ${(answerKeyQuestions || []).length}문항.

작업:
1. 시험지 헤더의 "이름:" 옆에 학생이 쓴 손글씨 이름 추출. 헤더에 **인쇄된 시험명**(제목)도 그대로 추출
2. 각 문항에서 학생이 쓴 답만 추출 → 그 문항에 해당하는 정답지 문항(keyNo)의 정답과 비교해 채점

추출 규칙:
- 학생 이름: 손글씨 그대로 (한글·영문). 빈칸·판독 불가면 빈 문자열
- MCQ: 학생이 동그라미·체크·V 표시 친 보기의 텍스트 추출 (인쇄된 보기 텍스트 그대로). 선지 위치(①②)보다 텍스트가 우선 (보기 순서도 다를 수 있음)
- SHORT: 학생이 줄 위에 손글씨로 적은 글자 그대로 추출
- **줄을 그어 지운(취소선) 글자는 학생 답이 아니다.** 지운 글자는 무시하고 지우지 않은 최종 답만 추출
- 정답이 위에 명시돼 있다고 그걸 학생 답으로 넘기지 말 것
- 학생이 아무것도 안 썼거나 판독 불가하면 studentAnswer 는 빈 문자열, isCorrect=false, confidence 0.3 이하 (**빈칸은 무조건 오답**)

채점 규칙:
- 정답이 영어(철자·문장)인 문항: 철자가 정확히 일치해야 정답. 대소문자·공백·문장부호만 무시. 철자가 다르면 오답.
- 정답이 한글(뜻)인 문항: **글자가 같지 않아도 뜻이 같거나 거의 같으면 정답**.
  · 허용: 조사·어미·띄어쓰기 차이, 사소한 오탈자, 의미가 같은 다른 표현(유의어·풀어쓴 표현)
  · 정답에 뜻이 여러 개(쉼표·슬래시 등으로 구분, 예: "층, 겹")이면 **그중 하나만 써도 정답**(알고 있다고 판단)
  · 오답: 뜻이 다른 단어, 반대 뜻, 문제와 무관한 내용, 빈칸
  · 뜻이 비슷한지, 또는 글씨를 읽은 것이 맞는지 **애매하면 오답(isCorrect=false)** 으로 하고 confidence 를 0.7 이하로 낮춰라. 글씨가 불분명할 만큼 흐리거나 흘려 쓴 답도 오답
- MCQ: 학생이 표시한 보기 텍스트가 정답 텍스트와 같으면 정답.

응답 JSON 만 출력. 서문·설명 없이:

{
  "studentName": "추출된 학생 이름 (없으면 빈 문자열)",
  "testName": "학생 시험지 헤더에 인쇄된 시험명 (없으면 빈 문자열)",
  "answers": [
    {
      "no": 학생 시험지에 인쇄된 문항 번호,
      "stemSeen": "학생 시험지에 인쇄된 영어 문제 그대로 (예: be covered with ~)",
      "keyNo": 대응하는 정답지 문항 번호 (K3 이면 3),
      "type": "mcq" or "short",
      "studentAnswer": "...",
      "correctAnswer": "...",
      "isCorrect": true|false,
      "confidence": 0.0~1.0
    }
  ],
  "printedCount": 학생 시험지에 인쇄된 전체 문항 수(마지막 번호),
  "uncertainQuestions": [confidence 0.8 미만 문항의 no]
}`;
}

// ─── 표 형식 학생 답안지 ───
// 한 줄에 칸이 여러 개(뜻·과거·과거분사). 기준 칸(givenColumn)은 인쇄돼 있고 나머지 칸을 학생이 손으로 썼다.
function buildStudentTablePrompt(meta) {
  const given = meta.givenColumn;
  const cols = meta.answerColumns || [];
  const list = cols.map(c => `"${c}"`).join(', ');
  return `첨부: 학생이 푼 표 형식 시험지 한 장 (사진).

표의 열: ${[...cols.slice(0, 0), given, ...cols].join(' / ')}  (순서는 사진을 따를 것)
- "${given}" 열은 **인쇄된** 글자 (학생이 쓴 것이 아님)
- ${list} 열은 학생이 **손으로 쓴 답**

작업: 표의 각 줄(번호)마다 인쇄된 "${given}" 값과, 학생이 쓴 ${list} 칸의 글자를 그대로 읽어라.
- 학생이 쓴 글자는 **철자가 틀려도 보이는 그대로** 적는다 (교정·추측 금지)
- **줄을 그어 지운(취소선) 글자는 결과에 절대 포함하지 않는다.** 한 칸에 글자가 두 개 이상인데 일부에 줄이 그어져 있으면, 줄이 그어지지 않은 최종 답만 적는다 (예: 줄 그은 "놓치다" 옆에 "떠나다" 가 있으면 "떠나다" 만).
- 비어 있으면 ""
- 헤더의 이름란에 학생이 쓴 손글씨 이름, 인쇄된 시험명도 읽는다
- 모든 줄을 빠짐없이 (사진에 보이는 순서대로)
- conf: 그 줄 손글씨 판독 확신도 (또렷하면 0.95, 흐리거나 애매하면 0.7 이하)

응답 JSON 만 출력. 서문·설명 없이:
{
  "studentName": "...",
  "testName": "...",
  "rows": [ { "no": 줄 번호, "given": "인쇄된 ${given} 값", "cells": { ${cols.map(c => `"${c}": "학생이 쓴 글자"`).join(', ')} }, "conf": 0.0~1.0 } ]
}`;
}

// 표 형식 학생 응답 → 칸 단위 answers 로 펼쳐 기존 채점(postProcessStudentGrade)에 태움
function studentTableToRaw(raw, meta) {
  const cols = meta.answerColumns || [];
  const rows = Array.isArray(raw && raw.rows) ? raw.rows : [];
  const answers = [];
  rows.forEach((row, ri) => {
    const cells = (row && row.cells) || {};
    const g = String((row && row.given) || '').trim();
    cols.forEach((col, ci) => {
      answers.push({
        no: ri * cols.length + ci + 1,
        stemSeen: `${g} [${col}]`,
        studentAnswer: String(cells[col] == null ? '' : cells[col]),
        isCorrect: false,
        confidence: typeof row.conf === 'number' ? row.conf : 0.85,
      });
    });
  });
  return {
    studentName: raw && raw.studentName, testName: raw && raw.testName,
    answers, printedCount: rows.length * cols.length,
  };
}

// 비교용 정규화 — 대소문자·공백·문장부호 무시 (한글·영문·숫자만 남김)
function _norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
const _HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

// 한글 정답을 "인정되는 형태" 목록으로 분해 — 쉼표·슬래시 등으로 나뉜 뜻 각각, 괄호 부연 제거본
function _answerVariants(correctAnswer) {
  const c = String(correctAnswer || '');
  const noParen = c.replace(/\([^)]*\)|（[^）]*）/g, ' ');
  const out = new Set([c, noParen]);
  // 구분 기호: 쉼표·슬래시 등 + 마침표(OCR 이 쉼표를 마침표로 읽거나 정답지가 마침표로 구분한 경우)
  [c, noParen].forEach(t => t.split(/[,;/·、，.。]/).forEach(p => out.add(p)));
  return Array.from(out).map(_norm).filter(Boolean);
}

// 학생 채점 응답 → 정제
// 순서가 다른 시험지 대응: keyNo 로 정답지 문항을 찾고, 정답·유형은 정답지 값을 기준으로 삼는다.
function postProcessStudentGrade(raw, expectedCount, answerKeyQuestions) {
  const keyQs = Array.isArray(answerKeyQuestions) ? answerKeyQuestions : [];
  if (!raw || !Array.isArray(raw.answers)) {
    return {
      studentName: '',
      testName: '',
      answers: [],
      correctCount: 0,
      totalQuestions: expectedCount || 0,
      scorePercent: 0,
      wrongNumbers: [],
      uncertainQuestions: [],
      error: '응답 형식 오류',
    };
  }

  const total = expectedCount || keyQs.length || raw.answers.length;
  const clamp01 = (v) => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0.5);
  const used = new Set();          // 이미 대응된 정답지 문항(keyNo)
  const rows = [];                 // 정제된 학생 문항

  // 영어 문제(stem) 정규화 → 정답지 문항 번호. 같은 stem 이 둘 이상이면 모호하므로 매핑에서 제외
  const stemMap = new Map();       // stem → [keyNo, ...]  (같은 문제가 정답지에 중복 등재돼도 안전하게 짝지음)
  keyQs.forEach((q, idx) => {
    const k = _norm(q && q.stem);
    if (!k) return;
    if (!stemMap.has(k)) stemMap.set(k, []);
    stemMap.get(k).push(idx + 1);
  });

  raw.answers.forEach((a, i) => {
    // 짝짓기: ① 학생지에 인쇄된 문제(stemSeen)가 정답지 stem 과 일치하면 그 문항(코드가 결정)
    //        ② 아니면 AI 가 준 keyNo, ③ 그것도 없으면 배열 위치
    const aiKeyNo = Number.isInteger(a.keyNo) ? a.keyNo : i + 1;
    // 같은 stem 이 여러 개면 아직 안 쓴 첫 번째 정답지 문항. 전부 이미 쓰였으면 중복 응답 → 버림
    const cands = stemMap.get(_norm(a.stemSeen));
    let stemKey = null;
    if (cands && cands.length) {
      stemKey = cands.find(c => !used.has(c));
      if (stemKey === undefined) return;
    }
    const keyNo = Number.isInteger(stemKey) ? stemKey : aiKeyNo;
    const remapped = Number.isInteger(stemKey) && stemKey !== aiKeyNo;
    // 범위 밖·중복은 버린다 — 정답지 문항이 남으면 아래에서 빈 슬롯(오답·검토 표시)으로 채움
    if (keyNo < 1 || keyNo > total || used.has(keyNo)) return;
    used.add(keyNo);
    const key = keyQs[keyNo - 1] || {};
    const studentAnswer = String(a.studentAnswer || '').trim();
    const correctAnswer = String(key.answer || a.correctAnswer || '').trim();
    const type = key.type || a.type || 'short';
    let isCorrect = a.isCorrect === true;
    let confidence = clamp01(a.confidence);
    // AI 가 짝을 잘못 짚었다가 코드가 바로잡은 문항 — AI 판정이 엉뚱한 정답 기준이었을 수 있으니 검토 표시
    if (remapped && confidence > 0.6) confidence = 0.6;

    if (!studentAnswer) {
      // 빈칸·판독 불가는 무조건 오답 — 오답으로 확정이라 검토 대상에서 제외(학원장이 ✓/✗ 로 수정 가능)
      isCorrect = false;
      confidence = 1;
    } else if (_norm(studentAnswer) && _norm(studentAnswer) === _norm(correctAnswer)) {
      // 글자가 (대소문자·부호 무시하고) 같으면 정답 — AI 오판 방지
      isCorrect = true;
      if (confidence < 0.95) confidence = 0.95;       // 코드가 확정한 정답은 검토 대상에서 제외
    } else if (_HANGUL.test(correctAnswer) && _answerVariants(correctAnswer).includes(_norm(studentAnswer))) {
      // 한글 뜻이 여러 개("층, 겹")면 그중 하나만 써도 정답. 괄호 부연("종 (생물 분류의…)")은 빼고도 인정
      isCorrect = true;
      if (confidence < 0.95) confidence = 0.95;       // 코드가 확정한 정답은 검토 대상에서 제외
    } else if (type === 'short' && correctAnswer && !_HANGUL.test(correctAnswer)) {
      // 정답이 영어인 단답 — 철자 정확 일치만 정답 (AI 관대 판정 차단)
      isCorrect = false;
    }

    // 글자가 같지 않은 한글 뜻 단답 — 뜻을 아는지는 별도 판정 호출이 일관되게 결정한다
    const needsJudge = !!studentAnswer && type === 'short' && _HANGUL.test(correctAnswer)
      && _norm(studentAnswer) !== _norm(correctAnswer)
      && !_answerVariants(correctAnswer).includes(_norm(studentAnswer));

    const no = Number.isInteger(a.no) && a.no >= 1 ? a.no : rows.length + 1;
    const extra = key.col ? { col: key.col, given: key.given, row: key.row } : {};
    rows.push({ no, keyNo, type, stem: String(key.stem || '').trim(), studentAnswer, correctAnswer, isCorrect, confidence, needsJudge, ...extra });
  });

  // 문제 수는 학생 시험지 기준 — 정답지에만 있는 문항은 만들지 않는다(정답지가 더 길거나 중복 등재돼도 안전).
  // 다만 AI 가 학생지의 일부 행을 응답에서 빠뜨린 경우만, 학생지 전체 문항 수(printedCount)와 번호 공백으로 찾아
  // 빈 슬롯(오답·검토 표시)으로 채운다. printedCount 가 비정상(정답지 문항 수 초과)이면 무시.
  const maxNo0 = rows.reduce((m, r) => Math.max(m, r.no), 0);
  const pc0 = Number.isInteger(raw.printedCount) ? raw.printedCount : 0;
  // printedCount 는 정답지 문항 수(또는 응답 번호)를 넘지 않는 값만 신뢰 — 엉뚱한 값이면 무시
  const pcValid = pc0 >= 1 && pc0 <= Math.max(maxNo0, keyQs.length || 0);
  // 학생지 마지막 번호를 넘는 행은 AI 가 정답지에 이끌려 만들어 낸 것(예: 정답지에 같은 문제가 중복 등재) → 버린다
  if (pcValid) {
    for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].no > pc0) rows.splice(i, 1); }
  }
  const maxNo = rows.reduce((m, r) => Math.max(m, r.no), 0);
  const printed = pcValid ? Math.max(maxNo, pc0) : maxNo;
  const haveNos = new Set(rows.map(r => r.no));
  const noDup = haveNos.size === rows.length;     // 번호가 겹치면(재번호 대상) 공백 계산이 무의미
  if (noDup) {
    for (let n = 1; n <= printed; n++) {
      if (haveNos.has(n)) continue;
      rows.push({
        no: n, keyNo: null, type: 'short', stem: '', studentAnswer: '', correctAnswer: '',
        isCorrect: false, confidence: 0.3,
      });
    }
  }

  // 학생 시험지 번호 순으로 정렬. no 가 겹치면 순서대로 재번호
  rows.sort((x, y) => x.no - y.no);
  const dup = new Set(rows.map(r => r.no)).size !== rows.length;
  const answers = rows.map((r, i) => ({ ...r, no: dup ? i + 1 : r.no }));

  // 검토 필요 = 최종 신뢰도 0.9 미만 문항만. AI 가 자체 보고한 uncertainQuestions 는 쓰지 않는다
  // (코드가 확정한 정답까지 AI 목록에 끼어 검토 대상으로 남는 문제 방지)
  const uncertain = new Set();
  answers.forEach(a => { if (a.confidence < 0.9) uncertain.add(a.no); });
  const correctCount = answers.filter(a => a.isCorrect).length;
  const totalQuestions = answers.length;

  return {
    studentName: String(raw.studentName || '').trim(),
    testName: String(raw.testName || '').trim(),
    answers,
    correctCount,
    totalQuestions,
    scorePercent: totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0,
    wrongNumbers: answers.filter(a => !a.isCorrect).map(a => a.no),
    uncertainQuestions: Array.from(uncertain).filter(n => answers.some(a => a.no === n)).sort((a, b) => a - b),
  };
}

// ─── 뜻 판정 (텍스트 전용 2차 호출) ───
// 사진 없이 (정답, 학생답) 쌍만 보고 "이 단어의 뜻을 알고 있는가" 를 일관되게 판정한다.
function buildJudgePrompt(items) {
  const lines = items.map(it =>
    `${it.id}. 영어: "${it.stem}" | 정답 뜻: "${it.correct}" | 학생 답: "${it.student}"`
  ).join('\n');
  return `영어 단어·표현의 한글 뜻을 묻는 시험을 채점한다.
각 문항에서 학생이 이 영어 표현의 **뜻을 알고 있는지, 완전히 모르는지**만 판정하라.

판정 기준:
- 표현이 달라도 핵심 뜻이 같거나 매우 가까우면 knows=true (알고 있음).
  · true 로 보는 경우: 조사·어미·품사형 차이(예: 극도로 ↔ 극심한), 유의어, 풀어쓴 표현, 띄어쓰기·사소한 오탈자·받침 실수, 정답의 여러 뜻 중 일부만 쓴 경우, "~을/~에" 같은 기호·조사 생략
- 뜻이 다르거나, 반대이거나, 문제와 무관하면 knows=false (모름).
  · false 로 보는 경우: 다른 단어의 뜻을 쓴 경우, 글자가 비슷해도 뜻이 다른 경우(예: 단열 ↔ 온열), 능동·피동이 뒤바뀌어 뜻 방향이 반대인 경우, 정답의 핵심이 빠진 너무 막연한 답
- 영어 표현의 실제 의미를 기준으로 하되, 제시된 정답 뜻을 우선 참조한다.
- **그 영어 단어 자체가 가진 다른 일반적인 뜻이면 knows=true.** 자동사/타동사 두 쓰임이 모두 있는 단어(예: hide = 숨다 / 숨기다, open = 열다 / 열리다, grow = 자라다 / 키우다, move = 움직이다 / 옮기다)는 정답이 한쪽이어도 다른 쪽을 쓴 학생은 알고 있는 것이다.
  · 단, 영어 표현이 수동태·특정 형태 하나만 가리키는 경우(예: be surrounded by = ~에 둘러싸이다, be covered with = ~로 덮여 있다)는 반대 방향 뜻이면 knows=false.
  · surround·enclose·cover 처럼 능동(타동사) 뜻 하나뿐인 단어를 수동("~되다·~싸이다")으로 쓰거나, 반대로 수동 표현을 능동으로 쓴 것도 knows=false.
- **애매하면 모름(knows=false)** 으로 판정한다. 뜻을 알고 있다고 분명히 볼 수 있을 때만 true.
- confidence: 판정 확신도. 확실하면 0.9 이상, 애매하면 0.7 이하.

문항:
${lines}

응답 JSON 만 출력. 서문·설명 없이:
{ "results": [ { "id": 문항 id, "knows": true|false, "confidence": 0.0~1.0 } ] }`;
}

// 판정 결과 반영 — 판정된 문항만 isCorrect·confidence 를 덮어쓰고 합계를 다시 계산
function applyJudgements(result, judged) {
  const byId = new Map();
  (judged || []).forEach(j => { if (j && Number.isInteger(j.id)) byId.set(j.id, j); });
  result.answers.forEach(a => {
    const j = byId.get(a.keyNo);
    if (a.needsJudge && j && typeof j.knows === 'boolean') {
      a.isCorrect = j.knows;
      a.confidence = typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0.8;
      a.judged = true;
    }
  });
  return _recompute(result);
}

function _recompute(result) {
  const answers = result.answers;
  const uncertain = new Set();
  answers.forEach(a => { if (a.confidence < 0.9) uncertain.add(a.no); });
  result.correctCount = answers.filter(a => a.isCorrect).length;
  result.totalQuestions = answers.length;
  result.scorePercent = result.totalQuestions > 0 ? Math.round((result.correctCount / result.totalQuestions) * 100) : 0;
  result.wrongNumbers = answers.filter(a => !a.isCorrect).map(a => a.no);
  result.uncertainQuestions = Array.from(uncertain).sort((x, y) => x - y);
  return result;
}

// 최종 정책 — 애매하면 오답. 확신도 0.9 미만인 정답은 오답으로 바꾼다.
// (AI 도 읽기 애매한 글씨는 채점자도 애매하다 → 정자로 쓰게 하는 효과)
function finalizeAmbiguity(result) {
  (result.answers || []).forEach(a => {
    if (a.isCorrect && a.confidence < 0.9) {
      a.isCorrect = false;
      a.ambiguousWrong = true;
    }
  });
  return _recompute(result);
}

module.exports = {
  buildStudentTablePrompt,
  studentTableToRaw,
  finalizeAmbiguity,
  buildJudgePrompt,
  applyJudgements,
  buildAnswerKeyPrompt,
  postProcessAnswerKey,
  buildStudentGradePrompt,
  postProcessStudentGrade,
};
