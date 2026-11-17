@echo off
chcp 65001 >nul
title Push BlockMark to GitHub
cd /d "%~dp0"
echo.
echo Pushing to GitHub ... a browser window may open for sign-in.
echo.
git push -u origin main
echo.
echo Done. Open https://github.com/Cji2005526/blockmark/actions to watch the build.
pause
