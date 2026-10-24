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


// ─── 찾은 글자 위치 → 앱(public/ss/scoresnap.js)이 저장하는 markPos 형식 (앱의 _ssEnsureMarkPos / _ssEnsureMarkPosTable 과 같은 모양) ───
function numbersMarkPos(words) {
  const nums = {};
  let lab = null;
  for (const w of words || []) {
    const m = /^(\d{1,3})\.$/.exec(w.t);
    if (m) nums[Number(m[1])] = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 };
    else if (/^점수:?$/.test(w.t)) lab = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 };
  }
  return Object.keys(nums).length ? { v: 2, engine: 'pc', nums, label: lab } : null;
}

// 표 형식: 문항(no)마다 V 를 찍을 칸의 위치. key.questions 의 { no, col, given } 로 계산한다.
function tableMarkPos(words, key) {
  const W = words || [], cx = w => (w.x1 + w.x2) / 2, cy = w => (w.y1 + w.y2) / 2;
  const cols = [key.givenColumn].concat(key.answerColumns || []).filter(Boolean);
  const head = {};
  cols.forEach(name => { const h = W.filter(w => w.t === name).sort((a, b) => a.y1 - b.y1)[0]; if (h) head[name] = h; });
  if (cols.some(n => !head[n])) return null;
  const hxs = cols.map(n => cx(head[n])).sort((a, b) => a - b);
  const halfOf = (name) => {
    const i = hxs.indexOf(cx(head[name]));
    const d = [hxs[i - 1] != null ? cx(head[name]) - hxs[i - 1] : Infinity, hxs[i + 1] != null ? hxs[i + 1] - cx(head[name]) : Infinity];
    const mn = Math.min(d[0], d[1]);
    return (isFinite(mn) ? mn : 0.2) / 2;
  };
  const headBottom = Math.max(...cols.map(n => head[n].y2));
  const givenX = cx(head[key.givenColumn]);
  const cells = {};
  (key.questions || []).forEach(q => {
    if (!q.col || !q.given || !head[q.col]) return;
    const g = String(q.given).toLowerCase();
    const cand = W.filter(w => String(w.t).toLowerCase() === g && w.y1 > headBottom).sort((p1, p2) => Math.abs(cx(p1) - givenX) - Math.abs(cx(p2) - givenX))[0];
    if (!cand) return;
    cells[q.no] = { x: cx(head[q.col]) - halfOf(q.col) * 0.9, y: cy(cand), h: cand.y2 - cand.y1 };
  });
  const lab = W.filter(w => /^점수:?$/.test(w.t) && w.y1 < 0.25).sort((a, b) => b.x1 - a.x1)[0];
  return Object.keys(cells).length ? { cells, label: lab ? { x1: lab.x1, y1: lab.y1, x2: lab.x2, y2: lab.y2 } : null } : null;
}

module.exports = { buildNumbersPrompt, buildTablePrompt, numbersToWords, tableToWords, numbersMarkPos, tableMarkPos };
