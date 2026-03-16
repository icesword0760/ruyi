#!/bin/bash

echo "========================================="
echo "Coturn TURN服务器一键部署脚本"
echo "适用于中国网络环境"
echo "========================================="
echo ""

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then 
    echo "❌ 请使用root权限运行此脚本"
    echo "运行: sudo $0"
    exit 1
fi

# 检查操作系统
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ 无法检测操作系统"
    exit 1
fi

echo "✓ 检测到操作系统: $OS"
echo ""

# 安装Coturn
echo "📦 安装Coturn..."
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    apt-get update
    apt-get install -y coturn curl
elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ]; then
    yum install -y coturn curl
else
    echo "❌ 不支持的操作系统: $OS"
    exit 1
fi

echo "✓ Coturn安装完成"
echo ""

# 获取公网IP
echo "🌐 获取公网IP..."
PUBLIC_IP=$(curl -s ifconfig.me)
if [ -z "$PUBLIC_IP" ]; then
    PUBLIC_IP=$(curl -s ip.sb)
fi

if [ -z "$PUBLIC_IP" ]; then
    echo "⚠️  无法自动获取公网IP，请手动输入："
    read -p "公网IP: " PUBLIC_IP
fi

echo "✓ 公网IP: $PUBLIC_IP"
echo ""

# 生成随机凭证
echo "🔐 生成认证凭证..."
SECRET_KEY=$(openssl rand -hex 32)
USERNAME="webrtc_$(date +%s)"
PASSWORD=$(openssl rand -base64 12)

echo "✓ 凭证生成完成"
echo ""

# 创建配置文件
echo "⚙️  创建配置文件..."
cat > /etc/turnserver.conf << EOF
# Coturn配置文件 - 中国网络环境优化

# 监听端口
listening-port=3478
tls-listening-port=5349

# 外部IP
external-ip=$PUBLIC_IP

# 认证方式
lt-cred-mech
use-auth-secret
static-auth-secret=$SECRET_KEY

# 用户认证
user=$USERNAME:$PASSWORD

# 域名
realm=turn.local

# 日志
verbose
log-file=/var/log/turnserver.log

# 性能优化
no-multicast-peers
no-loopback-peers
no-cli

# 端口范围
min-port=49152
max-port=65535

# 限制
max-bps=1000000
bps-capacity=0

# 安全设置
no-tlsv1
no-tlsv1_1
fingerprint
EOF

echo "✓ 配置文件创建完成"
echo ""

# 启用并启动服务
echo "🚀 启动TURN服务..."
systemctl enable coturn
systemctl restart coturn

# 检查服务状态
sleep 2
if systemctl is-active --quiet coturn; then
    echo "✓ TURN服务启动成功"
else
    echo "❌ TURN服务启动失败"
    echo "查看日志: sudo journalctl -u coturn -n 50"
    exit 1
fi

echo ""
echo "========================================="
echo "🎉 TURN服务器部署完成！"
echo "========================================="
echo ""
echo "📋 服务器信息："
echo "----------------------------------------"
echo "公网IP:    $PUBLIC_IP"
echo "UDP端口:   3478"
echo "TCP端口:   3478"
echo "TLS端口:   5349"
echo ""
echo "🔐 认证信息："
echo "----------------------------------------"
echo "用户名:    $USERNAME"
echo "密码:      $PASSWORD"
echo "密钥:      $SECRET_KEY"
echo ""
echo "📝 WebRTC配置代码："
echo "----------------------------------------"
cat << 'JSEOF'
const config = {
    iceServers: [
        { urls: 'stun:JSEOF
echo -n "$PUBLIC_IP:3478' },"
cat << 'JSEOF'
        {
            urls: 'turn:JSEOF
echo -n "$PUBLIC_IP:3478',"
cat << 'JSEOF'
            username: 'JSEOF
echo -n "$USERNAME',"
cat << 'JSEOF'
            credential: 'JSEOF
echo -n "$PASSWORD'"
cat << 'JSEOF'
        },
        {
            urls: 'turn:JSEOF
echo -n "$PUBLIC_IP:3478?transport=tcp',"
cat << 'JSEOF'
            username: 'JSEOF
echo -n "$USERNAME',"
cat << 'JSEOF'
            credential: 'JSEOF
echo -n "$PASSWORD'"
cat << 'JSEOF'
        }
    ]
};
JSEOF
echo ""
echo "========================================="
echo ""
echo "💡 提示："
echo "1. 确保防火墙开放端口 3478 和 5349"
echo "2. 将上述配置代码复制到你的HTML文件中"
echo "3. 测试连接: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
echo ""
echo "🔧 常用命令："
echo "查看状态: sudo systemctl status coturn"
echo "查看日志: sudo tail -f /var/log/turnserver.log"
echo "重启服务: sudo systemctl restart coturn"
echo ""
echo "========================================="

# 保存配置到文件
CONFIG_FILE="turn_server_config.txt"
cat > $CONFIG_FILE << EOF
TURN服务器配置信息
生成时间: $(date)

服务器IP: $PUBLIC_IP
端口: 3478 (UDP/TCP), 5349 (TLS)
用户名: $USERNAME
密码: $PASSWORD
密钥: $SECRET_KEY

WebRTC配置:
const config = {
    iceServers: [
        { urls: 'stun:$PUBLIC_IP:3478' },
        {
            urls: 'turn:$PUBLIC_IP:3478',
            username: '$USERNAME',
            credential: '$PASSWORD'
        }
    ]
};
EOF

echo "✓ 配置已保存到: $CONFIG_FILE"
echo ""





