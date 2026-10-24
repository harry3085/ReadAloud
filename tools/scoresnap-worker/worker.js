// ScoreSnap PC 채점 프로그램
// 전용앱(/ss/)이 서버에 올린 채점 작업(정답지 읽기·학생 채점)을 가져와 Claude Code(구독, API 요금 없음)로
// 처리하고 결과를 같은 서버에 돌려준다. 전용앱 화면이 그 결과를 받아 학원앱과 같은 방식으로 저장·표시한다.
// 채점 규칙(짝짓기·빈칸 오답·애매하면 오답·표 형식 등)은 서버와 같은 api/_lib/scoresnap-prompt.js 를 그대로 사용.
//
// 실행: start.bat  (또는 node worker.js)   설정: config.json (config.example.json 참고)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signInWithCustomToken } = require('firebase/auth');
const {
  getFirestore, collection, doc, query, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, runTransaction,
  onSnapshot, serverTimestamp,
} = require('firebase/firestore');
const { getStorage, ref, getDownloadURL } = require('firebase/storage');

const P = require('../../api/_lib/scoresnap-prompt.js');
const M = require('./marks.js');

const firebaseConfig = {
  apiKey: 'AIzaSyAb5d8w9mI5_hpcoBFcWnG5tE1TF_8guw8',
  authDomain: 'readaloud-51113.firebaseapp.com',
  projectId: 'readaloud-51113',
  storageBucket: 'readaloud-51113.firebasestorage.app',
  messagingSenderId: '944153888350',
  appId: '1:944153888350:web:47091c0771d20be8ea56cf',
};

const CFG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CFG_PATH) && !process.env.SS_CUSTOM_TOKEN) {
  console.error('config.json 이 없습니다. config.example.json 을 복사해 만들고 아이디/비밀번호를 입력하세요.');
  process.exit(1);
}
const CFG = fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) : {};
const WORKER = CFG.workerName || os.hostname();
const STALE_MS = 10 * 60 * 1000;     // 이 시간 넘게 '채점 중'이면 멈춘 것으로 보고 다시 대기로

const log = (...a) => console.log(new Date().toLocaleTimeString('ko-KR'), ...a);

