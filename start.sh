#!/bin/bash
#
# 一键启动所有服务
# 用法: ./start.sh [--no-ocr]
#   --no-ocr  跳过 OCR 服务（可选服务）
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
AI_DIR="$ROOT_DIR/ai_service"
UI_DIR="$ROOT_DIR/controller_ui"
UI_DIST_DIR="$ROOT_DIR/static/controller-app"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SKIP_OCR=false
for arg in "$@"; do
    [[ "$arg" == "--no-ocr" ]] && SKIP_OCR=true
done

cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 正在停止所有服务...${NC}"
    [[ -n "$FLASK_PID" ]]  && kill "$FLASK_PID"  2>/dev/null && echo "   Flask 已停止"
    [[ -n "$AI_PID" ]]     && kill "$AI_PID"     2>/dev/null && echo "   AI 服务已停止"
    [[ -n "$OCR_PID" ]]    && kill "$OCR_PID"    2>/dev/null && echo "   OCR 服务已停止"
    wait 2>/dev/null
    echo -e "${GREEN}✅ 所有服务已停止${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${CYAN}══════════════════════════════════════${NC}"
echo -e "${CYAN}   WebRTC 远程控制系统 — 一键启动${NC}"
echo -e "${CYAN}══════════════════════════════════════${NC}"
echo ""

# ── 1. 环境检查 ──────────────────────────────────

echo -e "${YELLOW}[1/5] 检查环境...${NC}"

# Prefer `python` (conda envs), fallback to `python3`.
PYTHON=""
if command -v python &>/dev/null; then
    if python -c "import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)" >/dev/null 2>&1; then
        PYTHON="python"
    fi
fi
if [ -z "$PYTHON" ] && command -v python3 &>/dev/null; then
    PYTHON="python3"
fi
if [ -z "$PYTHON" ]; then
    echo -e "${RED}❌ 未找到 Python（python 或 python3）${NC}"; exit 1
fi
echo -e "  ${GREEN}✓${NC} Python $($PYTHON --version 2>&1 | awk '{print $2}') ($PYTHON)"

if ! command -v node &>/dev/null; then
    echo -e "${RED}❌ 未找到 node，AI 服务需要 Node.js${NC}"; exit 1
fi
echo -e "  ${GREEN}✓${NC} Node $(node --version)"

# ── 2. Python 依赖 ──────────────────────────────

echo -e "${YELLOW}[2/5] 检查 Python 依赖...${NC}"
if [ -f "$ROOT_DIR/requirements.txt" ]; then
    $PYTHON -m pip install -q -r "$ROOT_DIR/requirements.txt" 2>/dev/null && \
        echo -e "  ${GREEN}✓${NC} Python 依赖已就绪" || \
        echo -e "  ${YELLOW}⚠${NC} 部分依赖安装失败，继续启动"
fi

# 安装 webrtc_healing 自愈引擎包（开发模式）
if [ -f "$ROOT_DIR/setup.py" ]; then
    $PYTHON -m pip install -q -e "$ROOT_DIR" 2>/dev/null && \
        echo -e "  ${GREEN}✓${NC} webrtc_healing 包已就绪" || \
        echo -e "  ${YELLOW}⚠${NC} webrtc_healing 安装失败，继续启动"
fi

# ── 3. Node 依赖 ─────────────────────────────────

echo -e "${YELLOW}[3/5] 检查 AI 服务依赖...${NC}"
if [ -d "$AI_DIR" ] && [ -f "$AI_DIR/package.json" ]; then
    if [ ! -d "$AI_DIR/node_modules" ]; then
        echo "  📦 安装 node_modules..."
        (cd "$AI_DIR" && npm install --silent)
    fi
    echo -e "  ${GREEN}✓${NC} Node 依赖已就绪"
fi

