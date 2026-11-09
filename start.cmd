@echo off
chcp 65001 >nul
title BlockMark
cd /d "%~dp0"
echo.
echo   BlockMark local server starting ...
echo   Close this window to stop the server.
echo.
node server.mjs . 4173
echo.
echo   Server stopped. If the port was busy, close the old window and retry.
pause