// ─── Claude Code 위치 ───
function findClaude() {
  if (CFG.claudePath) return CFG.claudePath;
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const dirs = fs.readdirSync(ext).filter(n => /^anthropic\.claude-code-.*win32/.test(n)).sort().reverse();
    for (const d of dirs) {
      const p = path.join(ext, d, 'resources', 'native-binary', 'claude.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  // Claude 데스크탑 앱에 들어 있는 Claude Code: ...\Claude\claude-code\<버전>\<해시>\claude.exe (가장 최근 것)
  // 일반 설치는 %APPDATA%, 스토어(MSIX) 설치는 %LOCALAPPDATA%\Packages\<앱>\LocalCache\Roaming 아래에 있다
  try {
    const bases = [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')];
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
    try { for (const d of fs.readdirSync(pk)) if (/claude|anthropic/i.test(d)) bases.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code')); } catch (_) {}
    const found = [];
    for (const base of bases) {
      try {
        for (const v of fs.readdirSync(base)) for (const h of fs.readdirSync(path.join(base, v))) {
          const p = path.join(base, v, h, 'claude.exe');
          if (fs.existsSync(p)) found.push({ p, t: fs.statSync(p).mtimeMs });
        }
      } catch (_) {}
    }
    found.sort((a, b) => b.t - a.t);
    if (found.length) return found[0].p;
  } catch (_) {}
  // npm 으로 설치한 Claude Code (claude.cmd) — 설치 안내에 따라 PATH 에 없어도 찾는다
  const npmBin = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (fs.existsSync(npmBin)) return npmBin;
  const nativeBin = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(nativeBin)) return nativeBin;
  const shim = path.join(process.env.APPDATA || '', 'npm', 'claude.cmd');
  if (fs.existsSync(shim)) return shim;
  return 'claude';
}
const CLAUDE = findClaude();

function runClaude(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--allowedTools', 'Read', '--output-format', 'json'];
    if (CFG.model) args.push('--model', CFG.model);
    const viaShell = /\.(cmd|bat)$/i.test(CLAUDE) || CLAUDE === 'claude';   // .cmd 는 셸을 거쳐야 실행됨
    const child = viaShell
      ? spawn('cmd.exe', ['/d', '/s', '/c', '""' + CLAUDE + '" ' + args.join(' ') + '"'], { cwd, windowsHide: true, windowsVerbatimArguments: true })
      : spawn(CLAUDE, args, { cwd, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude 응답 시간 초과 (4분)')); }, 4 * 60 * 1000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error('Claude Code 를 실행하지 못했어요: ' + e.message)); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error('Claude 오류: ' + String(j.result || '').slice(0, 200)));
        resolve(String(j.result || ''));
      } catch (_) { reject(new Error('Claude 응답을 읽지 못했어요: ' + (err || out).slice(0, 200))); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

// 이미지 파일을 임시 폴더에 내려받고 Claude 를 그 폴더에서 실행
async function withImage(storagePath, fn) {
  const url = await getDownloadURL(ref(storage, storagePath));
  const res = await fetch(url);
  if (!res.ok) throw new Error('사진을 내려받지 못했어요 (' + res.status + ')');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  try {
    fs.writeFileSync(path.join(dir, 'img.jpg'), Buffer.from(await res.arrayBuffer()));
    return await fn(dir);
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

const IMG_HEAD = '이미지 파일 img.jpg 를 Read 도구로 열어서 보고, 아래 지시대로 처리하라. 최종 응답은 JSON 객체 하나만 출력 (코드블록·설명 금지).\n\n';

async function askJson(prompt, cwd, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const raw = parseJson(await runClaude(prompt, cwd));
      if (raw) return raw;
      lastErr = new Error('Claude 응답이 JSON 이 아니에요');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ─── 정답지 읽기 (서버 api/scoresnap-grade.js 의 answerKey 흐름과 동일) ───
async function readKey(keyImagePath, hint) {
  return withImage(keyImagePath, async (dir) => {
    const numbered = hint === 'numbered', table = hint === 'table';
    const raw = await askJson(IMG_HEAD + P.buildAnswerKeyPrompt({ forceNumbered: numbered, forceTable: table }), dir);
    if (numbered) raw.layout = 'numbered';
    let processed = P.postProcessAnswerKey(raw, { forceTable: table, forceNumbered: numbered });
    if (numbered && !(processed.questions || []).length) processed._tableRejected = true;
    if (table && !(processed.questions || []).length) {
      return { testName: processed.testName, questions: [], error: '표를 읽지 못했어요. 번호형으로 바꿔 다시 시도하거나 다시 촬영해 주세요' };
    }
    if (processed._tableRejected) {
      let fixed = null;
      for (let t = 0; t < 3 && !(fixed && fixed.questions.length); t++) {
        const p2 = await askJson(IMG_HEAD + P.buildAnswerKeyPrompt({ forceNumbered: true }), dir, 1).catch(() => null);
        if (p2) { p2.layout = 'numbered'; fixed = P.postProcessAnswerKey(p2, { forceNumbered: true }); }
      }
      processed = (fixed && fixed.questions.length)
        ? fixed
        : { testName: processed.testName, questions: [], error: '정답지를 읽지 못했어요. 다시 촬영해 주세요' };
    }
    delete processed._tableRejected;
    return processed;
  });
}

// ─── 학생 채점 (서버의 student 흐름과 동일: 읽기 → 짝짓기 → 뜻 판정 → 애매하면 오답) ───
async function gradeStudent(imagePath, key) {
  const questions = key.questions;
  const isTable = key.layout === 'table' && key.givenColumn && Array.isArray(key.answerColumns) && key.answerColumns.length;
  const meta = isTable ? { layout: 'table', givenColumn: key.givenColumn, answerColumns: key.answerColumns } : null;
  return withImage(imagePath, async (dir) => {
    const prompt = IMG_HEAD + (isTable ? P.buildStudentTablePrompt(meta) : P.buildStudentGradePrompt(questions));
    const parsed = await askJson(prompt, dir);
    let processed = P.postProcessStudentGrade(isTable ? P.studentTableToRaw(parsed, meta) : parsed, questions.length, questions);
    if (isTable) { processed.layout = 'table'; processed.givenColumn = meta.givenColumn; processed.answerColumns = meta.answerColumns; }
    // 글자가 다른 한글 뜻 답은 별도 호출이 "뜻을 아는지"로 일관 판정
    try {
      const items = processed.answers.filter(a => a.needsJudge).map(a => ({ id: a.keyNo, stem: a.stem, correct: a.correctAnswer, student: a.studentAnswer }));
      if (items.length) {
        const jr = await askJson('아래 지시대로 처리하라. 최종 응답은 JSON 객체 하나만 출력 (코드블록·설명 금지).\n\n' + P.buildJudgePrompt(items), dir, 1);
        if (Array.isArray(jr.results)) processed = P.applyJudgements(processed, jr.results);
      }
    } catch (e) { log('  뜻 판정 실패 — 사진 단계 판정 유지:', e.message); }
    processed = P.finalizeAmbiguity(processed);
    processed.answers.forEach(a => { delete a.needsJudge; a._aiIsCorrect = a.isCorrect === true; });
    return { success: true, mode: 'student', model: 'claude-code', ...processed };
  });
}

// ─── 학원장 질문 답변: 답안지 사진을 다시 보고 채점 근거를 설명하거나 정정을 제안 ───
async function answerQuestion(imagePath, payload) {
  const ctx = payload.context || {};
  const hist = (payload.history || []).slice(-6).map(h => (h.role === 'user' ? '학원장: ' : '답변: ') + String(h.text || '').slice(0, 600)).join('\n');
  const imgDesc = payload.imageKind === 'marked'
    ? '이 사진은 학생 답안지 위에 채점 결과를 표시한 "채점 표시 사진"이다. 틀린 문항 번호 옆에 빨간 V가 그려져 있고, 점수칸 옆에 맞은 수/전체 문항 수가 적혀 있다(학생이 원래 쓴 손글씨·취소선과 구분하라).'
    : '이 사진은 학생이 찍어 올린 원본 답안지다(채점 표시 없음).';
  const prompt = IMG_HEAD.replace('아래 지시대로 처리하라.', '아래 질문에 답하라.') +
    imgDesc + `\n아래는 이 사진에 대한 채점 결과다(시험: ${ctx.testName || ''}, 학생: ${ctx.studentName || '이름 미상'}, ${ctx.correct}/${ctx.total}).\n` +
    JSON.stringify(ctx.answers || []) + '\n\n' +
    (hist ? '지금까지의 대화:\n' + hist + '\n\n' : '') +
    '학원장의 질문: ' + String(payload.question || '').slice(0, 1000) + '\n\n' +
    '규칙: 사진을 다시 확인해서 근거를 한국어로 간결하게(5문장 이내) 답하라. 채점 규칙은 "뜻을 알면 정답, 철자는 영어 단답만 일치, 애매하면 오답"이다. ' +
    'corrections 는 학원장이 채점의 정오를 묻거나 다시 확인해 달라고 요청한 경우에만 쓴다. 그때 잘못됐다고 판단되는 문항을 넣어라(문항 번호 no, 정답이면 isCorrect true, 이유 reason), 확신이 없으면 넣지 마라. 개수 세기·사진 설명·사용법 같은 단순 질문에는 질문에 대한 답만 하고 corrections 는 반드시 빈 배열로 둔다.\n' +
    '출력 JSON: {"answer": "답변 문장", "corrections": [{"no": 5, "isCorrect": true, "reason": "..."}]}';
  return withImage(imagePath, async (dir) => {
    const j = await askJson(prompt, dir, 2);
    return { answer: String(j.answer || '').slice(0, 2000), corrections: (Array.isArray(j.corrections) ? j.corrections : [])
      .filter(c => c && typeof c.no === 'number' && typeof c.isCorrect === 'boolean').slice(0, 20).map(c => ({ no: c.no, isCorrect: c.isCorrect, reason: String(c.reason || '').slice(0, 200) })) };
  });
}

// ─── 전용앱 일반 질문 답변 (특정 학생이 아니라 정답지 인식·앱 사용·채점 규칙 전반) ───
const APP_GUIDE = [
  'ScoreSnap 전용앱(/ss/)은 학원장이 종이 시험지를 사진으로 찍어 채점하는 앱이다.',
  '흐름: ① 정답지 1장 촬영(번호형 또는 표 형식 선택) → 문제·정답을 읽고 검토·확정 → ② 학생 답안지를 여러 장 올리면 학원 PC의 채점 프로그램(Claude Code)이 한 장씩 채점 → ③ 결과 목록·학생 상세·채점 표시 사진(틀린 문항에 V, 점수) → 카톡 전송.',
  '채점 규칙: 학생지와 정답지의 문제 순서가 달라도 인쇄된 문제(영어)로 짝짓기. 빈칸·판독불가는 오답. 한글 뜻 답은 "뜻을 아는지" 기준(복수 정답 중 하나만 써도 정답, 띄어쓰기·부호 무시), 영어 단답은 철자 일치. 확신도 0.9 미만이면 애매하면 오답 처리하고 "확인" 표시.',
  '시험지 형태: 번호형(번호 한 줄에 문제 하나, 단어|뜻 목록 포함) / 표 형식(한 줄에 칸 여러 개, 예: 불규칙동사표 — 칸 하나가 1문항).',
  '정답지가 잘 안 읽힐 때 대처: 시험지 출력 시 [답지 보기]를 켠 인쇄본이 가장 정확, 그림자 없이 종이 전체가 나오게 촬영, 형태 선택이 맞는지 확인, [정밀하게 다시 읽기], 정답칸은 검토 화면에서 직접 수정 가능.',
  '채점 기록은 서버에 5일 보관되고 폰·PC에서 같이 볼 수 있다. PC 채점 프로그램이 꺼져 있으면 채점이 대기 상태로 쌓인다. 마킹 사진은 눌렀을 때만 만들어지고 처음 한 번은 번호 위치를 찾느라 20초 정도 걸린다.',
  '정답지 확인·수정: 채점이 끝난 뒤에도 PC는 학생 목록 위 ⋯ 메뉴, 폰은 결과 목록 오른쪽 위 ⋯ 메뉴의 [정답지 확인·수정]에서 정답지 사진과 정답표를 보며 정답을 고칠 수 있다. 저장하면 학생들의 점수가 다시 계산되고, 글자가 안 맞지만 뜻이 같을 수 있는 답은 "애매"로 표시되니 확인하면 된다. 정답지 전체를 새로 올리려면 [정답지 다시 올리기]. [정답 목록 보기]는 읽기 전용.',
  '기록 삭제: PC에서는 왼쪽 채점 기록 목록의 각 행 오른쪽 휴지통 아이콘, 또는 학생 목록 위 ⋯ 메뉴의 [이 기록 삭제]. 폰에서는 결과 목록 오른쪽 위 ⋯ 메뉴의 [이 기록 삭제]. 삭제하면 폰·PC 모두에서 사라지고 사진도 지워진다. 5일이 지난 기록은 자동으로 삭제된다. 학생 한 명 삭제는 답안지 추가 화면의 사진 카드 X 버튼(채점 전)만 가능하다.',
  '앱 코드를 고치거나 데이터를 바꾸는 것은 이 대화로 할 수 없다. 앱 자체의 문제·개선 요청은 [개발자에게 전달]로 남기도록 안내하라.',
].join('\n');

async function answerGeneral(imagePath, payload) {
  const ctx = payload.context || {};
  const hist = (payload.history || []).slice(-6).map(h => (h.role === 'user' ? '학원장: ' : '답변: ') + String(h.text || '').slice(0, 600)).join('\n');
  const prompt = (imagePath ? '이미지 파일 img.jpg 는 사용자가 지금 화면에서 다루는 시험지 사진이다. Read 도구로 열어 확인하라.\n' : '') +
    '너는 ScoreSnap 전용앱의 도우미다. 아래 앱 설명과 현재 화면 상태를 바탕으로 학원장의 질문에 한국어로 친절하고 간결하게(7문장 이내) 답하라. 모르면 모른다고 하고 추측하지 마라.\n\n' +
    '[앱 설명]\n' + APP_GUIDE + '\n\n[현재 화면 상태]\n' + JSON.stringify(ctx).slice(0, 8000) + '\n\n' +
    (hist ? '[지금까지의 대화]\n' + hist + '\n\n' : '') +
    '[학원장의 질문]\n' + String(payload.question || '').slice(0, 1000) + '\n\n' +
    '최종 응답은 JSON 객체 하나만 출력: {"answer": "답변 문장"}';
  const run = async (dir) => {
    const j = await askJson(prompt, dir, 2);
    return { answer: String(j.answer || '').slice(0, 2500), corrections: [] };
  };
  if (imagePath) return withImage(imagePath, run);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  try { return await run(dir); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

// ─── 마킹용 위치 찾기 (Google Vision 대신 Claude) — 지시문·검증은 marks.js ───
async function findMarkWords(imagePath, payload) {
  return withImage(imagePath, async (dir) => {
    if (payload && payload.table) {      // 표 형식: 열 이름 + 줄마다 인쇄된 기준 단어
      const meta = payload.table;
      const j = await askJson(IMG_HEAD + M.buildTablePrompt(meta), dir);
      return { words: M.tableToWords(j, meta) };
    }
    const total = (payload && payload.total) || 0;
    const j = await askJson(IMG_HEAD + M.buildNumbersPrompt(total), dir);
    return { words: M.numbersToWords(j, total) };
  });
}

// ─── Firebase ───
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
let AID = 'default';

async function login() {
  if (process.env.SS_CUSTOM_TOKEN) {   // 개발 테스트용 (실사용은 아이디/비밀번호)
    const cred = await signInWithCustomToken(auth, process.env.SS_CUSTOM_TOKEN);
    const tok = await cred.user.getIdTokenResult();
    AID = tok.claims.academyId || 'default';
    log('로그인 OK(테스트 토큰) | 학원', AID, '| 역할', tok.claims.role);
    return;
  }
  const key = String(CFG.username || '').trim().toLowerCase();
  const lk = await getDoc(doc(db, 'usernameLookup', key));
  if (!lk.exists() || !lk.data().email) throw new Error('아이디를 찾을 수 없어요: ' + CFG.username);
  const cred = await signInWithEmailAndPassword(auth, lk.data().email, CFG.password);
  const tok = await cred.user.getIdTokenResult();
  AID = tok.claims.academyId || 'default';
  log('로그인 OK:', cred.user.email, '| 학원', AID, '| 역할', tok.claims.role);
}

const clean = (o) => JSON.parse(JSON.stringify(o ?? null));
const sessRef = (sid) => doc(db, 'scoresnapSessions', sid);

// 여러 PC 가 동시에 같은 건을 가져가지 않도록 트랜잭션으로 잠금
async function claim(refDoc, fromStatuses, statusField, toStatus) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(refDoc);
    if (!s.exists()) return false;
    const d = s.data();
    const cur = d[statusField];
    const stale = d.claimedAt && d.claimedAt.toMillis && (Date.now() - d.claimedAt.toMillis() > STALE_MS);
    if (!(fromStatuses.includes(cur) || (cur === toStatus && stale))) return false;
    tx.update(refDoc, { [statusField]: toStatus, claimedBy: WORKER, claimedAt: serverTimestamp() });
    return true;
  });
}

// 학생 채점 결과를 학생 기록에 직접 써 넣은 뒤 기록 목록용 요약(채점 인원·평균·확인 필요)을 갱신
async function refreshSessionMeta(sid) {
  const all = await getDocs(query(collection(db, 'scoresnapSessions', sid, 'students'), where('academyId', '==', AID)));
  const done = all.docs.map(d => d.data()).filter(x => x.status === 'done' && x.result);
  const pct = (r) => r.totalQuestions > 0 ? Math.round((r.correctCount / r.totalQuestions) * 100) : 0;
  const avg = done.length ? Math.round(done.reduce((a, x) => a + pct(x.result), 0) / done.length) : 0;
  const check = done.filter(x => ((x.result.uncertainQuestions || []).length > 0 && !x.result.checked) || !String(x.result.studentName || '').trim()).length;
  await updateDoc(sessRef(sid), { studentCount: done.length, avgScore: avg, needCheck: check, workerSeenAt: serverTimestamp() });
}

// 전용앱(/ss/)이 올린 작업 한 건 처리
//   job = { kind:'job', jobType:'key'|'student'|'ocr', status:'queued', imagePath, payload, needsWork:true }
//   key     : payload { layoutHint }                     → result = 정답지(questions…)      — 화면이 기다렸다가 받아 간다
//   ocr     : payload { total } | { table }              → result = 글자 위치 목록          — 화면이 기다렸다가 받아 간다
//   student : payload { answerKey, target:{sid,docId,keepName} }
//             → 결과를 그 학생 기록(students/{docId})에 직접 써 넣는다. 화면을 닫아도 채점은 계속된다.
async function handleStudentJob(jd) {
  const j = jd.data();
  const { sid, docId, keepName } = j.payload.target;
  const stRef = doc(db, 'scoresnapSessions', sid, 'students', docId);
  const t0 = Date.now();
  log(`[${sid}/${docId}] 학생 채점 중...`);
  const exists = (await getDoc(stRef)).exists();
  if (!exists) { log('  학생 기록이 이미 없어요 — 건너뜀'); await deleteDoc(jd.ref); return; }
  await updateDoc(stRef, { status: 'grading', error: '', startedAt: serverTimestamp() });
  try {
    const result = await gradeStudent(j.imagePath, j.payload.answerKey);
    if (keepName) result.studentName = keepName;     // 정답지 교체 재채점은 학원장이 고친 이름 유지
    await updateDoc(stRef, { result: clean(result), status: 'done', error: '', gradeMs: Date.now() - t0, updatedAt: serverTimestamp() });
    log(`  → ${result.studentName || '(이름 없음)'} ${result.correctCount}/${result.totalQuestions} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  } catch (e) {
    log('  실패:', e.message);
    await updateDoc(stRef, { status: 'error', error: String(e.message || e).slice(0, 300), updatedAt: serverTimestamp() });
  }
  await deleteDoc(jd.ref);
  await refreshSessionMeta(sid).catch(err => log('  기록 요약 갱신 실패:', err.message));
}

async function handleJob(jd) {
  const ok = await claim(jd.ref, ['queued'], 'status', 'working');
  if (!ok) return false;
  const j = jd.data();
  if (j.jobType === 'student' && j.payload && j.payload.target) { await handleStudentJob(jd); return true; }
  const t0 = Date.now();
  log(`[${jd.id}] ${j.jobType === 'key' ? '정답지 읽는 중...' : j.jobType === 'ocr' ? '마킹 위치 찾는 중...' : j.jobType === 'ask' ? '질문 답변 중...' : '학생 채점 중...'}`);
  try {
    let result;
    if (j.jobType === 'ask') {
      result = (j.payload && j.payload.mode === 'general') ? await answerGeneral(j.imagePath, j.payload) : await answerQuestion(j.imagePath, j.payload || {});
      log(`  → 답변 완료 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    } else if (j.jobType === 'ocr') {
      result = await findMarkWords(j.imagePath, j.payload);
      log(`  → 번호 위치 ${result.words.length}개 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    } else if (j.jobType === 'key') {
      result = await readKey(j.imagePath, (j.payload && j.payload.layoutHint) || 'numbered');
      if (!result.questions || !result.questions.length) throw new Error(result.error || '문항을 읽지 못했어요');
      log(`  → 정답지 ${result.questions.length}문항 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    } else {
      result = await gradeStudent(j.imagePath, j.payload.answerKey);
      log(`  → ${result.studentName || '(이름 없음)'} ${result.correctCount}/${result.totalQuestions} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    }
    await updateDoc(jd.ref, { status: 'done', result: clean(result), error: '', needsWork: false, finishedAt: serverTimestamp() });
  } catch (e) {
    log('  실패:', e.message);
    await updateDoc(jd.ref, { status: 'error', error: String(e.message || e).slice(0, 300), needsWork: false, finishedAt: serverTimestamp() });
  }
  return true;
}

// 상태 알림: 전용앱이 'PC 켜짐/꺼짐'과 대기 건수를 보여주도록 30초마다 기록
const HB_ID = 'worker_' + AID + '_' + WORKER.replace(/[^A-Za-z0-9_-]/g, '_');
let hbBusy = false, hbQueued = 0;
async function heartbeat() {
  try {
    await setDoc(doc(db, 'scoresnapSessions', HB_ID), {
      academyId: AID, kind: 'worker', keyStatus: 'worker', workerName: WORKER,
      lastSeen: serverTimestamp(), busy: hbBusy, queued: hbQueued, version: 1,
    });
  } catch (e) { log('상태 기록 실패:', e.message); }
}

let busy = false, again = false;
async function pump() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const snap = await getDocs(query(collection(db, 'scoresnapSessions'),
        where('academyId', '==', AID), where('needsWork', '==', true)));
      hbQueued = snap.docs.filter(d => d.data().kind === 'job' && d.data().status === 'queued').length;
      if (snap.size) log('대기 작업 확인:', snap.size, '건 (작업 ' + snap.docs.filter(d => d.data().kind === 'job').length + ')');
      // 먼저 올라온 순서대로 한 건씩
      const jobs = snap.docs.filter(d => d.data().kind === 'job')
        .sort((x, y) => ((x.data().createdAt && x.data().createdAt.toMillis()) || 0) - ((y.data().createdAt && y.data().createdAt.toMillis()) || 0));
      for (const jd of jobs) {
        hbBusy = true; heartbeat();
        try { await handleJob(jd); } catch (e) { log(`[${jd.id}] 처리 오류:`, e.message); }
        hbBusy = false; hbQueued = Math.max(0, hbQueued - 1); heartbeat();
      }
    } while (again);
  } catch (e) { log('확인 오류:', e.message); }
  finally { busy = false; }
}

// 설치 점검: node worker.js --check  → 로그인·학원장 권한·상태 기록을 확인하고 결과 한 줄(CHECK_OK/CHECK_FAIL)만 출력
if (process.argv.includes('--check')) {
  (async () => {
    try {
      await login();
      const tok = await auth.currentUser.getIdTokenResult();
      if (!/^(admin|super_admin)$/.test(tok.claims.role || '')) { console.log('CHECK_FAIL 학원장 계정이 아니에요. 학생 계정이 아니라 학원장 아이디로 설치해 주세요.'); process.exit(0); }
      await setDoc(doc(db, 'scoresnapSessions', HB_ID), { academyId: AID, kind: 'worker', keyStatus: 'worker', workerName: WORKER, lastSeen: serverTimestamp(), busy: false, queued: 0, version: 1 });
      const back = await getDoc(doc(db, 'scoresnapSessions', HB_ID));
      if (!back.exists()) { console.log('CHECK_FAIL 학원 서버에 기록하지 못했어요.'); process.exit(0); }
      console.log('CHECK_OK 학원 ' + AID + ' · ' + (auth.currentUser.email || ''));
    } catch (e) {
      const m = String(e.message || e);
      console.log('CHECK_FAIL ' + (/invalid-credential|wrong-password|invalid-login/.test(m) ? '아이디 또는 비밀번호가 맞지 않아요.' : /찾을 수 없/.test(m) ? m : /network|fetch|offline/i.test(m) ? '인터넷 연결을 확인해 주세요.' : m));
    }
    process.exit(0);
  })();
} else (async () => {
  log('ScoreSnap PC 채점 프로그램 시작 | Claude:', CLAUDE);
  await login();
  // 새 요청이 생기면 바로 깨어남 + 1분마다 점검(멈춘 작업 되살리기)
  onSnapshot(query(collection(db, 'scoresnapSessions'), where('academyId', '==', AID), where('needsWork', '==', true)),
    () => { pump(); }, (e) => log('실시간 연결 오류:', e.message));
  setInterval(pump, 60 * 1000);
  heartbeat(); setInterval(heartbeat, 30 * 1000);
  // --auto-exit: 앱(브라우저)이 닫혀 4분 넘게 신호가 없고 할 일이 없으면 스스로 종료 (앱과 한 몸처럼 동작)
  if (process.argv.includes('--auto-exit')) {
    let lastVal = null, lastChange = Date.now();   // 값이 바뀐 시각은 이 PC 시계로 기록 (시계가 달라도 안전)
    setInterval(async () => {
      try {
        const d = await getDoc(doc(db, 'scoresnapSessions', 'app_' + AID));
        const v = d.exists() && d.data().lastOpen && d.data().lastOpen.toMillis ? d.data().lastOpen.toMillis() : 0;
        if (v !== lastVal) { lastVal = v; lastChange = Date.now(); }
      } catch (_) { lastChange = Date.now(); return; }   // 연결 문제일 때는 끄지 않음
      if (Date.now() - lastChange > 4 * 60 * 1000 && !hbBusy && hbQueued === 0) {
        log('앱이 닫혀 있어 채점 프로그램을 종료합니다.');
        try { await deleteDoc(doc(db, 'scoresnapSessions', HB_ID)); } catch (_) {}
        process.exit(0);
      }
    }, 30 * 1000);
  }
  log('대기 중 — 전용앱에서 채점을 요청하면 처리합니다. (이 창을 닫으면 채점이 멈춥니다)');
  pump();
})().catch(e => { console.error('시작 실패:', e.message); process.exit(1); });
