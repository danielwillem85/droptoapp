@echo off
rem Start DropToApp locally (double-click this file, or run it in a terminal).
rem   Editor:         http://localhost:5173  (opens in your browser)
rem   Account server: http://localhost:3000
rem Stop with Ctrl+C in this window.
rem
rem Brevo is pointed at an unreachable address, so local sign-ups send no
rem emails and add no contacts. Delete the BREVO_API_URL line to test Brevo for real.
cd /d "%~dp0"
set BREVO_API_URL=http://127.0.0.1:9/v3
start "" /b powershell -NoProfile -Command "Start-Sleep 6; Start-Process http://localhost:5173"
call npm run dev
echo.
echo DropToApp has stopped.
pause
