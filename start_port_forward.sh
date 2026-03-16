#!/bin/bash
# 启动端口转发服务
# 将 Chrome 的本地端口 (127.0.0.1:9222) 转发到所有网卡 (0.0.0.0:9223)

PORT_FROM=9222
PORT_TO=9223

echo "=========================================="
echo "Chrome CDP 端口转发服务"
echo "=========================================="
echo ""
echo "将 127.0.0.1:$PORT_FROM 转发到 0.0.0.0:$PORT_TO"
echo ""

# 检查 socat 是否安装
if ! command -v socat &> /dev/null; then
    echo "❌ socat 未安装"
    echo ""
    echo "请安装 socat:"
    echo "  macOS:   brew install socat"
    echo "  Ubuntu:  sudo apt-get install socat"
    echo "  CentOS:  sudo yum install socat"
    exit 1
fi

echo "✅ socat 已安装"
echo ""

# 检查端口是否已被占用
if lsof -i :$PORT_TO > /dev/null 2>&1; then
    echo "⚠️  端口 $PORT_TO 已被占用"
    echo ""
    echo "当前占用进程:"
    lsof -i :$PORT_TO
    echo ""
    read -p "是否终止现有进程并继续? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        PID=$(lsof -t -i :$PORT_TO)
        kill $PID
        sleep 1
    else
        exit 1
    fi
fi

# 检查源端口是否可用
if ! lsof -i :$PORT_FROM > /dev/null 2>&1; then
    echo "⚠️  源端口 $PORT_FROM 未监听"
    echo "   请确保 server.py 正在运行"
    echo ""
    read -p "是否继续? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "🚀 启动端口转发..."
echo ""
echo "命令: socat TCP-LISTEN:$PORT_TO,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:$PORT_FROM"
echo ""
echo "按 Ctrl+C 停止"
echo ""
echo "=========================================="
echo ""

# 启动 socat
socat TCP-LISTEN:$PORT_TO,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:$PORT_FROM





