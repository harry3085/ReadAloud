// ScoreSnap 채점 속도·정확도 비교 실험 (읽기 전용 — 서버 데이터는 건드리지 않음)
// 서버에 남은 채점 기록의 사진 + 정답지를 다시 채점해서, 조건별 시간과 기존 결과와의 일치율을 비교한다.
// 사용: node scripts/diag/bench-grade.js <sessionId> <학생수> <조건목록,쉼표> [동시수]
//   조건: base(현재 방식)  inline(사진을 요청에 직접 첨부)  inline-haiku  inline-sonnet  read-haiku  lean(가벼운 실행 옵션)
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { getDb, getAdmin } = require('../lib/firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const P = require('../../api/_lib/scoresnap-prompt.js');

const [SID, NSTU = '3', CONDS = 'base', CONC = '1'] = process.argv.slice(2);
const BUCKET = 'readaloud-51113.firebasestorage.app';

function findClaude() {
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  const dirs = fs.readdirSync(ext).filter(n => /^anthropic\.claude-code-.*win32/.test(n)).sort().reverse();
  for (const d of dirs) { const p = path.join(ext, d, 'resources', 'native-binary', 'claude.exe'); if (fs.existsSync(p)) return p; }
  return 'claude';
}
const CLAUDE = findClaude();

function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

// 조건 해석
function cfgOf(cond) {
  return {
    inline: /inline/.test(cond),
    model: /haiku/.test(cond) ? 'haiku' : /sonnet/.test(cond) ? 'sonnet' : '',
    lean: /lean/.test(cond),
  };
}

// Claude 한 번 호출. imgBuf 가 있고 inline 이면 요청에 사진을 직접 넣고, 아니면 Read 도구로 읽게 한다.
function call(prompt, imgBuf, cfg, stats) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssb-'));
    const args = ['-p'];
    if (cfg.model) args.push('--model', cfg.model);
    if (cfg.lean) args.push('--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config');
    let stdin;
    const useInline = cfg.inline && imgBuf;
    if (useInline) {
      args.push('--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose');
      stdin = JSON.stringify({ type: 'user', message: { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgBuf.toString('base64') } },
        { type: 'text', text: prompt },
      ] } }) + '\n';
    } else {
      args.push('--allowedTools', 'Read', '--output-format', 'json');
      if (imgBuf) fs.writeFileSync(path.join(dir, 'img.jpg'), imgBuf);
      stdin = (imgBuf ? '이미지 파일 img.jpg 를 Read 도구로 열어서 보고, 아래 지시대로 처리하라. 최종 응답은 JSON 객체 하나만 출력 (코드블록·설명 금지).\n\n' : '아래 지시대로 처리하라. 최종 응답은 JSON 객체 하나만 출력 (코드블록·설명 금지).\n\n') + prompt;
    }
    const t0 = Date.now();
    const child = spawn(CLAUDE, args, { cwd: dir, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { child.kill(); reject(new Error('시간 초과')); }, 5 * 60 * 1000);
    child.on('close', () => {
      clearTimeout(timer); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      let j = null;
      if (useInline) { for (const line of out.split('\n')) { try { const o = JSON.parse(line); if (o.type === 'result') j = o; } catch (_) {} } }
      else { try { j = JSON.parse(out); } catch (_) {} }
      if (!j || j.is_error) return reject(new Error('Claude 오류: ' + String((j && j.result) || err || out).slice(0, 200)));
      stats.calls++; stats.wall += (Date.now() - t0) / 1000; stats.api += (j.duration_api_ms || 0) / 1000; stats.turns += j.num_turns || 0; stats.cost += j.total_cost_usd || 0;
      resolve(String(j.result || ''));
    });
    child.stdin.write(stdin); child.stdin.end();
  });
}

async function askJson(prompt, imgBuf, cfg, stats, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = parseJson(await call(prompt, imgBuf, cfg, stats)); if (r) return r; last = new Error('JSON 아님'); } catch (e) { last = e; }
  }
  throw last;
}

