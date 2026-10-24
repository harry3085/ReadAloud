# ScoreSnap PC 채점 프로그램 설치 (안내형)
# 1) 시계  2) 파일 복사  3) 로그인 정보  4) Claude Code 찾기  5) Claude Code 로그인  6) 서버·학원장 계정 점검  7) 등록·시작
# 막히는 곳에서는 무엇을 해야 하는지 쉬운 말로 안내한다. (Claude 데스크탑은 사용자가 먼저 설치·로그인해 두어야 한다)
param([string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'ScoreSnapWorker'), [string]$User = '', [string]$Pass = '', [string]$WorkerName = '', [switch]$NoTask, [switch]$NoStart, [switch]$NoInteractive)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'files'
$summary = New-Object System.Collections.ArrayList
function Ok($m)   { Write-Host ('  [완료] ' + $m) -ForegroundColor Green;  [void]$summary.Add(@('OK', $m)) }
function Warn($m) { Write-Host ('  [주의] ' + $m) -ForegroundColor Yellow; [void]$summary.Add(@('WARN', $m)) }
function Bad($m)  { Write-Host ('  [실패] ' + $m) -ForegroundColor Red;    [void]$summary.Add(@('BAD', $m)) }
function Step($n, $t) { Write-Host ''; Write-Host ("[$n/7] $t") -ForegroundColor Cyan }
function Say($m) { Write-Host ('  ' + $m) }
function Ask($q) { if ($NoInteractive) { return '' } else { return (Read-Host ('  ' + $q)) } }

Write-Host ''
Write-Host '=== ScoreSnap PC 채점 프로그램 설치 ===' -ForegroundColor Cyan
Write-Host ('설치 위치: ' + $InstallDir)

# ─── 1. 시계 ───
Step 1 '이 PC의 시계 확인'
try {
  $r = Invoke-WebRequest 'https://raloud.vercel.app/' -Method Head -UseBasicParsing -TimeoutSec 20
  $srv = [DateTimeOffset]::Parse([string]($r.Headers['Date'] | Select-Object -First 1)).UtcDateTime
  $diff = [Math]::Abs(($srv - [DateTime]::UtcNow).TotalMinutes)
  if ($diff -gt 2) {
    Warn ('이 PC의 시계가 실제 시각과 약 ' + [Math]::Round($diff) + '분 차이가 나요.')
    Say '윈도우 설정 > 시간 및 언어 > 날짜 및 시간 에서 "시간 자동 설정"을 켜고 "지금 동기화"를 눌러 주세요. (설치는 계속 진행해요)'
  } else { Ok '시계가 정확해요.' }
} catch { Say '시계 확인은 건너뛰었어요. (인터넷 연결 상태에 따라 그럴 수 있어요)' }

# ─── 2. 파일 복사 ───
Step 2 '프로그램 파일 설치'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 500
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $src 'app') $InstallDir
Copy-Item -Recurse -Force (Join-Path $src 'node') $InstallDir
$wdir = Join-Path $InstallDir 'app\tools\scoresnap-worker'
$cfgPath = Join-Path $wdir 'config.json'
$nodeExe = Join-Path $InstallDir 'node\node.exe'
Ok '프로그램 파일을 설치했어요.'

# ─── 3. 로그인 정보 ───
Step 3 '학원장 로그인 정보'
if (-not (Test-Path $cfgPath)) {
  if (-not $User) { $User = Ask '학원장 로그인 아이디 (학생 아이디 X)' }
  if (-not $Pass) { if ($NoInteractive) { $Pass = '' } else { $sec = Read-Host '  학원장 로그인 비밀번호' -AsSecureString; $Pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)) } }
  if (-not $WorkerName) { $WorkerName = $env:COMPUTERNAME }
  $cfg = [ordered]@{ username = $User; password = $Pass; claudePath = ''; model = ''; workerName = $WorkerName }
  [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Ok '로그인 정보를 저장했어요.'
} else { Ok '이미 저장된 학원장 로그인 정보를 그대로 사용해요.' }

