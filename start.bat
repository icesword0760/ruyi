@echo off
chcp 65001 >nul
title WebRTC远程控制系统

echo ==================================
echo WebRTC远程控制系统
echo ==================================
echo.

REM 检查Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未找到Python，请先安装Python 3.8或更高版本
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo ✓ Python版本: %PYTHON_VERSION%

REM 检查虚拟环境
if not exist "venv" (
    echo.
    echo 📦 未找到虚拟环境，正在创建...
    python -m venv venv
    echo ✓ 虚拟环境创建完成
)

REM 激活虚拟环境
echo.
echo 🔄 激活虚拟环境...
call venv\Scripts\activate.bat

REM 安装依赖
echo.
echo 📥 检查并安装依赖...
pip install -q -r requirements.txt
echo ✓ 依赖安装完成

REM 创建必要的目录
if not exist "static" mkdir static
if not exist "templates" mkdir templates

REM 启动服务器
echo.
echo ==================================
echo 🚀 启动服务器...
echo ==================================
echo.
echo 访问地址：
echo   - 首页:    http://localhost:5000
echo   - 被控端:  http://localhost:5000/controlled
echo   - 控制端:  http://localhost:5000/controller
echo.
echo 按 Ctrl+C 停止服务器
echo.

python server.py





