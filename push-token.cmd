@echo off
chcp 65001 >nul
title Push BlockMark with token
cd /d "%~dp0"
echo.
echo  Open: https://github.com/settings/tokens/new?scopes=repo^&description=blockmark
echo  Create a classic token with "repo" scope, copy it, then come back here.
echo.
echo  Username: Cji2005526
echo  Password: paste the token (nothing will show while pasting)
echo.
git -c credential.helper= push -u origin main
echo.
echo  Done. Watch the build at https://github.com/Cji2005526/blockmark/actions
pause
