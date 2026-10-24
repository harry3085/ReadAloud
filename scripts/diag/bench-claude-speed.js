// Claude Code(claude -p) 호출 시간 측정: 시작 오버헤드 / 사진 읽기 / 모델별 비교
// 실행: node scripts/diag/bench-claude-speed.js <사진경로> [반복횟수]
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const IMG = process.argv[2];
const REPS = Number(process.argv[3] || 1);
if (!IMG || !fs.existsSync(IMG)) { console.log('사용법: node bench-claude-speed.js <사진경로> [반복]'); process.exit(1); }

function findClaude() {
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  const dirs = fs.readdirSync(ext).filter(n => /^anthropic\.claude-code-.*win32/.test(n)).sort().reverse();
  for (const d of dirs) { const p = path.join(ext, d, 'resources', 'native-binary', 'claude.exe'); if (fs.existsSync(p)) return p; }
  return 'claude';
}
const CLAUDE = findClaude();

function run(label, prompt, extraArgs, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = ['-p', '--allowedTools', 'Read', '--output-format', 'json', ...extraArgs];
    const child = spawn(CLAUDE, args, { cwd, windowsHide: true });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.on('close', () => {
      const wall = ((Date.now() - t0) / 1000).toFixed(1);
      let j = {}; try { j = JSON.parse(out); } catch (_) {}
      const models = Object.keys(j.modelUsage || {}).join(',');
      console.log(`${label.padEnd(34)} 전체 ${wall.padStart(5)}s | API ${((j.duration_api_ms || 0) / 1000).toFixed(1).padStart(5)}s | 턴 ${j.num_turns ?? '-'} | 모델 ${models || '-'} | $${(j.total_cost_usd || 0).toFixed(4)} | ${j.is_error ? '오류' : 'ok'}`);
      resolve();
    });
    child.stdin.write(prompt); child.stdin.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssbench-'));
  fs.copyFileSync(IMG, path.join(dir, 'img.jpg'));
  const P_TEXT = 'OK 라고만 답하라.';
  const P_IMG = '이미지 파일 img.jpg 를 Read 도구로 열어서 보고, 사진에 보이는 문제 번호와 학생이 쓴 글자를 JSON {"items":[{"no":1,"text":"..."}]} 로만 출력하라. 설명 금지.';
  console.log('Claude:', CLAUDE, '\n');
  for (let i = 0; i < REPS; i++) {
    await run('A 글자만(시작 오버헤드)·기본모델', P_TEXT, [], dir);
    await run('B 사진 읽기·기본모델', P_IMG, [], dir);
    await run('C 사진 읽기·sonnet', P_IMG, ['--model', 'sonnet'], dir);
    await run('D 사진 읽기·haiku', P_IMG, ['--model', 'haiku'], dir);
    await run('E 글자만·haiku', P_TEXT, ['--model', 'haiku'], dir);
  }
  fs.rmSync(dir, { recursive: true, force: true });
})();
