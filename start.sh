#!/bin/bash
echo "========================================"
echo "  漫剧智能体 - 启动服务器 (Mac/Linux)"
echo "========================================"
echo ""

if [ ! -d "node_modules" ]; then
  echo "[1/2] 首次运行，正在安装依赖..."
  npm install
  echo ""
fi

echo "[2/2] 正在启动服务器..."
echo ""
node server.js
