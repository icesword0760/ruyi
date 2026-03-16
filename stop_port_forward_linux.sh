#!/bin/bash
# Linux 停止端口转发脚本

PORT_TO=9223

echo "=========================================="
echo "停止 Chrome CDP 端口转发服务"
echo "=========================================="
echo ""

# 检查是否有 socat 进程
SOCAT_PID=$(pgrep -f "socat.*$PORT_TO")
if [ ! -z "$SOCAT_PID" ]; then
    echo "发现 socat 进程 (PID: $SOCAT_PID)"
    kill $SOCAT_PID
    echo "✅ socat 进程已停止"
    echo ""
fi

# 检查是否有 iptables 规则
if [ "$EUID" -eq 0 ]; then
    echo "检查 iptables 规则..."
    if iptables -t nat -L -n | grep -q $PORT_TO; then
        iptables -t nat -D PREROUTING -p tcp --dport $PORT_TO -j REDIRECT --to-port 9222 2>/dev/null
        iptables -t nat -D OUTPUT -p tcp --dport $PORT_TO -j REDIRECT --to-port 9222 2>/dev/null
        echo "✅ iptables 规则已删除"
    else
        echo "未找到 iptables 规则"
    fi
    echo ""
else
    echo "⚠️  需要 root 权限才能删除 iptables 规则"
    echo "   请使用: sudo ./stop_port_forward_linux.sh"
    echo ""
fi

# 检查是否有 rinetd 进程
RINETD_PID=$(pgrep rinetd)
if [ ! -z "$RINETD_PID" ]; then
    echo "发现 rinetd 进程 (PID: $RINETD_PID)"
    if [ "$EUID" -eq 0 ]; then
        kill $RINETD_PID
        echo "✅ rinetd 进程已停止"
    else
        echo "⚠️  需要 root 权限才能停止 rinetd"
        echo "   请使用: sudo ./stop_port_forward_linux.sh"
    fi
    echo ""
fi

echo "=========================================="
echo "完成"
echo "=========================================="





