@echo off
REM Windows 端口转发脚本
REM 使用 netsh 将 Chrome 的本地端口转发到所有网卡

setlocal

set PORT_FROM=9222
set PORT_TO=9223
set LISTEN_ADDRESS=0.0.0.0

echo ==========================================
echo Chrome CDP 端口转发服务 (Windows)
echo ==========================================
echo.
echo 将 127.0.0.1:%PORT_FROM% 转发到 %LISTEN_ADDRESS%:%PORT_TO%
echo.

REM 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 此脚本需要管理员权限
    echo.
    echo 请右键点击此脚本，选择"以管理员身份运行"
    echo.
    pause
    exit /b 1
)

echo [OK] 已获得管理员权限
echo.

REM 检查端口是否已被占用
netstat -ano | findstr ":%PORT_TO% " | findstr "LISTENING" >nul
if %errorLevel% equ 0 (
    echo [警告] 端口 %PORT_TO% 已被占用
    echo.
    echo 当前占用进程:
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT_TO% " ^| findstr "LISTENING"') do (
        echo PID: %%a
        tasklist /FI "PID eq %%a"
    )
    echo.
    set /p "REPLY=是否终止现有进程并继续? (Y/N): "
    if /i not "%REPLY%"=="Y" exit /b 1
    
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT_TO% " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%a
    )
    timeout /t 2 >nul
)

REM 检查源端口是否可用
netstat -ano | findstr ":%PORT_FROM% " | findstr "LISTENING" >nul
if %errorLevel% neq 0 (
    echo [警告] 源端口 %PORT_FROM% 未监听
    echo         请确保 server.py 正在运行
    echo.
    set /p "REPLY=是否继续? (Y/N): "
    if /i not "%REPLY%"=="Y" exit /b 1
)

echo [启动] 配置端口转发...
echo.

REM 删除可能存在的旧规则
netsh interface portproxy delete v4tov4 listenport=%PORT_TO% listenaddress=%LISTEN_ADDRESS% >nul 2>&1

REM 添加端口转发规则
netsh interface portproxy add v4tov4 listenport=%PORT_TO% listenaddress=%LISTEN_ADDRESS% connectport=%PORT_FROM% connectaddress=127.0.0.1

if %errorLevel% equ 0 (
    echo [OK] 端口转发已配置
    echo.
    echo 转发规则:
    netsh interface portproxy show v4tov4
    echo.
    
    REM 配置防火墙规则
    echo [配置] 添加防火墙规则...
    netsh advfirewall firewall delete rule name="Chrome CDP Forward" >nul 2>&1
    netsh advfirewall firewall add rule name="Chrome CDP Forward" dir=in action=allow protocol=TCP localport=%PORT_TO%
    
    if %errorLevel% equ 0 (
        echo [OK] 防火墙规则已添加
    ) else (
        echo [警告] 防火墙规则添加失败，可能需要手动配置
    )
    
    echo.
    echo ==========================================
    echo [成功] 端口转发服务已启动
    echo ==========================================
    echo.
    echo 监听地址: %LISTEN_ADDRESS%:%PORT_TO%
    echo 转发目标: 127.0.0.1:%PORT_FROM%
    echo.
    echo 验证命令:
    echo   netstat -ano ^| findstr ":%PORT_TO%"
    echo   curl http://localhost:%PORT_TO%/json/version
    echo.
    echo 停止服务:
    echo   运行 stop_port_forward.bat
    echo.
    echo 按任意键退出...
    pause >nul
) else (
    echo [错误] 端口转发配置失败
    echo.
    pause
    exit /b 1
)

endlocal





