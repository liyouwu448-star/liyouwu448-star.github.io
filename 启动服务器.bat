@echo off
echo ========================================
echo   漫剧智能体 - 启动服务器（Windows）
echo ========================================
echo.

if not exist node_modules (
  echo [1/2] 首次运行，正在安装依赖...
  npm install
  echo.
)

echo [2/2] 正在启动服务器...
echo.
node server.js

pause
