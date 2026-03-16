"""
配置文件
可以根据需要修改这些配置
"""

# HTTP服务器
SERVER_HOST = "0.0.0.0"
SERVER_PORT = 5566
DEBUG = True
SECRET_KEY = "webrtc-cdp-bridge"
CORS_ALLOWED_ORIGINS = "*"

# Headless Chrome
CHROME_EXECUTABLE = None  # 可自定义Chrome路径，None表示自动探测
REMOTE_DEBUGGING_PORT = 9222  # Playwright/CDP连接端口
REMOTE_DEBUGGING_ADDRESS = "0.0.0.0"  # 监听地址，0.0.0.0允许局域网访问，127.0.0.1仅本地
DEFAULT_TARGET_URL = "https://www.testerhome.com"

# 🎬 流媒体编码模式（新增）
DEFAULT_ENCODING_MODE = "mjpeg"  # "mjpeg" (兼容) or "h264" (高性能)

# 日志
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