# 控制台前端（React + Vite）
if [ -d "$UI_DIR" ] && [ -f "$UI_DIR/package.json" ]; then
    echo -e "${YELLOW}  [UI] 检查控制台前端...${NC}"
    if [ ! -d "$UI_DIR/node_modules" ]; then
        echo "  📦 安装 控制台前端 node_modules..."
        (cd "$UI_DIR" && npm install --silent)
    fi
    NEED_BUILD=false
    if [ ! -f "$UI_DIST_DIR/index.html" ]; then
        NEED_BUILD=true
    else
        # Rebuild when sources are newer than the last build output.
        if find "$UI_DIR/src" -type f -newer "$UI_DIST_DIR/index.html" -print -quit 2>/dev/null | grep -q .; then
            NEED_BUILD=true
        elif [ -f "$UI_DIR/index.html" ] && [ "$UI_DIR/index.html" -nt "$UI_DIST_DIR/index.html" ]; then
            NEED_BUILD=true
        elif [ -f "$UI_DIR/vite.config.ts" ] && [ "$UI_DIR/vite.config.ts" -nt "$UI_DIST_DIR/index.html" ]; then
            NEED_BUILD=true
        fi
    fi
    if [ "$NEED_BUILD" = true ]; then
        echo "  🧱 构建 控制台前端..."
        (cd "$UI_DIR" && npm run build --silent)
    fi
    echo -e "  ${GREEN}✓${NC} 控制台前端已就绪"
fi

# ── 4. 启动服务 ──────────────────────────────────

echo -e "${YELLOW}[4/5] 启动服务...${NC}"
echo ""

# 检查端口是否被占用
check_port() {
    local port=$1 name=$2
    if lsof -i :"$port" -sTCP:LISTEN &>/dev/null; then
        echo -e "  ${YELLOW}⚠ 端口 $port ($name) 已被占用，跳过启动${NC}"
        return 1
    fi
    return 0
}

# 4a. OCR 服务（可选，先启动因为无依赖）
OCR_PID=""
if [ "$SKIP_OCR" = false ] && [ -f "$AI_DIR/ocr_service.py" ]; then
    if check_port 9788 "OCR"; then
        echo -e "  🔤 启动 OCR 服务 (端口 9788)..."
        (cd "$AI_DIR" && exec $PYTHON ocr_service.py) > "$LOG_DIR/ocr.log" 2>&1 &
        OCR_PID=$!
        sleep 1
        if kill -0 "$OCR_PID" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} OCR 服务已启动 (PID: $OCR_PID)"
        else
            echo -e "  ${YELLOW}⚠${NC} OCR 服务启动失败（可选服务，继续）"
            OCR_PID=""
        fi
    fi
else
    echo -e "  ${YELLOW}⏭${NC}  跳过 OCR 服务"
fi

# 4b. AI 服务
AI_PID=""
if [ -f "$AI_DIR/server.js" ]; then
    if check_port 3100 "AI"; then
        echo -e "  🤖 启动 AI 服务 (端口 3100)..."
        (cd "$AI_DIR" && exec node server.js) > "$LOG_DIR/ai_service.log" 2>&1 &
        AI_PID=$!
        # 等待就绪
        for i in $(seq 1 10); do
            sleep 1
            if curl -s http://127.0.0.1:3100/status >/dev/null 2>&1; then
                echo -e "  ${GREEN}✓${NC} AI 服务已就绪 (PID: $AI_PID)"
                break
            fi
            if [ "$i" -eq 10 ]; then
                echo -e "  ${YELLOW}⚠${NC} AI 服务启动超时，查看 logs/ai_service.log"
            fi
        done
    fi
fi

# 4c. Flask 主服务（前台运行，接管终端输出）
if check_port 5566 "Flask"; then
    echo -e "  🚀 启动 Flask 主服务 (端口 5566)..."
    echo ""
else
    echo -e "  ${RED}❌ 端口 5566 已被占用，无法启动 Flask${NC}"
    cleanup
fi

# ── 5. 信息总结 ──────────────────────────────────

echo -e "${YELLOW}[5/5] 启动完成${NC}"
echo ""
echo -e "${CYAN}══════════════════════════════════════${NC}"
echo -e "  📺 控制台:  ${GREEN}http://localhost:5566/controller${NC}"
echo -e "  🤖 AI服务:  http://localhost:3100/status"
[[ -n "$OCR_PID" ]] && echo -e "  🔤 OCR服务: http://localhost:9788/health"
echo -e "${CYAN}══════════════════════════════════════${NC}"
echo ""
echo -e "  日志目录: ${LOG_DIR}"
echo -e "  按 ${RED}Ctrl+C${NC} 停止所有服务"
echo ""

# Flask 前台运行（这样 Ctrl+C 能触发 cleanup）
cd "$ROOT_DIR"
$PYTHON server.py &
FLASK_PID=$!

# 等待 Flask 进程结束
wait "$FLASK_PID" 2>/dev/null
cleanup
