import json
import logging
import os
import platform
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from typing import Optional

LOGGER = logging.getLogger(__name__)


class ChromeLaunchError(RuntimeError):
    """Raised when Chrome fails to start."""


class ChromeManager:
    """
    Launches and supervises a headless Chrome instance that exposes a DevTools (CDP) endpoint.
    """

    def __init__(
        self,
        executable_path: Optional[str] = None,
        remote_debugging_port: int = 9222,
        remote_debugging_address: str = "0.0.0.0",
        user_data_dir: Optional[str] = None,
        headless: bool = True,
        extra_args: Optional[list[str]] = None,
    ) -> None:
        self.remote_debugging_port = remote_debugging_port
        self.remote_debugging_address = remote_debugging_address
        self.executable_path = executable_path or self._guess_executable()
        self.user_data_dir = user_data_dir or os.path.join(
            tempfile.gettempdir(), "webrtc-headless-profile"
        )
        self.headless = headless
        self.extra_args = extra_args or []
        self._process: Optional[subprocess.Popen] = None

    def _guess_executable(self) -> str:
        system = platform.system().lower()
        candidates = []

        if system == "darwin":
            candidates.extend(
                [
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    "/Applications/Chromium.app/Contents/MacOS/Chromium",
                ]
            )
        elif system == "windows":
            candidates.extend(
                [
                    os.path.join(
                        os.environ.get("PROGRAMFILES", r"C:\Program Files"),
                        "Google",
                        "Chrome",
                        "Application",
                        "chrome.exe",
                    ),
                    os.path.join(
                        os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
                        "Google",
                        "Chrome",
                        "Application",
                        "chrome.exe",
                    ),
                ]
            )
        else:  # Linux and others
            candidates.extend(
                [
                    "/usr/bin/google-chrome",
                    "/usr/bin/chromium-browser",
                    "/snap/bin/chromium",
                ]
            )

        for candidate in candidates:
            if os.path.exists(candidate):
                return candidate

        raise FileNotFoundError(
            "无法找到 Chrome/Chromium 可执行文件，请在配置中显式提供 executable_path。"
        )

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self) -> None:
        if self.is_running:
            return

        os.makedirs(self.user_data_dir, exist_ok=True)

        # 🎬 获取录制插件路径
        extension_path = os.path.abspath(os.path.join(
            os.path.dirname(os.path.dirname(__file__)), 
            'chrome_extension'
        ))
        
        LOGGER.info(f"🎬 加载Chrome录制插件: {extension_path}")
        
        args = [
            self.executable_path,
            f"--remote-debugging-port={self.remote_debugging_port}",
            f"--remote-debugging-address={self.remote_debugging_address}",
            "--remote-allow-origins=*",  # 允许所有来源的远程连接
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-breakpad",
            "--disable-client-side-phishing-detection",
            "--disable-default-apps",
            "--disable-dev-shm-usage",
            # 🎬 加载录制插件
            f"--load-extension={extension_path}",
            "--disable-extensions-except={0}".format(extension_path),  # 只加载录制插件
            "--disable-features=TranslateUI",
            "--disable-hang-monitor",
            "--disable-ipc-flooding-protection",
            "--disable-popup-blocking",
            "--disable-prompt-on-repost",
            "--disable-renderer-backgrounding",
            "--disable-sync",
            "--force-color-profile=srgb",
            "--metrics-recording-only",
            "--no-first-run",
            "--no-sandbox",
            "--autoplay-policy=no-user-gesture-required",
            "--window-size=1920,1080",
            # GPU硬件加速优化（增强版）
            "--enable-gpu",  # 明确启用GPU
            "--enable-gpu-rasterization",  # GPU栅格化
            "--enable-zero-copy",  # 零拷贝，减少内存复制
            "--enable-hardware-overlays",  # 硬件覆盖层
            "--enable-oop-rasterization",  # 进程外栅格化（GPU进程外）
            "--disable-gpu-vsync",  # 禁用垂直同步，提高帧率
            "--disable-smooth-scrolling",  # 禁用平滑滚动
            "--ignore-gpu-blocklist",  # 忽略GPU黑名单
            "--use-gl=angle",  # 使用ANGLE (macOS上更好)
            "--disable-software-rasterizer",  # 强制使用硬件渲染
            "--enable-accelerated-2d-canvas",  # 2D Canvas硬件加速
            "--enable-native-gpu-memory-buffers",  # 原生GPU内存缓冲
            "--enable-gpu-memory-buffer-video-frames",  # GPU内存缓冲视频帧
            "--enable-features=VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization",  # 硬件视频编解码 + Canvas OOP
            "--disable-features=UseChromeOSDirectVideoDecoder",  # 禁用ChromeOS特定的解码器
            f"--user-data-dir={self.user_data_dir}",
        ]

        if self.headless:
            args.append("--headless=new")

        args.extend(self.extra_args)

        # 打印启动命令用于调试
        import logging
        logger = logging.getLogger(__name__)
        logger.info("Starting Chrome with command:")
        logger.info(" ".join(args))
        logger.info(f"Remote debugging: {self.remote_debugging_address}:{self.remote_debugging_port}")
        
        self._process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            close_fds=True,
        )

        if not self._wait_for_devtools():
            self.stop()
            raise ChromeLaunchError("无法在超时时间内连接到 Chrome DevTools 端口")

    def stop(self) -> None:
        # 🔥 关键修复：不管is_running状态如何，都尝试清理
        # 因为可能存在孤儿进程或状态不一致的情况
        
        pid = None
        if self._process and self.is_running:
            # 主进程还在运行，正常清理
            pid = self._process.pid
            LOGGER.info(f"🛑 停止Chrome进程 (PID: {pid})")
        
            # 尝试优雅终止主进程
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
                LOGGER.info("✅ Chrome主进程已优雅终止")
            except subprocess.TimeoutExpired:
                LOGGER.warning("⚠️ Chrome主进程未响应，强制终止")
                self._process.kill()
                self._process.wait()
        elif self._process:
            # 进程对象存在但is_running返回False，仍然尝试清理
            LOGGER.warning("⚠️  Chrome进程状态异常，尝试清理")
            pid = self._process.pid
            try:
                self._process.kill()
            except:
                pass
        else:
            # 没有进程对象，但仍然尝试清理可能的孤儿进程
            LOGGER.warning("⚠️  没有Chrome进程对象，尝试清理所有无头Chrome进程")
        
        # 🔥 关键修复：无论如何都清理所有残留的Chrome子进程
        # Chrome是多进程架构，需要确保所有子进程都被清理
        try:
            import psutil
            # 尝试使用psutil清理（如果可用）
            try:
                parent = psutil.Process(pid)
                children = parent.children(recursive=True)
                for child in children:
                    try:
                        child.terminate()
                    except psutil.NoSuchProcess:
                        pass
                # 等待子进程终止
                gone, alive = psutil.wait_procs(children, timeout=3)
                # 强制kill仍存活的进程
                for p in alive:
                    try:
                        p.kill()
                    except psutil.NoSuchProcess:
                        pass
                LOGGER.info(f"✅ 清理了 {len(children)} 个Chrome子进程")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        except ImportError:
            # psutil不可用，使用系统命令清理
            import signal
            try:
                # 尝试终止进程组
                os.killpg(os.getpgid(pid), signal.SIGTERM)
                time.sleep(1)
                # 强制kill
                try:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                LOGGER.info("✅ 使用进程组清理了Chrome进程")
            except (ProcessLookupError, PermissionError, OSError) as e:
                LOGGER.warning(f"⚠️ 进程组清理失败: {e}")
        
        # 🔥 新增：暴力清理所有Chrome进程（通过进程名）
        self._kill_all_chrome_processes()
        
        self._process = None
        LOGGER.info("🛑 Chrome已完全停止")
    
    def _kill_all_chrome_processes(self) -> None:
        """
        🔥 新增：暴力清理所有无头Chrome进程
        通过--headless标志和remote-debugging-port识别
        """
        try:
            import psutil
            killed_count = 0
            
            # 遍历所有进程，查找无头Chrome进程
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    proc_name = proc.info['name']
                    cmdline = proc.info['cmdline']
                    
                    if not cmdline:
                        continue
                    
                    # 判断是否是Chrome/Chromium进程
                    is_chrome = any(x in proc_name.lower() for x in ['chrome', 'chromium'])
                    if not is_chrome:
                        continue
                    
                    # 🔥 关键修复：通过remote-debugging-port识别我们的Chrome实例
                    cmdline_str = ' '.join(cmdline)
                    has_headless = '--headless' in cmdline_str
                    has_our_port = f'--remote-debugging-port={self.remote_debugging_port}' in cmdline_str
                    
                    # 如果是无头模式 + 使用我们的调试端口，则kill
                    if has_headless and has_our_port:
                        LOGGER.info(f"  🔫 杀死无头Chrome进程: PID={proc.info['pid']}")
                        try:
                            proc.kill()
                            proc.wait(timeout=3)  # 等待进程退出
                            killed_count += 1
                        except psutil.TimeoutExpired:
                            LOGGER.warning(f"  ⚠️  进程{proc.info['pid']}未能在3秒内退出")
                        except psutil.NoSuchProcess:
                            pass  # 已经退出
                
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
            
            if killed_count > 0:
                LOGGER.info(f"🧹 额外清理了 {killed_count} 个无头Chrome进程")
                time.sleep(0.5)  # 等待进程完全退出
        
        except ImportError:
            # psutil不可用，使用系统命令
            system = platform.system().lower()
            try:
                if system == "darwin" or system == "linux":
                    # 在macOS和Linux上使用pkill，通过remote-debugging-port识别
                    subprocess.run(
                        ["pkill", "-f", f"remote-debugging-port={self.remote_debugging_port}"],
                        capture_output=True,
                        timeout=3
                    )
                    LOGGER.info("🧹 使用pkill清理了Chrome进程")
                    time.sleep(1)
                elif system == "windows":
                    # Windows上使用taskkill
                    subprocess.run(
                        ["taskkill", "/F", "/IM", "chrome.exe"],
                        capture_output=True,
                        timeout=3
                    )
                    LOGGER.info("🧹 使用taskkill清理了Chrome进程")
            except Exception as e:
                LOGGER.warning(f"⚠️  系统命令清理失败: {e}")

    def _wait_for_devtools(self, timeout: float = 15.0) -> bool:
        start = time.time()
        url = f"http://127.0.0.1:{self.remote_debugging_port}/json/version"

        while time.time() - start < timeout:
            try:
                with urllib.request.urlopen(url, timeout=1) as resp:
                    if resp.status == 200:
                        return True
            except urllib.error.URLError:
                time.sleep(0.3)
        return False

    def fetch_version_info(self) -> dict:
        url = f"http://127.0.0.1:{self.remote_debugging_port}/json/version"
        with urllib.request.urlopen(url, timeout=2) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def create_target(self, url: str = "about:blank") -> dict:
        endpoint = f"http://127.0.0.1:{self.remote_debugging_port}/json/new?{url}"
        req = urllib.request.Request(endpoint, method="PUT")
        try:
            with urllib.request.urlopen(req, timeout=2) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError:
            with urllib.request.urlopen(endpoint, timeout=2) as resp:
                return json.loads(resp.read().decode("utf-8"))

    def list_targets(self) -> list[dict]:
        endpoint = f"http://127.0.0.1:{self.remote_debugging_port}/json/list"
        with urllib.request.urlopen(endpoint, timeout=2) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get_websocket_debugger_url(self) -> str:
        """
        Returns the websocket endpoint for the first page target. If no page target exists,
        a new target pointing to about:blank will be created.
        """
        targets = self.list_targets()
        for target in targets:
            if target.get("type") == "page":
                return target["webSocketDebuggerUrl"]

        target = self.create_target()
        return target["webSocketDebuggerUrl"]


__all__ = ["ChromeManager", "ChromeLaunchError"]

