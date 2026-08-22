@echo off
setlocal
chcp 65001 >nul

rem ============================================================
rem  Qranty Landing - Backup nhanh
rem  Bam dup file nay de tao 1 ban sao co dau thoi gian.
rem  Ket qua: _backups\backup-YYYYMMDD-HHMMSS\
rem ============================================================

rem File nay nam trong admin\ nen phai lui ra thu muc cha de sao luu ca du an
cd /d "%~dp0.."

rem --- Lay ngay gio khong phu thuoc dinh dang vung (dung WMIC) ---
for /f "skip=1 tokens=1" %%A in ('wmic os get localdatetime 2^>nul') do (
    if not defined LDT set "LDT=%%A"
)
if not defined LDT (
    rem Du phong neu may khong co wmic
    set "LDT=%date:~-4%%date:~3,2%%date:~0,2%%time:~0,2%%time:~3,2%%time:~6,2%"
    set "LDT=%LDT: =0%"
)

set "STAMP=%LDT:~0,8%-%LDT:~8,6%"
set "DEST=_backups\backup-%STAMP%"

echo.
echo   Dang sao luu vao: %DEST%
echo.

if not exist "_backups" mkdir "_backups"
mkdir "%DEST%" 2>nul

rem /E   : chep ca thu muc con (ke ca rong)
rem /XD  : bo qua thu muc
rem /XF  : bo qua file
rem /NFL /NDL /NJH /NJS /NP : bot log cho gon
robocopy "." "%DEST%" /E ^
  /XD "_backups" "node_modules" ".vercel" ".git" "$RECYCLE.BIN" ^
  /XF "desktop.ini" ".fuse_hidden*" "*.log" ^
  /NFL /NDL /NJH /NJS /NP

set RC=%ERRORLEVEL%

echo.
if %RC% GEQ 8 (
    echo   [LOI] Sao luu that bai. Ma loi robocopy: %RC%
) else (
    echo   [OK] Da sao luu xong.
    echo   Thu muc: %CD%\%DEST%
)
echo.

rem --- Canh bao neu editor / blog-server dang chay ---
tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
if not errorlevel 1 (
    echo   ------------------------------------------------------------
    echo   CANH BAO: dang co tien trinh node.exe chay.
    echo   Co the la editor.html ^(admin\start.bat^) hoac blog-admin
    echo   ^(admin\start-blog-admin.bat^). Hai cong cu nay CO THE GHI DE
    echo   file HTML va lam mat thay doi cua ban.
    echo   Hay dong chung truoc khi sua file bang cach khac.
    echo   Xem muc 1 trong README.md.
    echo   ------------------------------------------------------------
    echo.
)

pause
endlocal