# ─── 4. Claude Code 찾기 ───
function Find-Claude {
  $c = @()
  $ext = Join-Path $env:USERPROFILE '.vscode\extensions'
  if (Test-Path $ext) { $c += Get-ChildItem $ext -Directory -Filter 'anthropic.claude-code-*win32*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'resources\native-binary\claude.exe' } | Where-Object { Test-Path $_ } }
  $bases = @((Join-Path $env:APPDATA 'Claude\claude-code'))
  $pk = Join-Path $env:LOCALAPPDATA 'Packages'
  if (Test-Path $pk) { Get-ChildItem $pk -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'claude|anthropic' } | ForEach-Object { $bases += (Join-Path $_.FullName 'LocalCache\Roaming\Claude\claude-code') } }
  foreach ($b in $bases) { if (Test-Path $b) { $c += Get-ChildItem $b -Recurse -Filter claude.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName } } }
  $loc = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
  if (Test-Path $loc) { $c += $loc }
  $npm = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
  if (Test-Path $npm) { $c += $npm }
  if ($c.Count) { return $c[0] }
  return $null
}
Step 4 'Claude Code 찾기'
$claude = Find-Claude
$tries = 0
while (-not $claude -and -not $NoInteractive -and $tries -lt 6) {
  $tries++
  Say 'Claude Code 를 찾지 못했어요. 아래 순서로 진행해 주세요.'
  Say '  1) Claude 데스크탑이 없다면 https://claude.ai/download 에서 설치하고 로그인해 주세요.'
  Say '  2) Claude 데스크탑을 열고 "Code" 기능을 한 번 열어 주세요. (이때 필요한 파일이 내려받아져요)'
  Say '  3) 끝나면 이 창으로 돌아와 아래에서 1 을 입력해 주세요.'
  $a = Ask '1 = 다시 찾기 / 2 = Claude 다운로드 페이지 열기 / 3 = 나중에 하고 계속'
  if ($a -eq '2') { Start-Process 'https://claude.ai/download' }
  elseif ($a -eq '3') { break }
  else { $claude = Find-Claude }
}
if ($claude) { Ok ('Claude Code 를 찾았어요: ' + $claude) } else { Bad 'Claude Code 를 찾지 못했어요. 설치한 뒤 이 설치 파일을 다시 실행해 주세요. (채점은 Claude Code 가 있어야 동작해요)' }

# ─── 5. Claude Code 로그인 ───
# 로그인 안내 파일: 더블클릭하면 이 PC의 Claude Code 를 찾아 열어 준다 (설치 폴더에 두고, 필요할 때 다시 쓸 수 있다)
$loginBat = Join-Path $InstallDir 'Claude Code 로그인.bat'
$loginLines = @(
  '@echo off',
  'chcp 65001 >nul',
  'title Claude Code Login',
  'echo.',
  'echo  [Claude Code 로그인]',
  'echo   1) 잠시 뒤 Claude Code 화면이 열립니다.',
  'echo   2) "Do you trust this folder" 같은 질문이 나오면 Yes 를 고르고 Enter 를 누르세요.',
  'echo   3) 이어서 /login 을 입력하고 Enter. 구독 계정을 고르고, 열리는 브라우저에서 허용하세요.',
  'echo   4) 로그인되었다는 메시지가 나오면 /exit 를 입력해 나오세요.',
  'echo.',
  'pause',
  'cd /d "%TEMP%"',
  'powershell -NoProfile -Command "$p = (Get-ChildItem ''$env:APPDATA\Claude\claude-code'',''$env:LOCALAPPDATA\Packages\*\LocalCache\Roaming\Claude\claude-code'',''$env:USERPROFILE\.vscode\extensions'' -Recurse -Filter claude.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName; if (-not $p) { $p = (Get-Command claude -ErrorAction SilentlyContinue).Source }; if ($p) { & $p } else { Write-Host ''Claude Code 를 찾지 못했어요. Claude 데스크탑을 설치하고 Code 기능을 한 번 열어 주세요.'' }"',
  'pause'
)
[IO.File]::WriteAllText($loginBat, ($loginLines -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding($false)))

function Test-ClaudeLogin($exe) {
  $tmp = Join-Path $env:TEMP 'ss-claude-check'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = '-p "Reply with OK only" --output-format json'; $psi.WorkingDirectory = $tmp
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  try { $p = [System.Diagnostics.Process]::Start($psi) } catch { return 'error:' + $_.Exception.Message }
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch {}; return 'timeout' }
  $out = $o.Result; $err = $e.Result
  if (($out + $err) -match 'Not logged in|/login|authenticat') { return 'login' }
  try { $j = $out | ConvertFrom-Json; if ($j.is_error) { return 'error:' + $j.result } else { return 'ok' } } catch { return 'error:' + (($err + $out).Trim()) }
}
Step 5 'Claude Code 로그인 확인'
if ($claude) {
  Say '확인 중이에요... (최대 1~2분)'
  $res = Test-ClaudeLogin $claude
  $try = 0
  while ($res -eq 'login' -and -not $NoInteractive -and $try -lt 3) {
    $try++
    Warn 'Claude Code 에 로그인이 필요해요. (Claude 데스크탑 로그인과는 따로 한 번 필요해요)'
    Say '곧 새 창이 열려요. 창 안의 안내대로 /login 으로 로그인해 주세요.'
    Start-Process -FilePath $loginBat
    [void](Ask '로그인을 마치고 창을 닫았으면 여기서 Enter 를 눌러 주세요')
    Say '다시 확인 중이에요...'
    $res = Test-ClaudeLogin $claude
  }
  if ($res -eq 'ok') { Ok 'Claude Code 로그인이 되어 있어요.' }
  elseif ($res -eq 'login') { Bad ('Claude Code 로그인이 아직 안 됐어요. 설치 폴더의 "Claude Code 로그인.bat" 을 더블클릭해서 로그인한 뒤 이 설치 파일을 다시 실행해 주세요.') }
  elseif ($res -eq 'timeout') { Warn 'Claude Code 응답이 너무 느려요. 인터넷 상태를 확인하고 나중에 다시 확인해 주세요.' }
  else { Warn ('Claude Code 확인 중 문제가 있었어요: ' + $res) }
} else { Bad 'Claude Code 를 찾지 못해 로그인 확인을 건너뛰었어요.' }

