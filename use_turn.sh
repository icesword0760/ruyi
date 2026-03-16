#!/bin/bash

echo "========================================="
echo "启用TURN服务器配置"
echo "========================================="
echo ""
echo "这会将WebRTC配置改为使用TURN中继服务器"
echo "适用于网络环境受限的情况"
echo ""

# 备份原文件
cp static/controlled.html static/controlled.html.bak
cp static/controller.html static/controller.html.bak

echo "✓ 已备份原文件"

# 使用sed替换配置（macOS版本）
sed -i '' 's/iceServers: \[\]/iceServers: [\
        { urls: "stun:stun.l.google.com:19302" },\
        {\
            urls: "turn:openrelay.metered.ca:80",\
            username: "openrelayproject",\
            credential: "openrelayproject"\
        },\
        {\
            urls: "turn:openrelay.metered.ca:443",\
            username: "openrelayproject",\
            credential: "openrelayproject"\
        },\
        {\
            urls: "turn:openrelay.metered.ca:443?transport=tcp",\
            username: "openrelayproject",\
            credential: "openrelayproject"\
        }\
    ]/g' static/controlled.html static/controller.html 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✓ 已更新配置为使用TURN服务器"
    echo ""
    echo "现在请："
    echo "  1. 刷新浏览器（Cmd+Shift+R）"
    echo "  2. 重新测试连接"
    echo ""
    echo "如果要恢复原配置："
    echo "  mv static/controlled.html.bak static/controlled.html"
    echo "  mv static/controller.html.bak static/controller.html"
else
    echo "❌ 更新失败，请手动编辑配置文件"
    echo ""
    echo "在 static/controlled.html 和 static/controller.html 中"
    echo "将 'iceServers: []' 替换为："
    echo ""
    cat << 'EOF'
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
EOF
fi

echo ""
echo "========================================="





