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

const ps1 = String.raw`# ScoreSnap PC 채점 프로그램 설치
param([string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'ScoreSnapWorker'), [string]$User = '', [string]$Pass = '', [string]$WorkerName = '', [switch]$NoTask, [switch]$NoStart)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'files'
Write-Host ''
Write-Host '=== ScoreSnap PC 채점 프로그램 설치 ===' -ForegroundColor Cyan
Write-Host ('설치 위치: ' + $InstallDir)

# 실행 중이면 먼저 종료 (재설치/업데이트)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 파일 복사 (설정 config.json 은 보존)
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $src 'app') $InstallDir
Copy-Item -Recurse -Force (Join-Path $src 'node') $InstallDir
$wdir = Join-Path $InstallDir 'app\tools\scoresnap-worker'
$cfgPath = Join-Path $wdir 'config.json'

# 로그인 정보 (처음 한 번만 입력)
if (-not (Test-Path $cfgPath)) {
  if (-not $User) { $User = Read-Host '학원장 로그인 아이디' }
  if (-not $Pass) { $sec = Read-Host '학원장 로그인 비밀번호' -AsSecureString; $Pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)) }
  if (-not $WorkerName) { $WorkerName = $env:COMPUTERNAME }
  $cfg = [ordered]@{ username = $User; password = $Pass; claudePath = ''; model = ''; workerName = $WorkerName }
  [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Write-Host '로그인 정보를 저장했어요.'
} else { Write-Host '기존 로그인 정보를 그대로 사용해요.' }

# 실행/중지 파일
$run = @'
@echo off
chcp 65001 >nul
title ScoreSnap PC Worker
cd /d "%~dp0app\tools\scoresnap-worker"
"%~dp0node\node.exe" worker.js
echo.
echo (stopped) - press any key to close
pause >nul
'@
[IO.File]::WriteAllText((Join-Path $InstallDir 'run.bat'), $run, (New-Object Text.UTF8Encoding($false)))
$stop = @'
@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -like '*ScoreSnapWorker*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo stopped.
pause
'@
[IO.File]::WriteAllText((Join-Path $InstallDir 'stop.bat'), $stop, (New-Object Text.UTF8Encoding($false)))

# Claude Code 확인
$claude = $null
try { $claude = (Get-Command claude -ErrorAction SilentlyContinue).Source } catch {}
if (-not $claude) {
  $ext = Join-Path $env:USERPROFILE '.vscode\extensions'
  if (Test-Path $ext) { $claude = Get-ChildItem $ext -Directory -Filter 'anthropic.claude-code-*win32*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'resources\native-binary\claude.exe' } | Where-Object { Test-Path $_ } | Select-Object -Last 1 }
}
if ($claude) { Write-Host ('Claude Code 확인: ' + $claude) -ForegroundColor Green }
else { Write-Host 'Claude Code 를 찾지 못했어요. 설치하고 로그인한 뒤, app\tools\scoresnap-worker\config.json 의 claudePath 에 경로를 적어 주세요.' -ForegroundColor Yellow }

# 바탕화면 바로가기 + 로그온 시 자동 실행
$runBat = Join-Path $InstallDir 'run.bat'
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'ScoreSnap PC 채점 프로그램.lnk'))
  $lnk.TargetPath = $runBat; $lnk.WorkingDirectory = $InstallDir; $lnk.WindowStyle = 7; $lnk.Save()
  Write-Host '바탕화면에 바로가기를 만들었어요.'
} catch { Write-Host ('바로가기 생성 실패: ' + $_.Exception.Message) -ForegroundColor Yellow }
if (-not $NoTask) {
  try {
    $act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c start "ScoreSnap" /min "' + $runBat + '"')
    $trg = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName 'ScoreSnapWorker' -Action $act -Trigger $trg -Settings $set -Force | Out-Null
    Write-Host '로그온할 때 자동으로 시작되도록 등록했어요.' -ForegroundColor Green
  } catch { Write-Host ('자동 실행 등록 실패(바로가기로 직접 실행하세요): ' + $_.Exception.Message) -ForegroundColor Yellow }
}

if (-not $NoStart) { Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c start "ScoreSnap" /min "' + $runBat + '"'); Write-Host '채점 프로그램을 시작했어요. (작업표시줄에 최소화된 창이 보여요)' -ForegroundColor Green }
Write-Host ''
Write-Host '설치 완료! 앱 상단에 "PC 켜짐"이 보이면 정상이에요.' -ForegroundColor Cyan
`;
fs.writeFileSync(path.join(OUT, 'install.ps1'), '﻿' + ps1.replace(/\r?\n/g, '\r\n'), 'utf8');   // PowerShell 5.1 은 BOM 필요

fs.writeFileSync(path.join(OUT, '읽어보세요.txt'), [
  'ScoreSnap PC 채점 프로그램 설치 방법',
  '',
  '1. 이 폴더를 학원 PC 에 복사합니다 (zip 이면 압축 풀기).',
  '2. [설치.bat] 을 더블클릭합니다.',
  '3. 학원장 로그인 아이디/비밀번호를 입력합니다 (처음 한 번만).',
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
