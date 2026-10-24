// 마킹(틀린 문항 V) 위치 찾기용 지시문과 결과 검증 — Google Vision 대신 Claude 가 글자 위치를 찾는다.
// 결과는 Vision 단어 목록과 같은 형식 [{ t, x1, y1, x2, y2 }] (0~1 비율 좌표, 좌상단이 0,0)

const BOX = '경계 상자는 이미지 전체 크기 기준 0~1 비율 좌표(좌상단이 0,0, x는 가로, y는 세로)로 소수점 3자리까지 답하라.';

function buildNumbersPrompt(total) {
  return `시험지에 인쇄된 문항 번호(1. 2. ... ${total}.)의 위치를 찾아라.
각 번호 글자("1." 처럼 숫자와 점)를 감싸는 경계 상자를 구하라. ${BOX}
인쇄된 번호만 (학생이 손으로 쓴 글씨·머리글의 날짜 숫자는 제외). 또 머리글 오른쪽 위 "점수:" 글자의 경계 상자도 같은 방식으로 답하라. 점수 글자가 없으면 score 는 null.
응답 JSON: {"numbers":[{"n":1,"x1":0,"y1":0,"x2":0,"y2":0}, ...], "score":{"x1":0,"y1":0,"x2":0,"y2":0}}`;
}

// 표 형식 시험지: 열 이름 줄(머리글)과, 줄마다 인쇄된 기준 칸 단어의 위치
function buildTablePrompt(meta) {
  return `표 형식 시험지다. 아래 글자들의 위치를 찾아라. ${BOX}
1) 표 맨 위 머리글 줄의 열 이름: ${meta.columns.map(c => `"${c}"`).join(', ')} — 각 열 이름 글자 전체를 감싸는 상자 (열 이름은 위 철자 그대로 t 에 적을 것).
2) "${meta.givenColumn}" 열에 **인쇄된** 단어들(학생이 쓴 글씨가 아님): ${meta.givens.map(g => `"${g}"`).join(', ')} — 각 단어를 감싸는 상자. 단어 하나(또는 구)마다 한 개씩, t 에는 위에 적힌 철자 그대로 적을 것. 사진에서 찾을 수 없는 단어는 생략.
3) 머리글 오른쪽 위 "점수:" 글자의 상자 (없으면 score 는 null).
응답 JSON: {"headers":[{"t":"열이름","x1":0,"y1":0,"x2":0,"y2":0}, ...], "givens":[{"t":"단어","x1":0,"y1":0,"x2":0,"y2":0}, ...], "score":{"x1":0,"y1":0,"x2":0,"y2":0}}`;
}

const okBox = (b) => b && [b.x1, b.y1, b.x2, b.y2].every(v => typeof v === 'number' && v >= 0 && v <= 1) && b.x2 > b.x1 && b.y2 > b.y1;
const box = (t, b) => ({ t, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });

function numbersToWords(j, total) {
  const words = [];
  (Array.isArray(j.numbers) ? j.numbers : []).forEach(b => { if (okBox(b) && b.n >= 1) words.push(box(b.n + '.', b)); });
  if (okBox(j.score)) words.push(box('점수:', j.score));
  if (words.length < Math.max(1, Math.floor(total * 0.5))) throw new Error('문항 번호 위치를 충분히 찾지 못했어요');
  return words;
}

function tableToWords(j, meta) {
  const words = [];
  const want = new Set(meta.columns);
  (Array.isArray(j.headers) ? j.headers : []).forEach(b => { if (okBox(b) && want.has(b.t)) words.push(box(b.t, b)); });
  const gotCols = new Set(words.map(w => w.t));
  const missing = meta.columns.filter(c => !gotCols.has(c));
  if (missing.length) throw new Error('표의 열 머리글을 못 찾았어요: ' + missing.join(', '));
  const givenSet = new Set(meta.givens.map(g => String(g).toLowerCase()));
  let n = 0;
  (Array.isArray(j.givens) ? j.givens : []).forEach(b => { if (okBox(b) && givenSet.has(String(b.t).toLowerCase())) { words.push(box(String(b.t), b)); n++; } });
  if (n < Math.max(1, Math.floor(meta.givens.length * 0.5))) throw new Error('표의 줄 위치를 충분히 찾지 못했어요');
  if (okBox(j.score)) words.push(box('점수:', j.score));
  return words;
}

module.exports = { buildNumbersPrompt, buildTablePrompt, numbersToWords, tableToWords };
