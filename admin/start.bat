@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Kiem tra Node.js (giong `command -v node` tren macOS)
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Hay cai tai https://nodejs.org roi chay lai.
  pause
  exit /b 1
)

rem Blog admin chay nen (cong 8899) de nut "Blog SEO" trong editor mo duoc ngay.
start "WistorixBlog" /min cmd /c "node blog-server.js"

rem Sau 2 giay mo editor.html trong trinh duyet (giong `open` tren macOS)
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8787/editor.html"

rem Chay server chinh o foreground (giong `node server.js` cuoi file .command)
node server.js

rem Khi server chinh dung, tat luon blog admin (giong `trap ... kill` tren macOS)
taskkill /FI "WINDOWTITLE eq WistorixBlog" /T /F >nul 2>nul