async function grade(imgBuf, key, cfg, stats) {
  const questions = key.questions;
  const isTable = key.layout === 'table' && key.givenColumn && Array.isArray(key.answerColumns) && key.answerColumns.length;
  const meta = isTable ? { layout: 'table', givenColumn: key.givenColumn, answerColumns: key.answerColumns } : null;
  const prompt = isTable ? P.buildStudentTablePrompt(meta) : P.buildStudentGradePrompt(questions);
  const parsed = await askJson(prompt, imgBuf, cfg, stats);
  let processed = P.postProcessStudentGrade(isTable ? P.studentTableToRaw(parsed, meta) : parsed, questions.length, questions);
  const items = processed.answers.filter(a => a.needsJudge).map(a => ({ id: a.keyNo, stem: a.stem, correct: a.correctAnswer, student: a.studentAnswer }));
  if (items.length) {
    try {
      const jr = await askJson(P.buildJudgePrompt(items), null, { ...cfg, inline: false }, stats, 1);
      if (Array.isArray(jr.results)) processed = P.applyJudgements(processed, jr.results);
    } catch (_) {}
  }
  processed = P.finalizeAmbiguity(processed);
  return processed;
}

(async () => {
  const db = getDb(); const bucket = getStorage(getAdmin()).bucket(BUCKET);
  const sref = db.collection('scoresnapSessions').doc(SID);
  const key = ((await sref.collection('key').doc('answerKey').get()).data() || {}).answerKey;
  const sts = (await sref.collection('students').get()).docs.map(d => d.data()).filter(x => x.imagePath && x.result).sort((a, b) => (a.idx || 0) - (b.idx || 0)).slice(0, Number(NSTU));
  console.log(`세션 ${SID} | 문항 ${key.questions.length} | 학생 ${sts.length}명 | 동시 ${CONC}\n`);
  const imgs = [];
  for (const x of sts) imgs.push((await bucket.file(x.imagePath).download())[0]);
  const conc = Number(CONC);
  for (const cond of CONDS.split(',')) {
    const cfg = cfgOf(cond);
    const stats = { calls: 0, wall: 0, api: 0, turns: 0, cost: 0 };
    const results = new Array(sts.length);
    const t0 = Date.now(); let next = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (next < sts.length) {
        const i = next++;
        try { results[i] = await grade(imgs[i], key, cfg, stats); } catch (e) { results[i] = { error: e.message }; }
      }
    }));
    const total = (Date.now() - t0) / 1000;
    let agree = 0, cmp = 0, scoreSame = 0;
    const lines = [];
    results.forEach((r, i) => {
      const base = sts[i].result;
      if (r.error) { lines.push(`   - ${base.studentName}: 오류 ${r.error}`); return; }
      const bm = new Map((base.answers || []).map(a => [a.keyNo ?? a.no, !!a.isCorrect]));
      let diff = [];
      (r.answers || []).forEach(a => { const k = a.keyNo ?? a.no; if (bm.has(k)) { cmp++; if (bm.get(k) === !!a.isCorrect) agree++; else diff.push(k); } });
      if (r.correctCount === base.correctCount) scoreSame++;
      lines.push(`   - ${(base.studentName || '').padEnd(6)} 기존 ${base.correctCount}/${base.totalQuestions} → 이번 ${r.correctCount}/${r.totalQuestions}${diff.length ? ' | 다른 문항: ' + diff.join(',') : ''}`);
    });
    console.log(`■ ${cond}  | 전체 ${total.toFixed(0)}초 (학생당 평균 ${(total / sts.length).toFixed(0)}초) | 호출 ${stats.calls}회, 호출당 ${(stats.wall / Math.max(1, stats.calls)).toFixed(0)}초(모델응답 ${(stats.api / Math.max(1, stats.calls)).toFixed(0)}초), 턴 ${stats.turns} | $${stats.cost.toFixed(2)} | 점수 일치 ${scoreSame}/${sts.length}, 문항 일치 ${cmp ? (agree / cmp * 100).toFixed(1) : '-'}%`);
    lines.forEach(l => console.log(l));
    console.log('');
  }
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
