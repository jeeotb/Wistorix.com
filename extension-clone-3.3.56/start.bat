@echo off
chcp 65001 >nul
title Wistorix clone - dashboard offline
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
    node serve.js
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo Khong tim thay Node.js, dung Python de chay may chu tinh.
    start "" http://localhost:5173/dashboard.html
    python -m http.server 5173 --directory app
    goto :eof
)

echo.
echo   Khong tim thay Node.js hoac Python tren may nay.
echo   Cai Node.js tai https://nodejs.org roi chay lai file nay,
echo   hoac mo thu muc app/ bang Live Server cua VS Code.
echo.
pause
