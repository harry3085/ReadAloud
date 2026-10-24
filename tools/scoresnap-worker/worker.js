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
  getFirestore, collection, doc, query, where, getDocs, getDoc, updateDoc, runTransaction,
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
  return 'claude';
}
const CLAUDE = findClaude();

function runClaude(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--allowedTools', 'Read', '--output-format', 'json'];
    if (CFG.model) args.push('--model', CFG.model);
    const child = spawn(CLAUDE, args, { cwd, windowsHide: true });
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

// 전용앱(/ss/)이 올린 작업 한 건 처리
//   job = { kind:'job', jobType:'key'|'student', status:'queued', imagePath, payload, needsWork:true }
//   key     : payload { layoutHint }                     → result = 정답지(questions…)
//   student : payload { answerKey:{questions,layout,…} } → result = 채점 결과
async function handleJob(jd) {
  const ok = await claim(jd.ref, ['queued'], 'status', 'working');
  if (!ok) return false;
  const j = jd.data();
  const t0 = Date.now();
  log(`[${jd.id}] ${j.jobType === 'key' ? '정답지 읽는 중...' : j.jobType === 'ocr' ? '마킹 위치 찾는 중...' : '학생 채점 중...'}`);
  try {
    let result;
    if (j.jobType === 'ocr') {
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

let busy = false, again = false;
async function pump() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const snap = await getDocs(query(collection(db, 'scoresnapSessions'),
        where('academyId', '==', AID), where('needsWork', '==', true)));
      if (snap.size) log('대기 작업 확인:', snap.size, '건 (작업 ' + snap.docs.filter(d => d.data().kind === 'job').length + ')');
      // 먼저 올라온 순서대로 한 건씩
      const jobs = snap.docs.filter(d => d.data().kind === 'job')
        .sort((x, y) => ((x.data().createdAt && x.data().createdAt.toMillis()) || 0) - ((y.data().createdAt && y.data().createdAt.toMillis()) || 0));
      for (const jd of jobs) {
        try { await handleJob(jd); } catch (e) { log(`[${jd.id}] 처리 오류:`, e.message); }
      }
    } while (again);
  } catch (e) { log('확인 오류:', e.message); }
  finally { busy = false; }
}

(async () => {
  log('ScoreSnap PC 채점 프로그램 시작 | Claude:', CLAUDE);
  await login();
  // 새 요청이 생기면 바로 깨어남 + 1분마다 점검(멈춘 작업 되살리기)
  onSnapshot(query(collection(db, 'scoresnapSessions'), where('academyId', '==', AID), where('needsWork', '==', true)),
    () => { pump(); }, (e) => log('실시간 연결 오류:', e.message));
  setInterval(pump, 60 * 1000);
  log('대기 중 — 전용앱에서 채점을 요청하면 처리합니다. (이 창을 닫으면 채점이 멈춥니다)');
  pump();
})().catch(e => { console.error('시작 실패:', e.message); process.exit(1); });
