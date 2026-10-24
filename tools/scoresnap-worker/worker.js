// ScoreSnap PC 채점 프로그램
// 전용앱(/ss/)에서 올린 정답지·학생 사진을 서버에서 가져와 Claude Code(구독, API 요금 없음)로 채점하고
// 결과를 같은 서버에 저장한다.
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

async function handleSession(sd) {
  const sid = sd.id;
  let m = sd.data();

  // 1) 정답지
  if (m.keyStatus === 'queued' || m.keyStatus === 'reading') {
    const ok = await claim(sessRef(sid), ['queued'], 'keyStatus', 'reading');
    if (ok) {
      log(`[${sid}] 정답지 읽는 중...`);
      const t0 = Date.now();
      const keyRef = doc(db, 'scoresnapSessions', sid, 'key', 'answerKey');
      try {
        const kd = (await getDoc(keyRef)).data() || {};
        if (!kd.keyImagePath) throw new Error('정답지 사진이 없어요');
        const key = await readKey(kd.keyImagePath, m.layoutHint || 'numbered');
        if (!key.questions || !key.questions.length) throw new Error(key.error || '문항을 읽지 못했어요');
        await updateDoc(keyRef, { answerKey: clean(key) });
        await updateDoc(sessRef(sid), {
          keyStatus: 'ready', keyError: '', testName: String(key.testName || ''),
          questionCount: key.questions.length, workerSeenAt: serverTimestamp(),
        });
        log(`[${sid}] 정답지 완료: ${key.questions.length}문항 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
      } catch (e) {
        log(`[${sid}] 정답지 실패:`, e.message);
        await updateDoc(sessRef(sid), { keyStatus: 'error', keyError: String(e.message || e).slice(0, 300) });
      }
    }
    m = (await getDoc(sessRef(sid))).data();
  }

  // 2) 학생 채점 — 한 명씩
  if (m.keyStatus === 'ready') {
    const key = ((await getDoc(doc(db, 'scoresnapSessions', sid, 'key', 'answerKey'))).data() || {}).answerKey;
    for (;;) {
      const qs = await getDocs(query(collection(db, 'scoresnapSessions', sid, 'students'),
        where('academyId', '==', AID), where('status', 'in', ['queued', 'grading'])));
      const cand = qs.docs.filter(d => d.data().status === 'queued'
        || (d.data().claimedAt && Date.now() - d.data().claimedAt.toMillis() > STALE_MS));
      if (!cand.length) break;
      let did = false;
      for (const sdoc of cand) {
        if (!(await claim(sdoc.ref, ['queued'], 'status', 'grading'))) continue;
        const st = sdoc.data();
        log(`[${sid}] 학생 채점: ${sdoc.id}`);
        const t0 = Date.now();
        try {
          const result = await gradeStudent(st.imagePath, key);
          await updateDoc(sdoc.ref, { result: clean(result), status: 'done', error: '', updatedAt: serverTimestamp() });
          log(`  → ${result.studentName || '(이름 없음)'} ${result.correctCount}/${result.totalQuestions} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
        } catch (e) {
          log('  채점 실패:', e.message);
          await updateDoc(sdoc.ref, { status: 'error', error: String(e.message || e).slice(0, 300) });
        }
        await updateDoc(sessRef(sid), { workerSeenAt: serverTimestamp() });
        did = true;
        break;
      }
      if (!did) break;
    }
  }

  // 3) 마무리 — 남은 일이 없으면 needsWork 해제, 완료 학생 수 반영
  const all = await getDocs(query(collection(db, 'scoresnapSessions', sid, 'students'), where('academyId', '==', AID)));
  const stat = all.docs.map(d => d.data().status);
  const pending = stat.filter(s => s === 'queued' || s === 'grading').length;
  const done = stat.filter(s => s === 'done').length;
  const cur = (await getDoc(sessRef(sid))).data() || {};
  const keyBusy = cur.keyStatus === 'queued' || cur.keyStatus === 'reading';
  await updateDoc(sessRef(sid), { studentCount: done, needsWork: pending > 0 || keyBusy });
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
      for (const sd of snap.docs) {
        try { await handleSession(sd); } catch (e) { log(`[${sd.id}] 처리 오류:`, e.message); }
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
  log('대기 중 — 전용앱에서 [채점 시작]을 누르면 처리합니다. (이 창을 닫으면 채점이 멈춥니다)');
  pump();
})().catch(e => { console.error('시작 실패:', e.message); process.exit(1); });
