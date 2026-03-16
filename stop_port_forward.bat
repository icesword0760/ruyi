@echo off
REM Windows 停止端口转发脚本

setlocal

set PORT_TO=9223
set LISTEN_ADDRESS=0.0.0.0

echo ==========================================
echo 停止 Chrome CDP 端口转发服务
echo ==========================================
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

echo [删除] 端口转发规则...
netsh interface portproxy delete v4tov4 listenport=%PORT_TO% listenaddress=%LISTEN_ADDRESS%

if %errorLevel% equ 0 (
    echo [OK] 端口转发规则已删除
) else (
    echo [警告] 未找到端口转发规则或删除失败
)

echo.
echo [删除] 防火墙规则...
netsh advfirewall firewall delete rule name="Chrome CDP Forward"

if %errorLevel% equ 0 (
    echo [OK] 防火墙规则已删除
) else (
    echo [警告] 未找到防火墙规则或删除失败
)

echo.
echo ==========================================
echo [完成] 端口转发服务已停止
echo ==========================================
echo.
pause

endlocal





