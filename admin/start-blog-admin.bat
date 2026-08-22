@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Chua cai Node.js. Hay cai tai https://nodejs.org  roi chay lai file nay.
  echo.
  pause
  exit /b
)
echo Dang mo Qranty Blog Admin trong trinh duyet...
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8899/blog-admin.html"
node blog-server.js
pause