# ─── 6. 서버·학원장 계정 점검 ───
Step 6 '학원 서버 연결과 학원장 계정 확인'
$chk = ''
try { $chk = (& $nodeExe (Join-Path $wdir 'worker.js') --check 2>&1 | Out-String) } catch { $chk = 'CHECK_FAIL ' + $_.Exception.Message }
$okLine = ($chk -split "`r?`n" | Where-Object { $_ -match '^CHECK_OK' } | Select-Object -First 1)
$failLine = ($chk -split "`r?`n" | Where-Object { $_ -match '^CHECK_FAIL' } | Select-Object -First 1)
if ($okLine) { Ok ('학원 서버에 연결됐어요. ' + ($okLine -replace '^CHECK_OK\s*', '')) }
elseif ($failLine) {
  Bad (($failLine -replace '^CHECK_FAIL\s*', ''))
  Say '로그인 정보를 바꾸려면 아래 파일을 삭제하고 이 설치 파일을 다시 실행해 주세요.'
  Say ('  ' + $cfgPath)
} else { Bad '학원 서버 확인 결과를 읽지 못했어요.' }

# ─── 7. 바로가기·자동 실행·시작 ───
Step 7 '바로가기와 자동 실행'
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
$runBat = Join-Path $InstallDir 'run.bat'
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'ScoreSnap PC 채점 프로그램.lnk'))
  $lnk.TargetPath = $runBat; $lnk.WorkingDirectory = $InstallDir; $lnk.WindowStyle = 7; $lnk.Save()
  $lnk2 = $ws.CreateShortcut((Join-Path $desktop 'Claude Code 로그인.lnk'))
  $lnk2.TargetPath = $loginBat; $lnk2.WorkingDirectory = $InstallDir; $lnk2.Save()
  Ok '바탕화면에 바로가기를 만들었어요. (채점 프로그램 / Claude Code 로그인)'
} catch { Warn ('바로가기를 만들지 못했어요: ' + $_.Exception.Message) }
if (-not $NoTask) {
  try {
    $act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c start "ScoreSnap" /min "' + $runBat + '"')
    $trg = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName 'ScoreSnapWorker' -Action $act -Trigger $trg -Settings $set -Force | Out-Null
    Ok 'PC를 켜고 로그인하면 자동으로 시작되도록 등록했어요.'
  } catch { Warn ('자동 실행 등록에 실패했어요. 바탕화면 바로가기로 직접 실행해 주세요: ' + $_.Exception.Message) }
}
if (-not $NoStart) { Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c start "ScoreSnap" /min "' + $runBat + '"'); Ok '채점 프로그램을 시작했어요. (작업표시줄에 최소화된 "ScoreSnap" 창이 보여요. 닫지 마세요)' }

# ─── 결과 요약 ───
Write-Host ''
Write-Host '================ 설치 결과 ================' -ForegroundColor Cyan
foreach ($s in $summary) {
  $col = 'Green'; $tag = '완료'
  if ($s[0] -eq 'WARN') { $col = 'Yellow'; $tag = '주의' } elseif ($s[0] -eq 'BAD') { $col = 'Red'; $tag = '실패' }
  Write-Host ('  [' + $tag + '] ' + $s[1]) -ForegroundColor $col
}
$bad = @($summary | Where-Object { $_[0] -eq 'BAD' }).Count
Write-Host ''
if ($bad -eq 0) { Write-Host '설치가 끝났어요! 앱(raloud.vercel.app/ss) 상단에 "PC 켜짐"이 보이는지 확인해 주세요. (안 보이면 새로고침)' -ForegroundColor Green }
else { Write-Host ('위 [실패] 항목을 해결한 뒤 이 설치 파일을 다시 실행해 주세요. (' + $bad + '건)') -ForegroundColor Red }
