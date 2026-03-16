#!/bin/bash
# Linux 端口转发脚本
# 支持多种方式：socat, iptables, rinetd

PORT_FROM=9222
PORT_TO=9223

echo "=========================================="
echo "Chrome CDP 端口转发服务 (Linux)"
echo "=========================================="
echo ""
echo "将 127.0.0.1:$PORT_FROM 转发到 0.0.0.0:$PORT_TO"
echo ""

# 检测 Linux 发行版
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
else
    DISTRO="unknown"
fi

echo "检测到系统: $DISTRO"
echo ""

# 方法选择
echo "请选择端口转发方式:"
echo "1. socat (推荐，简单易用)"
echo "2. iptables (系统级，需要 root)"
echo "3. rinetd (守护进程)"
echo ""
read -p "请输入选项 (1-3): " METHOD

case $METHOD in
    1)
        echo ""
        echo "=========================================="
        echo "方法 1: 使用 socat"
        echo "=========================================="
        echo ""
        
        # 检查 socat 是否安装
        if ! command -v socat &> /dev/null; then
            echo "socat 未安装，正在安装..."
            echo ""
            
            case $DISTRO in
                ubuntu|debian)
                    sudo apt-get update
                    sudo apt-get install -y socat
                    ;;
                centos|rhel|fedora)
                    sudo yum install -y socat
                    ;;
                arch)
                    sudo pacman -S socat
                    ;;
                *)
                    echo "无法自动安装 socat，请手动安装:"
                    echo "  Ubuntu/Debian: sudo apt-get install socat"
                    echo "  CentOS/RHEL:   sudo yum install socat"
                    echo "  Arch:          sudo pacman -S socat"
                    exit 1
                    ;;
            esac
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
        
        # 检查源端口
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
        ;;
        
    2)
        echo ""
        echo "=========================================="
        echo "方法 2: 使用 iptables"
        echo "=========================================="
        echo ""
        
        # 检查 root 权限
        if [ "$EUID" -ne 0 ]; then
            echo "此方法需要 root 权限"
            echo "请使用 sudo 运行此脚本"
            exit 1
        fi
        
        echo "配置 iptables 规则..."
        echo ""
        
        # 启用 IP 转发
        echo 1 > /proc/sys/net/ipv4/ip_forward
        
        # 添加 iptables 规则
        iptables -t nat -A PREROUTING -p tcp --dport $PORT_TO -j REDIRECT --to-port $PORT_FROM
        iptables -t nat -A OUTPUT -p tcp --dport $PORT_TO -j REDIRECT --to-port $PORT_FROM
        
        echo "✅ iptables 规则已添加"
        echo ""
        echo "当前规则:"
        iptables -t nat -L -n -v | grep $PORT_TO
        echo ""
        echo "停止转发:"
        echo "  sudo ./stop_port_forward_linux.sh"
        echo ""
        echo "按任意键退出..."
        read -n 1
        ;;
        
    3)
        echo ""
        echo "=========================================="
        echo "方法 3: 使用 rinetd"
        echo "=========================================="
        echo ""
        
        # 检查 rinetd 是否安装
        if ! command -v rinetd &> /dev/null; then
            echo "rinetd 未安装，正在安装..."
            echo ""
            
            case $DISTRO in
                ubuntu|debian)
                    sudo apt-get update
                    sudo apt-get install -y rinetd
                    ;;
                centos|rhel|fedora)
                    sudo yum install -y rinetd
                    ;;
                *)
                    echo "无法自动安装 rinetd，请手动安装"
                    exit 1
                    ;;
            esac
        fi
        
        echo "✅ rinetd 已安装"
        echo ""
        
        # 创建配置文件
        CONFIG_FILE="/tmp/rinetd_cdp.conf"
        echo "0.0.0.0 $PORT_TO 127.0.0.1 $PORT_FROM" > $CONFIG_FILE
        
        echo "配置文件: $CONFIG_FILE"
        cat $CONFIG_FILE
        echo ""
        
        echo "启动 rinetd..."
        sudo rinetd -c $CONFIG_FILE -f
        ;;
        
    *)
        echo "无效选项"
        exit 1
        ;;
esac





