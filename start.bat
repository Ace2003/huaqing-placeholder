@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ================================
echo     像素猫·读心陪伴 启动中...
echo   ================================
echo.
echo   浏览器访问: http://localhost:8000
echo.
python server.py
pause
