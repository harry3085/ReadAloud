@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo [setup] npm install ...
  call npm install
)
if not exist config.json (
  echo config.json is missing. Copy config.example.json to config.json and enter your login.
  pause
  exit /b 1
)
node worker.js
pause
