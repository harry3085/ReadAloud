// ScoreSnap PC 채점 프로그램 설치 패키지 만들기
// 실행: node tools/scoresnap-worker/make-package.js
// 결과: dist/ScoreSnap-PC채점프로그램/ 폴더 + 같은 이름의 .zip  (학원 PC 에서 설치.bat 더블클릭)
// 패키지에는 Node(node.exe)·프로그램 파일·firebase 라이브러리가 모두 들어 있어 학원 PC 에 따로 설치할 것이 없다.
// (Claude Code 는 학원 PC 에 이미 설치·로그인되어 있어야 한다. 비밀번호는 패키지에 넣지 않고 설치할 때 입력)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKER = __dirname;
const NAME = 'ScoreSnap-PC채점프로그램';
const OUT = path.join(ROOT, 'dist', NAME);

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function cp(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true }); }

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

// 1) 의존 라이브러리 확인 (firebase)
if (!fs.existsSync(path.join(WORKER, 'node_modules', 'firebase'))) {
  console.log('npm install ...');
  execSync('npm install --omit=dev', { cwd: WORKER, stdio: 'inherit' });
}

// 2) 앱 파일
const APP = path.join(OUT, 'files', 'app');
for (const f of ['worker.js', 'marks.js', 'package.json']) cp(path.join(WORKER, f), path.join(APP, 'tools', 'scoresnap-worker', f));
cp(path.join(WORKER, 'node_modules'), path.join(APP, 'tools', 'scoresnap-worker', 'node_modules'));
cp(path.join(ROOT, 'api', '_lib', 'scoresnap-prompt.js'), path.join(APP, 'api', '_lib', 'scoresnap-prompt.js'));

// 3) Node 실행 파일 (이 PC 의 것을 그대로 — 학원 PC 에 Node 설치 불필요)
cp(process.execPath, path.join(OUT, 'files', 'node', 'node.exe'));

// 4) 설치 스크립트
const bat = [
  '@echo off',
  'chcp 65001 >nul',
  'title ScoreSnap PC Setup',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"',
  'echo.',
  'pause',
  '',
].join('\r\n');
fs.writeFileSync(path.join(OUT, '설치.bat'), bat, 'utf8');   // BOM 없음 (첫 줄들은 ASCII)

const ps1 = fs.readFileSync(path.join(WORKER, 'install.template.ps1'), 'utf8').replace(/^\uFEFF/, '');
fs.writeFileSync(path.join(OUT, 'install.ps1'), '\uFEFF' + ps1.replace(/\r?\n/g, '\r\n'), 'utf8');   // PowerShell 5.1 은 BOM 필요

fs.writeFileSync(path.join(OUT, '읽어보세요.txt'), [
  'ScoreSnap PC 채점 프로그램 설치 방법',
  '',
  '1. 이 폴더를 학원 PC 에 복사합니다 (zip 이면 압축 풀기).',
  '2. [설치.bat] 을 더블클릭합니다.',
  '3. 화면 안내를 따라갑니다: 학원장 아이디/비밀번호 입력 → Claude Code 찾기·로그인 확인 → 서버 연결 점검.',
  '   (Claude 데스크탑이 없으면 먼저 https://claude.ai/download 에서 설치·로그인하고 Code 기능을 한 번 열어 두세요)',
  '4. 끝나면 앱(raloud.vercel.app/ss) 상단에 "PC 켜짐"이 보입니다.',
  '',
  '- PC 를 켜고 로그인하면 자동으로 시작됩니다 (작업표시줄에 최소화).',
  '- 중지: 설치 폴더(%LOCALAPPDATA%\\ScoreSnapWorker)의 stop.bat',
  '- 업데이트: 새 패키지의 설치.bat 을 다시 실행하면 로그인 정보는 그대로 두고 프로그램만 교체합니다.',
  '- 필요한 것: 학원 PC 에 Claude Code 가 설치·로그인되어 있어야 합니다. 절전 모드는 꺼 두세요.',
  '',
].join('\r\n'), 'utf8');

// 5) zip
const zip = path.join(ROOT, 'dist', NAME + '.zip');
rmrf(zip);
try {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zip}' -Force"`, { stdio: 'inherit' });
} catch (e) { console.log('zip 생성 실패 — 폴더를 그대로 복사해도 됩니다:', e.message); }

const mb = (p) => { try { return (fs.statSync(p).size / 1048576).toFixed(0) + 'MB'; } catch (_) { return '-'; } };
console.log('완료:', OUT);
console.log('zip:', zip, mb(zip));
