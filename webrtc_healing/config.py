"""
webrtc_healing — 配置
通过环境变量覆盖默认值。
"""
import os
import sys
import logging

# ─── 服务地址 ─────────────────────────────────────────────
CHROME_CDP_URL = os.environ.get("CHROME_CDP_URL", "http://127.0.0.1:9222")
PLATFORM_URL = os.environ.get("WEBRTC_PLATFORM_URL", "http://127.0.0.1:5566")
AI_SERVICE_URL = os.environ.get("WEBRTC_AI_SERVICE_URL", "http://127.0.0.1:3100")
OCR_SERVICE_URL = os.environ.get("WEBRTC_OCR_SERVICE_URL", "http://127.0.0.1:9788")

# ─── 独立模式：禁用所有外部服务调用 ─────────────────────────
STANDALONE = os.environ.get("WEBRTC_STANDALONE", "").strip() in ("1", "true", "yes")

# ─── 超时 & 等待 ─────────────────────────────────────────
HEAL_TIMEOUT = int(os.environ.get("WEBRTC_HEAL_TIMEOUT", "10000"))
STEP_WAIT = float(os.environ.get("WEBRTC_STEP_WAIT", "0.8"))
NAVIGATE_TIMEOUT = int(os.environ.get("WEBRTC_NAVIGATE_TIMEOUT", "30000"))
CLICK_TIMEOUT = int(os.environ.get("WEBRTC_CLICK_TIMEOUT", "10000"))

# ─── 日志 ─────────────────────────────────────────────────
LOG_LEVEL = os.environ.get("WEBRTC_LOG_LEVEL", "INFO").upper()

logger = logging.getLogger("webrtc_healing")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("[%(levelname)s] %(name)s: %(message)s"))
    logger.addHandler(_h)
logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

IS_MAC = sys.platform == "darwin"
SELECT_ALL_KEY = "Meta+a" if IS_MAC else "Control+a"
