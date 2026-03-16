import asyncio
import base64
import json
import logging
import time
import hashlib
import os
from typing import Any, Dict, Optional, Tuple
from io import BytesIO

import websockets
from PIL import Image

from .cdp_recorder import CDPRecorder

LOGGER = logging.getLogger(__name__)


def _get_image_dimensions(jpeg_bytes: bytes) -> tuple:
    """获取JPEG图片的实际分辨率"""
    try:
        img = Image.open(BytesIO(jpeg_bytes))
        return img.size  # (width, height)
    except Exception:
        return (0, 0)


class CDPClient:
    """
    Minimal DevTools Protocol client that streams frames via Page.startScreencast
    and forwards input events to the headless browser.
    """

    def __init__(self, websocket_url: str, stream_mode: str = "mjpeg") -> None:
        self.websocket_url = websocket_url
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self._send_lock = asyncio.Lock()
        self._receiver_task: Optional[asyncio.Task] = None
        self._msg_id = 0
        self._pending: Dict[int, asyncio.Future] = {}
        self._frame_queue: asyncio.Queue[Tuple[bytes, Dict[str, Any]]] = asyncio.Queue(
            maxsize=5
        )
        self.viewport_width = 1920
        self.viewport_height = 1080
        
        # 🎬 流媒体模式选择
        self.stream_mode = stream_mode  # "mjpeg" or "h264"
        self._screenshot_lock = asyncio.Lock()  # 用于模式切换时的同步
        
        # MJPEG server reference (for bypassing WebRTC encoding)
        self._mjpeg_server = None
        self._screencast_refresh_task: Optional[asyncio.Task] = None
        self._fps = 30  # Default 30fps for smoother experience
        self._quality = 98  # Near-lossless quality for MJPEG mode (was 85, increased for better dynamic quality)
        
        # 🎬 H.264模式专用
        if stream_mode == "h264":
            self._screenshot_format = "png"  # H.264模式使用PNG获取无损数据
            self._quality = 100  # PNG无损
        else:
            self._screenshot_format = "jpeg"  # MJPEG模式
        
        # H.264编码器（延迟初始化）
        self._h264_encoder = None
        
        # V4: CDP Recorder (核心改进)
        self.recorder = CDPRecorder(self)
        
        # Multi-tab support
        self._active_target_id: Optional[str] = None
        self._active_session_id: Optional[str] = None
        self._target_sessions: Dict[str, str] = {}  # targetId -> sessionId
        self._target_info: Dict[str, Dict[str, Any]] = {}  # targetId -> info
        # Best-effort URL fallback for cases where navigation history is temporarily unavailable.
        self._last_known_url: Optional[str] = None
        self._last_known_url_ts: float = 0.0
        
        # Event deduplication - prevent duplicate events in short time window
        self._last_event_time: Dict[str, float] = {}  # event_key -> timestamp
        self._event_dedupe_window = 0.3  # 300ms window for deduplication
        
        # Screencast mode control and monitoring
        self._frame_count = 0
        self._last_fps_log_time = time.time()
        self._last_frame_time = 0.0  # Track when we last received a frame
        self._screencast_session_id: Optional[int] = None  # Track screencast session for ACK
        self._capture_mode = "initializing"  # "initializing", "push" (startScreencast) or "poll" (captureScreenshot)
        self._mode_switch_reason = ""  # Reason for mode switch
        self._push_frame_received = False  # Track if we've received any PUSH frames
        self._latest_frame_jpeg: Optional[bytes] = None
        
        # Frame change detection for adaptive FPS (inspired by 货拉拉)
        self._last_frame_hash: Optional[str] = None
        self._no_change_count = 0
        self._adaptive_fps_enabled = True  # 启用自适应FPS
        self._static_fps = 5  # 静态画面FPS
        self._dynamic_fps = self._fps  # 动态画面FPS
        
        # 🎬 V4: 录制器（不再需要注入脚本）
        self._recorder_script: Optional[str] = None
        self._recorder_injected = False
        
        # V4: 最小化UI注入标志
        self._minimal_ui_script: Optional[str] = None

    def _load_recorder_script(self) -> str:
        """加载录制器注入脚本"""
        if self._recorder_script:
            return self._recorder_script
        
        script_path = os.path.join(
            os.path.dirname(__file__),
            'recorder_inject.js'
        )
        
        try:
            with open(script_path, 'r', encoding='utf-8') as f:
                self._recorder_script = f.read()
                LOGGER.info("🎬 录制器脚本已加载: %s", script_path)
                return self._recorder_script
        except Exception as e:
            LOGGER.error("❌ 无法加载录制器脚本: %s", e)
            return ""
    
    async def inject_recorder(self, session_id: Optional[str] = None) -> bool:
        """WebSocket版录制器注入 - 适用于Headless模式"""
        try:
            # 加载WebSocket版录制器脚本
            import os
            ws_script_path = os.path.join(
                os.path.dirname(__file__), 
                "recorder_websocket.js"
            )
            
            if not os.path.exists(ws_script_path):
                LOGGER.warning("⚠️ recorder_websocket.js不存在")
                return False
            
            with open(ws_script_path, 'r', encoding='utf-8') as f:
                ws_script = f.read()
            
            # 使用指定session或活动session
            target_session = session_id or self._active_session_id
            if not target_session:
                LOGGER.warning("⚠️ 无活动session，跳过录制器注入")
                return False
            
            LOGGER.info("🎬 WebSocket: 注入WebSocket版录制器（适用于Headless）")
            
            # 方法1: 使用 Page.addScriptToEvaluateOnNewDocument 持久化
            try:
                await self.send_message_to_target(
                    target_session,
                    "Page.addScriptToEvaluateOnNewDocument",
                    {
                        "source": ws_script,
                        "runImmediately": True
                    }
                )
                LOGGER.info("✅ WebSocket: 录制器已添加到新文档自动加载")
            except Exception as e:
                LOGGER.warning(f"⚠️ Page.addScriptToEvaluateOnNewDocument失败: {e}")
            
            # 方法2: 立即注入到当前页面
            await self.send_message_to_target(
                target_session,
                "Runtime.evaluate",
                {
                    "expression": ws_script,
                    "returnByValue": False,
                }
            )
            
            LOGGER.info("✅ WebSocket: 录制器已注入当前页面")
            return True
            
        except Exception as e:
            LOGGER.error(f"❌ 录制器注入失败: {e}", exc_info=True)
            return False
        
    async def inject_element_locator(self, session_id: Optional[str] = None) -> bool:
        """注入元素定位脚本（SmartXPathGenerator + ElementLocator）到 Chrome 页面"""
        try:
            import os
            ext_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chrome_extension")
            
            # 加载两个脚本
            scripts = []
            for fname in ("dom_exporter_all_in_one.js", "element_locator.js"):
                fpath = os.path.join(ext_dir, fname)
                if not os.path.exists(fpath):
                    LOGGER.warning(f"⚠️ {fname} 不存在: {fpath}")
                    continue
                with open(fpath, "r", encoding="utf-8") as f:
                    scripts.append(f.read())
            
            if not scripts:
                LOGGER.warning("⚠️ 元素定位脚本为空，跳过注入")
                return False
            
            combined_script = "\n".join(scripts)
            
            target_session = session_id or self._active_session_id
            if not target_session:
                LOGGER.warning("⚠️ 无活动session，跳过元素定位脚本注入")
                return False
            
            LOGGER.info("🔍 注入元素定位脚本（XPath生成器 + ElementLocator）")
            
            # 持久化：每次导航后自动注入
            try:
                await self.send_message_to_target(
                    target_session,
                    "Page.addScriptToEvaluateOnNewDocument",
                    {"source": combined_script, "runImmediately": True}
                )
                LOGGER.info("✅ 元素定位脚本已添加到新文档自动加载")
            except Exception as e:
                LOGGER.warning(f"⚠️ addScriptToEvaluateOnNewDocument 失败: {e}")
            
            # 立即注入到当前页面
            await self.send_message_to_target(
                target_session,
                "Runtime.evaluate",
                {"expression": combined_script, "returnByValue": False}
            )
            
            LOGGER.info("✅ 元素定位脚本已注入当前页面")
            return True
        except Exception as e:
            LOGGER.error(f"❌ 元素定位脚本注入失败: {e}", exc_info=True)
            return False
    
    async def take_screenshot_base64(self) -> str:
        """截取当前页面，返回 base64 编码的 JPEG 图片"""
        if not self._active_session_id:
            return ""
        try:
            result = await self.send_message_to_target(
                self._active_session_id,
                "Page.captureScreenshot",
                {"format": "jpeg", "quality": 80, "captureBeyondViewport": False},
                wait=True,
            )
            return result.get("data", "")
        except Exception as e:
            LOGGER.error(f"❌ 截图失败: {e}")
            return ""

    async def get_element_info_at_coordinates(self, x: int, y: int) -> dict:
        """通过 CDP 调用注入的 ElementLocator 获取指定坐标处的元素 XPath 等信息"""
        target_session = self._active_session_id
        if not target_session:
            return {"success": False, "message": "无活动session"}
        
        js_expr = f"""
        (function() {{
            if (window.__elementLocatorUtils) {{
                return window.__elementLocatorUtils.getElementInfoByCoordinates({x}, {y});
            }}
            return {{ success: false, message: 'ElementLocator未注入' }};
        }})()
        """
        
        try:
            result = await self.send_message_to_target(
                target_session,
                "Runtime.evaluate",
                {"expression": js_expr, "returnByValue": True}
            )
            value = result.get("result", {}).get("value")
            if value:
                return value
            return {"success": False, "message": "Runtime.evaluate 返回空"}
        except Exception as e:
            LOGGER.error(f"❌ 获取元素信息失败: {e}")
            return {"success": False, "message": str(e)}

    async def inject_old_recorder(self, session_id: Optional[str] = None) -> bool:
        """旧的注入方法（V1-V3，已废弃）"""
        try:
            script = self._load_recorder_script()
            if not script:
                LOGGER.error("❌ 录制器脚本为空")
                return False
            
            # 使用指定session或活动session
            target_session = session_id or self._active_session_id
            if not target_session:
                LOGGER.warning("⚠️ 无活动session，跳过录制器注入")
                return False
            
            LOGGER.info("🎬 开始注入旧录制器到session: %s (脚本大小: %d bytes)", 
                       target_session[:8], len(script))
            
            # 通过Runtime.evaluate注入脚本
            result = await self.send_message_to_target(
                target_session,
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": False,
                    "userGesture": False
                },
                wait=True
            )
            
            # 检查注入结果
            if result and 'result' in result:
                LOGGER.info("✅ 录制器已成功注入到session: %s", target_session[:8])
                self._recorder_injected = True
                return True
            elif result and 'exceptionDetails' in result:
                LOGGER.error("❌ 录制器注入出错: %s", result.get('exceptionDetails'))
                return False
            else:
                LOGGER.info("✅ 录制器已注入到session: %s", target_session[:8])
                self._recorder_injected = True
                return True
            
        except Exception as e:
            LOGGER.error("❌ 录制器注入失败: %s", e, exc_info=True)
            return False

    async def connect(self) -> None:
        if self.websocket:
            return

        self.websocket = await websockets.connect(self.websocket_url, max_size=None)
        self._receiver_task = asyncio.create_task(self._recv_loop())

        # Enable Target domain and auto-attach FIRST
        # This ensures we catch all target creation events
        await self.call("Target.setDiscoverTargets", {"discover": True})
        await self.call("Target.setAutoAttach", {
            "autoAttach": True,
            "waitForDebuggerOnStart": False,
            "flatten": True
        })
        
        # Enable domains on main target
        await self.call("Page.enable")
        await self.call("DOM.enable")
        await self.call("Runtime.enable")
        
        # Wait for Target.attachedToTarget event to set active session
        # The event handler will set _active_session_id
        # Try multiple times with increasing delays
        for attempt in range(10):
            await asyncio.sleep(0.3)
            if self._active_session_id:
                LOGGER.info("Active session established after %.1f seconds", (attempt + 1) * 0.3)
                break
        
        if not self._active_session_id:
            LOGGER.error("No active session after auto-attach (waited 3s)")
            LOGGER.error("Available targets: %s", list(self._target_info.keys()))
            LOGGER.error("Available sessions: %s", list(self._target_sessions.keys()))
            
            # Try to manually attach to existing targets
            if self._target_info:
                for target_id, target_info in self._target_info.items():
                    if target_info.get("type") == "page":
                        try:
                            LOGGER.info("Manually attaching to existing target: %s", target_id)
                            result = await self.call("Target.attachToTarget", {
                                "targetId": target_id,
                                "flatten": True
                            })
                            session_id = result.get("sessionId")
                            if session_id:
                                self._target_sessions[target_id] = session_id
                                self._active_target_id = target_id
                                self._active_session_id = session_id
                                LOGGER.info("Manually attached! Target: %s, Session: %s", target_id, session_id)
                                
                                # Enable domains for this session
                                asyncio.create_task(self._enable_session_domains(session_id))
                                asyncio.create_task(self._capture_initial_screenshot())
                                break
                        except Exception as e:
                            LOGGER.error("Failed to manually attach to target %s: %s", target_id, e)
            
            # If still no session, try to create a new target
            if not self._active_session_id:
                try:
                    LOGGER.info("Attempting to create new target manually...")
                    result = await self.call("Target.createTarget", {"url": "about:blank"})
                    new_target_id = result.get("targetId")
                    if new_target_id:
                        LOGGER.info("Created new target: %s", new_target_id)
                        # Wait for auto-attach event
                        for attempt in range(5):
                            await asyncio.sleep(0.5)
                            if self._active_session_id:
                                LOGGER.info("Active session established after manual target creation")
                                break
                        
                        # If still no auto-attach, manually attach
                        if not self._active_session_id:
                            LOGGER.info("Auto-attach failed, manually attaching to new target...")
                            try:
                                result = await self.call("Target.attachToTarget", {
                                    "targetId": new_target_id,
                                    "flatten": True
                                })
                                session_id = result.get("sessionId")
                                if session_id:
                                    self._target_sessions[new_target_id] = session_id
                                    self._active_target_id = new_target_id
                                    self._active_session_id = session_id
                                    LOGGER.info("Manually attached to new target! Session: %s", session_id)
                                    
                                    # Enable domains and capture screenshot
                                    asyncio.create_task(self._enable_session_domains(session_id))
                                    asyncio.create_task(self._capture_initial_screenshot())
                            except Exception as e:
                                LOGGER.error("Failed to manually attach to new target: %s", e)
                except Exception as e:
                    LOGGER.error("Failed to create manual target: %s", e)
        
        await self.call(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": self.viewport_width,
                "height": self.viewport_height,
                "deviceScaleFactor": 1,  # Standard 1080p
                "mobile": False,
                "screenWidth": self.viewport_width,
                "screenHeight": self.viewport_height,
            },
        )
        
        # Start periodic screenshot capture
        if not self._screencast_refresh_task:
            LOGGER.info("Starting screenshot refresh loop...")
            self._screencast_refresh_task = asyncio.create_task(self._screencast_refresh_loop())
            LOGGER.info("Screenshot refresh task created: %s", self._screencast_refresh_task)
        
        try:
            # Allow new windows/tabs to be created
            await self.call("Page.setWindowOpenBehavior", {"behavior": "allow"})
        except Exception:  # pragma: no cover - optional method
            pass

    async def close(self) -> None:
        if self._screencast_refresh_task:
            self._screencast_refresh_task.cancel()
            self._screencast_refresh_task = None
        if self._receiver_task:
            self._receiver_task.cancel()
            self._receiver_task = None
        if self.websocket:
            await self.websocket.close()
            self.websocket = None

    async def _ensure_connected(self) -> bool:
        """确保WebSocket连接正常，如果断开则尝试重连"""
        # 🔥 修复：正确检查WebSocket连接状态
        # websockets库的ClientConnection没有closed属性
        # 只需检查websocket对象是否存在
        if self.websocket is not None:
            try:
                # 尝试检查连接状态：如果能ping就说明连接正常
                # 但由于我们没法直接检查closed状态，就假设存在就是正常的
                return True
            except:
                pass
        
        LOGGER.warning("🔄 CDP WebSocket连接断开，尝试重连...")
        
        try:
            # Close old connection if exists
            if self.websocket:
                try:
                    await self.websocket.close()
                except:
                    pass
                self.websocket = None
            
            # Cancel old receiver task
            if self._receiver_task:
                self._receiver_task.cancel()
                try:
                    await self._receiver_task
                except:
                    pass
                self._receiver_task = None
            
            # Reconnect
            self.websocket = await websockets.connect(self.websocket_url, max_size=None)
            self._receiver_task = asyncio.create_task(self._recv_loop())
            LOGGER.info("✅ CDP WebSocket重连成功")
            
            # Re-enable domains (这会递归调用_ensure_connected，但此时websocket已存在，会直接返回True)
            try:
                # 直接调用，不再检查连接（避免无限递归）
                await self._call_without_check("Page.enable", {})
                await self._call_without_check("DOM.enable", {})
                await self._call_without_check("Runtime.enable", {})
            except Exception as e:
                LOGGER.warning("重连后启用domains失败: %s", e)
            
            return True
        except Exception as e:
            LOGGER.error("❌ CDP WebSocket重连失败: %s", e)
            self.websocket = None
            return False
    
    async def _call_without_check(self, method: str, params: Optional[dict] = None) -> dict:
        """不检查连接直接调用（用于重连后的初始化）"""
        if not self.websocket:
            raise RuntimeError("CDPClient not connected")

        self._msg_id += 1
        msg_id = self._msg_id
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})

        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = future

        async with self._send_lock:
            await self.websocket.send(payload)

        try:
            response = await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            if msg_id in self._pending:
                del self._pending[msg_id]
            raise RuntimeError(f"CDP Timeout: {method}")

        if "error" in response:
            error_msg = response["error"].get("message", "Unknown error")
            raise RuntimeError(f"CDP Error {method}: {error_msg}")

        return response.get("result", {})

    async def call(self, method: str, params: Optional[dict] = None) -> dict:
        # 🔥 关键修复：发送前确保连接正常
        if not await self._ensure_connected():
            raise RuntimeError("CDPClient not connected and reconnect failed")

        self._msg_id += 1
        msg_id = self._msg_id
        # Log the outgoing command
        LOGGER.debug("CDP SEND [%d]: %s params=%s", msg_id, method, str(params)[:200])
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})

        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = future

        try:
            async with self._send_lock:
                await self.websocket.send(payload)
        except websockets.exceptions.ConnectionClosedError as e:
            LOGGER.error("❌ 发送消息时连接关闭: %s", e)
            self.websocket = None
            del self._pending[msg_id]
            raise RuntimeError(f"CDP Connection closed while sending: {method}")

        try:
            # 增加超时时间以支持复杂页面（如腾讯视频）
            response = await asyncio.wait_for(future, timeout=60.0)
        except asyncio.TimeoutError:
            LOGGER.error("CDP TIMEOUT [%d]: %s", msg_id, method)
            if msg_id in self._pending:
                del self._pending[msg_id]
            raise RuntimeError(f"CDP Timeout: {method}")

        if "error" in response:
            error_msg = response["error"].get("message", "Unknown error")
            LOGGER.error("CDP ERROR [%d]: %s - %s", msg_id, method, error_msg)
            raise RuntimeError(f"CDP Error {method}: {error_msg}")

        LOGGER.debug("CDP RECV [%d]: %s success", msg_id, method)
        return response.get("result", {})

    async def send_no_wait(self, method: str, params: Optional[dict] = None) -> None:
        """Sends a command with an ID but does not wait for the response."""
        # 🔥 关键修复：发送前确保连接正常
        if not await self._ensure_connected():
            LOGGER.warning("send_no_wait called but connection failed: %s", method)
            return
        
        self._msg_id += 1
        msg_id = self._msg_id
        # Send with ID so Chrome treats it as a command, but we don't track the future
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        
        # Log input events at INFO level for debugging (except mouseMoved to reduce noise)
        if method.startswith("Input."):
            if method == "Input.dispatchMouseEvent" and params and params.get("type") == "mouseMoved":
                LOGGER.debug("CDP SEND_NO_WAIT [%d]: Input.dispatchMouseEvent (mouseMoved)", msg_id)
            else:
                LOGGER.info("CDP SEND_NO_WAIT [%d]: %s params=%s", msg_id, method, str(params)[:100])
        
        try:
            async with self._send_lock:
                await self.websocket.send(payload)
        except websockets.exceptions.ConnectionClosedError as e:
            LOGGER.error("❌ send_no_wait连接关闭: %s - %s", method, e)
            self.websocket = None
        except Exception as e:
            LOGGER.error("Failed to send_no_wait %s: %s", method, e)

    async def send_message_to_target_no_wait(self, session_id: str, method: str, params: Optional[dict] = None) -> None:
        """Send a command to a target session without waiting for response.
        
        With flatten=True, messages are sent directly with sessionId attribute.
        """
        # 🔥 关键修复：发送前确保连接正常
        if not await self._ensure_connected():
            LOGGER.warning("send_message_to_target_no_wait called but connection failed")
            return
        
        self._msg_id += 1
        msg_id = self._msg_id
        
        # With flatten=True, send message directly with sessionId attribute
        message = {
            "id": msg_id,
            "sessionId": session_id,
            "method": method,
            "params": params or {}
        }
        
        # Log input events and screencast ACK
        if method.startswith("Input."):
            if method == "Input.dispatchMouseEvent" and params and params.get("type") == "mouseMoved":
                LOGGER.debug("CDP SEND_TARGET_NO_WAIT [%d]: Input.dispatchMouseEvent (mouseMoved) to session %s", msg_id, session_id[:8])
            else:
                LOGGER.info("CDP SEND_TARGET_NO_WAIT [%d]: %s to session %s params=%s", msg_id, method, session_id[:8], str(params)[:100])
        elif method == "Page.screencastFrameAck":
            LOGGER.info("CDP SEND_TARGET_NO_WAIT [%d]: %s to session %s with params=%s", msg_id, method, session_id[:8], params)
        
        try:
            async with self._send_lock:
                await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosedError as e:
            LOGGER.error("❌ send_message_to_target_no_wait连接关闭: %s - %s", method, e)
            self.websocket = None
        except Exception as e:
            LOGGER.warning("send_message_to_target_no_wait failed for %s: %s", method, e)

    async def send_message_to_target(self, session_id: str, method: str, params: Optional[dict] = None, wait: bool = True) -> dict:
        """Send a command to a target session and optionally wait for response.
        
        With flatten=True, messages are sent directly with sessionId attribute,
        not wrapped in Target.sendMessageToTarget.
        """
        # 🔥 关键修复：发送前确保连接正常
        if not await self._ensure_connected():
            raise RuntimeError("CDPClient not connected and reconnect failed")
        
        self._msg_id += 1
        msg_id = self._msg_id
        
        # With flatten=True, send message directly with sessionId attribute
        message = {
            "id": msg_id,
            "sessionId": session_id,
            "method": method,
            "params": params or {}
        }
        
        LOGGER.debug("CDP SEND_TARGET [%d]: %s to session %s", msg_id, method, session_id[:8])
        
        if wait:
            future: asyncio.Future = asyncio.get_running_loop().create_future()
            self._pending[msg_id] = future
            
            try:
                async with self._send_lock:
                    await self.websocket.send(json.dumps(message))
            except websockets.exceptions.ConnectionClosedError as e:
                LOGGER.error("❌ send_message_to_target连接关闭: %s - %s", method, e)
                self.websocket = None
                if msg_id in self._pending:
                    del self._pending[msg_id]
                raise RuntimeError(f"CDP Connection closed while sending: {method}")
            
            try:
                # Wait for response with shorter timeout for DOM queries
                timeout = 3.0 if method.startswith("DOM.") else 10.0
                response = await asyncio.wait_for(future, timeout=timeout)
                
                # With flatten=True, response is direct (no nested JSON)
                if "result" in response:
                    result = response["result"]
                    # Only log screenshot size, not the full base64 data
                    if method == "Page.captureScreenshot":
                        data_len = len(result.get("data", "")) if isinstance(result, dict) else 0
                        LOGGER.debug("Screenshot captured: %d bytes (base64)", data_len)
                    return result
                
                # Check for error
                if "error" in response:
                    error_msg = response["error"].get("message", "Unknown error")
                    LOGGER.debug("CDP TARGET ERROR [%d]: %s - %s", msg_id, method, error_msg)
                    return {}
                
                # No valid result
                if method == "Page.captureScreenshot":
                    LOGGER.warning("No valid result in response for %s", method)
                return {}
            except asyncio.TimeoutError:
                LOGGER.debug("CDP TARGET TIMEOUT [%d]: %s to session %s", msg_id, method, session_id[:8])
                self._pending.pop(msg_id, None)
                return {}  # Return empty dict instead of raising
        else:
            async with self._send_lock:
                await self.websocket.send(json.dumps(message))
            return {}

    async def _recv_loop(self) -> None:
        assert self.websocket is not None
        try:
            async for message in self.websocket:
                data = json.loads(message)

                if "id" in data:
                    future = self._pending.pop(data["id"], None)
                    if future and not future.done():
                        future.set_result(data)
                elif "method" in data:
                    await self._handle_event(data["method"], data.get("params", {}))
        except asyncio.CancelledError:
            LOGGER.info("CDP receiver loop cancelled")
            pass
        except websockets.exceptions.ConnectionClosedError as e:
            LOGGER.error("CDP WebSocket connection closed: %s", e)
            # Mark connection as broken
            self.websocket = None
            # Cancel all pending requests
            for msg_id, future in list(self._pending.items()):
                if not future.done():
                    future.set_exception(RuntimeError(f"Connection closed: {e}"))
            self._pending.clear()
        except Exception as exc:  # pragma: no cover - best effort logging
            LOGGER.exception("CDP receiver loop failed: %s", exc)
            self.websocket = None

    async def _handle_event(self, method: str, params: dict) -> None:
        if method == "Target.targetCreated":
            target_info = params.get("targetInfo", {})
            if target_info.get("type") == "page":
                target_id = target_info.get("targetId")
                self._target_info[target_id] = target_info
                url = target_info.get("url", "")
                LOGGER.info("CDP EVENT: New tab created - %s", url)
                
                # If no active target, set this as active
                if not self._active_target_id:
                    self._active_target_id = target_id
                
                # 🔥 关键修复：即使URL为空也要通知前端
                # 因为window.open()创建的标签页可能不触发attachedToTarget
                # 前端在收到空URL时，会延迟处理并等待实际URL加载
                if self._mjpeg_server and url not in ["chrome://newtab/"]:
                    # 延迟通知，给URL一点时间加载
                    asyncio.create_task(self._delayed_notify_tab_created(target_id, url))
                
                # 不手动处理，依赖CDP的autoAttach机制
                # 新标签页会在Target.attachedToTarget事件中自动处理
        
        elif method == "Page.loadEventFired":
            # V4: 页面加载完成，启用CDP录制器
            LOGGER.info("CDP EVENT: Page loaded, enabling V4 recorder...")
            asyncio.create_task(self.recorder.enable())
            # 注入元素定位脚本（XPath）
            asyncio.create_task(self.inject_element_locator())
        
        elif method == "Page.frameNavigated":
            # V4: 页面导航，重新启用CDP录制器
            frame = params.get("frame", {})
            url = frame.get("url", "")
            if not frame.get("parentId"):  # 只处理主frame
                LOGGER.info("CDP EVENT: Page navigated to %s, re-enabling V4 recorder...", url[:100])
                await asyncio.sleep(0.3)
                asyncio.create_task(self.recorder.enable())
                # 注入元素定位脚本（XPath）
                asyncio.create_task(self.inject_element_locator())
        
        elif method == "Runtime.bindingCalled":
            binding_name = params.get("name", "?")
            LOGGER.info(f"📨 [CDP] Runtime.bindingCalled: name={binding_name}")
            asyncio.create_task(self.recorder.handle_binding_called(params))
                    
        elif method == "Target.attachedToTarget":
            session_id = params.get("sessionId")
            target_info = params.get("targetInfo", {})
            target_id = target_info.get("targetId")
            
            if target_info.get("type") == "page":
                self._target_sessions[target_id] = session_id
                self._target_info[target_id] = target_info
                url = target_info.get("url", "")
                LOGGER.info("CDP EVENT: Attached to target %s (session: %s)", target_id, session_id)
                
                # 🔥 记录旧session，用于检测切换
                old_active_session = self._active_session_id
                
                # If no active session yet (regardless of target_id), set this as active
                if not self._active_session_id:
                    self._active_target_id = target_id
                    self._active_session_id = session_id
                    LOGGER.info("Initial active target: %s (session: %s)", target_id, session_id)
                    
                    # Enable domains for this session
                    asyncio.create_task(self._enable_session_domains(session_id))
                    
                    # Immediately capture a screenshot to start video stream
                    asyncio.create_task(self._capture_initial_screenshot())
                
                # If this is the active target, update session
                elif target_id == self._active_target_id:
                    self._active_session_id = session_id
                    LOGGER.info("Updated active session: %s", session_id)
                    
                    # 🔥 新增：session切换，通知前端
                    if old_active_session != session_id and self._mjpeg_server:
                        LOGGER.info(f"⚠️  Active session切换: {old_active_session[:8] if old_active_session else 'None'} → {session_id[:8]}")
                        asyncio.create_task(self._notify_session_switch(session_id, target_id))
                else:
                    # 🔥 其他标签页：只记录session，不自动切换
                    # 避免与switch_tab逻辑冲突
                    LOGGER.info(f"📌 标签页 {target_id[:8]} 已attached，但不自动切换（session: {session_id[:8]})")
                    
                    # 🔥 新增：通知前端有新标签页（此时URL已确定）
                    # 只通知非内部页面和非空URL
                    if self._mjpeg_server and url and url not in ["chrome://newtab/", "about:blank"]:
                        LOGGER.info(f"🔔 检测到用户创建的新标签页，准备通知前端: {url[:50]}")
                        asyncio.create_task(self._notify_tab_created(target_id, url))
                    
                    # 🔥 关键：立即触发新标签页的截图，确保前端画面更新
                    async def _trigger_new_tab_screenshot():
                        await asyncio.sleep(1.5)  # 等待页面初始化和domains启用
                        try:
                            LOGGER.info(f"📸 触发新标签页 {target_id[:8]} 的截图")
                            result = await self.send_message_to_target(
                                session_id,
                                "Page.captureScreenshot",
                                {
                                    "format": "jpeg",
                                    "quality": self._quality,
                                    "captureBeyondViewport": False
                                },
                                wait=True
                            )
                            frame_data = result.get("data")
                            if frame_data:
                                binary = base64.b64decode(frame_data)
                                metadata = {
                                    "offsetTop": 0,
                                    "pageScaleFactor": 1,
                                    "deviceWidth": self.viewport_width,
                                    "deviceHeight": self.viewport_height,
                                    "scrollOffsetX": 0,
                                    "scrollOffsetY": 0
                                }
                                await self._push_frame_to_queue_and_mjpeg(binary, metadata)
                                LOGGER.info(f"✅ 新标签页首帧已推送 ({len(binary)} bytes)")
                            else:
                                LOGGER.warning(f"⚠️  新标签页截图为空")
                        except Exception as e:
                            LOGGER.warning(f"触发新标签页截图失败: {e}")
                    
                    asyncio.create_task(_trigger_new_tab_screenshot())
                    
        elif method == "Target.detachedFromTarget":
            session_id = params.get("sessionId")
            LOGGER.info("CDP EVENT: Detached from session %s", session_id)
            # Clean up
            detached_target_id = None
            for tid, sid in list(self._target_sessions.items()):
                if sid == session_id:
                    detached_target_id = tid
                    del self._target_sessions[tid]
                    if tid == self._active_target_id:
                        LOGGER.warning("Active target %s was detached, will switch to another", tid)
                        self._active_target_id = None
                        self._active_session_id = None
                        
                        # Try to switch to another available target
                        for other_tid, other_sid in self._target_sessions.items():
                            if other_tid in self._target_info and self._target_info[other_tid].get("type") == "page":
                                self._active_target_id = other_tid
                                self._active_session_id = other_sid
                                LOGGER.info("Switched to alternative target: %s (session: %s)", other_tid, other_sid)
                                break
                    break
                    
        elif method == "Target.targetInfoChanged":
            target_info = params.get("targetInfo", {})
            if target_info.get("type") == "page":
                target_id = target_info.get("targetId")
                self._target_info[target_id] = target_info
                LOGGER.debug("CDP EVENT: Tab info changed - %s", target_info.get("title"))
                
        elif method == "Target.targetDestroyed":
            target_id = params.get("targetId")
            LOGGER.info("CDP EVENT: Target destroyed %s", target_id)
            self._target_info.pop(target_id, None)
            self._target_sessions.pop(target_id, None)
            if target_id == self._active_target_id:
                LOGGER.warning("Active target %s was destroyed, will switch to another", target_id)
                self._active_target_id = None
                self._active_session_id = None
                
                # Try to switch to another available target
                for other_tid, other_sid in self._target_sessions.items():
                    if other_tid in self._target_info and self._target_info[other_tid].get("type") == "page":
                        self._active_target_id = other_tid
                        self._active_session_id = other_sid
                        LOGGER.info("Switched to alternative target after destroy: %s (session: %s)", other_tid, other_sid)
                        break
                
                # If no alternative target, create a new one
                if not self._active_target_id:
                    LOGGER.warning("No alternative target available, creating new one...")
                    asyncio.create_task(self._create_fallback_target())
                
        elif method == "Page.windowOpen":
            url = params.get("url")
            LOGGER.info("CDP EVENT: windowOpen url=%s", url)
            
        elif method == "Page.javascriptDialogOpening":
            message = params.get("message")
            type_ = params.get("type")
            LOGGER.info("CDP EVENT: javascriptDialogOpening type=%s message=%s - Auto-accepting", type_, message)
            await self.send_no_wait("Page.handleJavaScriptDialog", {"accept": True})
        
        elif method == "Page.screencastFrame":
            # Handle screencast frame from Chrome's push-based capture
            LOGGER.info(f"🎬 CDP EVENT: Page.screencastFrame received with params keys: {list(params.keys())}")
            await self._handle_screencast_frame(params)
        
        else:
            LOGGER.debug("CDP EVENT: %s", method)
    
    async def _handle_screencast_frame(self, params: dict) -> None:
        """
        Handle Page.screencastFrame event from Chrome's native screencast.
        This is called when Chrome pushes a new frame in PUSH mode.
        """
        try:
            # Extract frame data
            frame_data = params.get("data")
            metadata = params.get("metadata", {})
            session_id = params.get("sessionId")
            
            if not frame_data:
                LOGGER.warning("⚠️ Received screencastFrame without data")
                return
            
            # Update last frame time - CRITICAL for mode detection
            self._last_frame_time = time.time()
            
            # Store session ID for tracking
            if session_id is not None:
                self._screencast_session_id = session_id
            
            # Log first frame received
            if not self._push_frame_received:
                self._push_frame_received = True
                LOGGER.info(f"✅ [PUSH MODE] First frame received! sessionId: {session_id}")
            
            # Decode frame
            binary = base64.b64decode(frame_data)
            
            # 获取并记录截图的实际分辨率（仅首帧）
            if self._frame_count == 0:
                width, height = _get_image_dimensions(binary)
                LOGGER.info(f"📐 [PUSH] 截图实际分辨率: {width}x{height} (viewport设置: {self.viewport_width}x{self.viewport_height})")
            
            # Performance monitoring
            self._frame_count += 1
            now = time.time()
            elapsed = now - self._last_fps_log_time
            
            # Log FPS every 5 seconds
            if elapsed >= 5.0:
                actual_fps = self._frame_count / elapsed
                LOGGER.info(f"📊 [PUSH MODE] FPS: {actual_fps:.1f} ({self._frame_count} frames in {elapsed:.1f}s)")
                self._frame_count = 0
                self._last_fps_log_time = now
            
            # Drop old frames if queue is full (keep only latest)
            if self._frame_queue.full():
                try:
                    self._frame_queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            
            # Add frame to queue (and MJPEG server if available)
            await self._push_frame_to_queue_and_mjpeg(binary, metadata)
            
            # ACK the frame - CRITICAL! Without this, Chrome stops sending frames
            if self._screencast_session_id is not None:
                # Use send_message_to_target_no_wait for immediate ACK without blocking
                # This is faster and avoids any potential issues with response handling
                LOGGER.info(f"🎬 [PUSH] Sending ACK: active_session={self._active_session_id[:8]}, screencast_sessionId={self._screencast_session_id}")
                await self.send_message_to_target_no_wait(
                    self._active_session_id,
                    "Page.screencastFrameAck",
                    {"sessionId": self._screencast_session_id}
                )
                LOGGER.info(f"🎬 [PUSH] ACK sent successfully")
        
        except Exception as e:
            LOGGER.error(f"❌ Error handling screencast frame: {e}", exc_info=True)

    def set_mjpeg_server(self, mjpeg_server):
        """Set the MJPEG server for direct JPEG streaming"""
        self._mjpeg_server = mjpeg_server
        LOGGER.info("📺 MJPEG服务器已连接到CDP客户端")
    
    def set_stream_server(self, stream_server):
        """设置统一流媒体服务器（支持MJPEG/H.264）"""
        self._mjpeg_server = stream_server  # 复用变量名保持兼容性
        LOGGER.info(f"📺 StreamServer已连接到CDP客户端 (模式: {self.stream_mode})")
    
    async def _push_frame_to_queue_and_mjpeg(self, binary: bytes, metadata: dict):
        """
        Push frame to both WebRTC queue and MJPEG/H.264 server
        
        This allows simultaneous WebRTC and direct streaming
        """
        self._latest_frame_jpeg = binary
        
        # Add to WebRTC queue
        await self._frame_queue.put((binary, metadata))
        
        # Push to streaming server (MJPEG or H.264)
        if self._mjpeg_server and self._mjpeg_server._running:
            try:
                # 🎬 根据模式选择不同的处理方式
                if self.stream_mode == "h264":
                    # H.264模式：编码后发送
                    await self._encode_and_send_h264(binary)
                else:
                    # MJPEG模式：直接发送JPEG
                    await self._mjpeg_server.broadcast_mjpeg_frame(binary, metadata)
            except Exception as e:
                # Don't fail WebRTC if streaming push fails
                LOGGER.debug(f"Failed to push frame to streaming server: {e}")
    
    async def _encode_and_send_h264(self, frame_data: bytes):
        """编码并发送H.264帧"""
        if not self._h264_encoder:
            # 延迟初始化H.264编码器
            await self._init_h264_encoder()
        
        try:
            # 解码JPEG/PNG为RGB
            import io
            from PIL import Image
            
            img = Image.open(io.BytesIO(frame_data))
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            rgb_data = img.tobytes()
            
            # 送入编码器
            await self._h264_encoder.encode_frame(rgb_data)
        
        except Exception as e:
            LOGGER.error(f"❌ H.264编码失败: {e}")
    
    async def _init_h264_encoder(self):
        """初始化H.264编码器"""
        try:
            from .h264_encoder import H264Encoder
            
            LOGGER.info("🎬 初始化H.264编码器...")
            
            self._h264_encoder = H264Encoder(
                width=self.viewport_width,
                height=self.viewport_height,
                fps=self._fps,
                bitrate=5000000,  # 5Mbps
                on_frame=self._on_h264_frame
            )
            
            await self._h264_encoder.start()
            
            # 等待SPS/PPS生成
            for _ in range(10):
                await asyncio.sleep(0.1)
                if self._h264_encoder.init_data:
                    # 发送初始化数据给客户端
                    if self._mjpeg_server:
                        await self._mjpeg_server.broadcast_h264_init(
                            self._h264_encoder.init_data
                        )
                    LOGGER.info("✅ H.264编码器已初始化并发送SPS/PPS")
                    break
        
        except Exception as e:
            LOGGER.error(f"❌ H.264编码器初始化失败: {e}")
            raise
    
    async def _on_h264_frame(self, h264_data: bytes, pts: int, is_keyframe: bool):
        """H.264帧回调"""
        if self._mjpeg_server:
            await self._mjpeg_server.broadcast_h264_frame(h264_data, pts, is_keyframe)
    
    async def switch_stream_mode(self, new_mode: str):
        """动态切换流模式"""
        if new_mode == self.stream_mode:
            LOGGER.info(f"🔄 流模式已经是: {new_mode}")
            return
        
        async with self._screenshot_lock:
            old_mode = self.stream_mode
            LOGGER.info(f"🔄 切换流模式: {old_mode} → {new_mode}")
            
            # 停止H.264编码器
            if old_mode == "h264" and self._h264_encoder:
                try:
                    await self._h264_encoder.stop()
                    self._h264_encoder = None
                    LOGGER.info("✅ H.264编码器已停止")
                except Exception as e:
                    LOGGER.error(f"停止H.264编码器失败: {e}")
            
            # 🔥 关键修复：停止旧的截图循环
            if self._screencast_refresh_task and not self._screencast_refresh_task.done():
                LOGGER.info("⏸️ 停止旧的截图捕获循环...")
                self._screencast_refresh_task.cancel()
                try:
                    await self._screencast_refresh_task
                except asyncio.CancelledError:
                    pass
                self._screencast_refresh_task = None
                LOGGER.info("✅ 旧截图循环已停止")
            
            # 更新模式和截图格式
            self.stream_mode = new_mode
            if new_mode == "h264":
                self._screenshot_format = "png"
                self._quality = 100
            else:
                self._screenshot_format = "jpeg"
                self._quality = 98
            
            LOGGER.info(f"✅ 流模式已切换到: {new_mode} (format={self._screenshot_format}, quality={self._quality})")
            
            # 🔥 关键修复：启动新的截图循环
            if self._active_session_id:
                LOGGER.info("🎬 启动新的截图捕获循环...")
                self._screencast_refresh_task = asyncio.create_task(self._screencast_refresh_loop())
                LOGGER.info("✅ 新截图循环已启动")
            else:
                LOGGER.warning("⚠️ 没有活动会话，跳过启动截图循环")
    
    async def next_frame(self) -> Tuple[bytes, Dict[str, Any]]:
        return await self._frame_queue.get()

    async def navigate(self, url: str) -> None:
        LOGGER.info("Navigate to: %s", url)
        # Track intent immediately so status can report something deterministic while the session stabilizes.
        self._last_known_url = url
        self._last_known_url_ts = time.time()
        
        # If no active session yet, wait a bit for auto-attach
        if not self._active_session_id:
            LOGGER.info("Waiting for active session before navigate...")
            for _ in range(10):
                await asyncio.sleep(0.2)
                if self._active_session_id:
                    break
        
        if self._active_session_id:
            LOGGER.info("Navigate using session: %s", self._active_session_id[:8])
            result = await self.send_message_to_target(
                self._active_session_id,
                "Page.navigate",
                {"url": url},
                wait=True
            )
        else:
            LOGGER.warning("No active session, using main target for navigate")
            result = await self.call("Page.navigate", {"url": url})
        
        LOGGER.info("Navigate result: %s", result)
        
        # 注入将在Page.loadEventFired事件中自动执行
        
        # Wait for page to load
        await asyncio.sleep(0.5)
        # Refresh timestamp after the navigate call completes (navigate can take a while).
        self._last_known_url_ts = time.time()

    async def reload(self) -> None:
        if self._active_session_id:
            await self.send_message_to_target(
                self._active_session_id,
                "Page.reload",
                {"ignoreCache": False},
                wait=False
            )
        else:
            await self.call("Page.reload", {"ignoreCache": False})
        
        # 注入将在Page.loadEventFired事件中自动执行

    async def history_step(self, direction: int) -> str:
        async def _get_history(session_id: Optional[str]) -> Dict[str, Any]:
            if session_id:
                return await self.send_message_to_target(session_id, "Page.getNavigationHistory", wait=True)
            return await self.call("Page.getNavigationHistory", {})

        async def _navigate_to_entry(session_id: Optional[str], entry_id: int) -> None:
            if session_id:
                await self.send_message_to_target(
                    session_id,
                    "Page.navigateToHistoryEntry",
                    {"entryId": entry_id},
                    wait=True,
                )
            else:
                await self.call("Page.navigateToHistoryEntry", {"entryId": entry_id})

        try:
            history = await _get_history(self._active_session_id)
            entries = history.get("entries", [])
            current_index = history.get("currentIndex", -1)
            target_index = current_index + direction

            if 0 <= target_index < len(entries):
                entry = entries[target_index]
                await _navigate_to_entry(self._active_session_id, entry["id"])
                url = entry.get("url", "about:blank")

                # Wait briefly for navigation history to reflect the new current entry.
                # This avoids races where the UI issues Forward immediately after Back.
                if url and url != "about:blank":
                    for _ in range(50):  # ~5s max
                        await asyncio.sleep(0.1)
                        try:
                            h = await _get_history(self._active_session_id)
                            cur_idx = h.get("currentIndex", -1)
                            cur_entries = h.get("entries", [])
                            if 0 <= cur_idx < len(cur_entries) and cur_entries[cur_idx].get("url") == url:
                                break
                        except Exception:
                            break

                if url and url != "about:blank":
                    self._last_known_url = url
                    self._last_known_url_ts = time.time()
                return url if url != "about:blank" else (self._last_known_url or "about:blank")

            if 0 <= current_index < len(entries):
                url = entries[current_index].get("url", "about:blank")
                if url and url != "about:blank":
                    self._last_known_url = url
                    self._last_known_url_ts = time.time()
                return url if url != "about:blank" else (self._last_known_url or "about:blank")
        except Exception as e:
            # Try main target as fallback when session-based history is unstable.
            try:
                history = await _get_history(None)
                entries = history.get("entries", [])
                current_index = history.get("currentIndex", -1)
                target_index = current_index + direction
                if 0 <= target_index < len(entries):
                    entry = entries[target_index]
                    await _navigate_to_entry(None, entry["id"])
                    url = entry.get("url", "about:blank")
                    if url and url != "about:blank":
                        for _ in range(50):  # ~5s max
                            await asyncio.sleep(0.1)
                            try:
                                h = await _get_history(None)
                                cur_idx = h.get("currentIndex", -1)
                                cur_entries = h.get("entries", [])
                                if 0 <= cur_idx < len(cur_entries) and cur_entries[cur_idx].get("url") == url:
                                    break
                            except Exception:
                                break
                    if url and url != "about:blank":
                        self._last_known_url = url
                        self._last_known_url_ts = time.time()
                    return url if url != "about:blank" else (self._last_known_url or "about:blank")
                if 0 <= current_index < len(entries):
                    url = entries[current_index].get("url", "about:blank")
                    if url and url != "about:blank":
                        self._last_known_url = url
                        self._last_known_url_ts = time.time()
                    return url if url != "about:blank" else (self._last_known_url or "about:blank")
            except Exception:
                pass
            LOGGER.warning("Failed to navigate history: %s", e)
        
        return self._last_known_url or "about:blank"

    async def dispatch_control_event(self, event: dict) -> None:
        event_type = event.get("type")
        if not event_type:
            return
        
        # Handle batch events (multiple events sent together)
        if event_type == "batch":
            events = event.get("events", [])
            for evt in events:
                await self.dispatch_control_event(evt)
            return
        
        # 🔥 限制同时处理的CDP命令数量（防止积压）
        # 如果队列中有超过10个待处理命令，丢弃非关键事件
        if hasattr(self, '_pending_commands'):
            if self._pending_commands > 10 and event_type in ['mousemove', 'scroll']:
                LOGGER.debug(f"⚠️ CDP命令队列过长({self._pending_commands})，丢弃 {event_type}")
                return
        else:
            self._pending_commands = 0
        
        self._pending_commands += 1
        try:
            await self._dispatch_event_internal(event)
        finally:
            self._pending_commands -= 1
    
    async def _dispatch_event_internal(self, event: dict) -> None:
        """内部事件分发（带计数）"""
        event_type = event.get("type")
        
        # Event deduplication - prevent duplicate events in short time window
        # This is critical to prevent multiple tabs being opened from a single click
        if not event_type:
            return
        
        if event_type in {"mousedown", "mouseup", "click", "dblclick"}:
            x = event.get("x", 0)
            y = event.get("y", 0)
            button = event.get("button", 0)
            current_time = time.time()
            
            # Create position-based key to track all mouse events at same location
            position_key = f"mouse:{x}:{y}:{button}"
            
            # Check if we've received mousedown+mouseup at this position recently
            # If yes, drop the click event to avoid duplicate action
            if event_type == "click":
                mousedown_key = f"mousedown:{x}:{y}:{button}"
                mouseup_key = f"mouseup:{x}:{y}:{button}"
                
                # If we have both mousedown and mouseup within the window, drop the click
                if (mousedown_key in self._last_event_time and 
                    mouseup_key in self._last_event_time):
                    mousedown_time = self._last_event_time[mousedown_key]
                    mouseup_time = self._last_event_time[mouseup_key]
                    
                    # Check if both are recent (within 1 second)
                    if (current_time - mousedown_time < 1.0 and 
                        current_time - mouseup_time < 1.0):
                        LOGGER.info(
                            "Dropping click event at (%s, %s) - already handled by mousedown/mouseup (%.3fs/%.3fs ago)",
                            x, y, current_time - mousedown_time, current_time - mouseup_time
                        )
                        return
            
            # Create a unique key for this specific event type
            event_key = f"{event_type}:{x}:{y}:{button}"
            
            # Check if we've seen the EXACT same event recently (same type, same position)
            if event_key in self._last_event_time:
                time_diff = current_time - self._last_event_time[event_key]
                if time_diff < self._event_dedupe_window:
                    LOGGER.info(
                        "Dropping duplicate %s event at (%s, %s) - seen %.3fs ago",
                        event_type, x, y, time_diff
                    )
                    return
            
            # Record this event
            self._last_event_time[event_key] = current_time
            
            # Clean up old entries (older than 2 seconds) to prevent memory leak
            keys_to_remove = [
                k for k, t in self._last_event_time.items()
                if current_time - t > 2.0
            ]
            for k in keys_to_remove:
                del self._last_event_time[k]
        
        # 🔥 优化：元素信息查询非常慢（2秒+），仅在需要时启用
        # 通过环境变量 ENABLE_ELEMENT_INFO=true 启用
        enable_element_info = os.getenv('ENABLE_ELEMENT_INFO', 'false').lower() == 'true'
        
        # Log event with element info (for mouse events)
        if event_type != "mousemove" and event_type in {"mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel"}:
            if enable_element_info:
                # 仅在显式启用时查询元素信息（录制模式等）
                try:
                    # 添加超时保护：1秒超时
                    element_info = await asyncio.wait_for(
                        self._get_element_at_position(event.get("x", 0), event.get("y", 0)),
                        timeout=1.0
                    )
                    if element_info:
                        LOGGER.info(
                            "CONTROL EVENT: %s at (%s, %s) | Element: %s | XPath: %s | CSS: %s",
                            event_type,
                            event.get("x"),
                            event.get("y"),
                            element_info.get("tag"),
                            element_info.get("xpath"),
                            element_info.get("css")
                        )
                    else:
                        LOGGER.info("CONTROL EVENT: %s at (%s, %s)", event_type, event.get("x"), event.get("y"))
                except asyncio.TimeoutError:
                    LOGGER.warning("⚠️  获取元素信息超时（>1s），跳过")
                    LOGGER.info("CONTROL EVENT: %s at (%s, %s)", event_type, event.get("x"), event.get("y"))
                except Exception as e:
                    LOGGER.warning("Failed to get element info: %s", e)
                    LOGGER.info("CONTROL EVENT: %s at (%s, %s)", event_type, event.get("x"), event.get("y"))
            else:
                # 默认：仅记录事件类型和坐标，快速处理
                LOGGER.info("CONTROL EVENT: %s at (%s, %s)", event_type, event.get("x"), event.get("y"))

        if event_type in {"mousemove", "mousedown", "mouseup", "click", "dblclick", "contextmenu"}:
            await self._dispatch_mouse_event(event)
        elif event_type == "wheel":
            await self._dispatch_wheel_event(event)
        elif event_type in {"keydown", "keyup", "keypress"}:
            LOGGER.info("CONTROL EVENT: %s received", event_type)
            await self._dispatch_key_event(event)
        elif event_type == "textInput":
            # Handle composed text input (e.g., Chinese, Japanese)
            text = event.get("text", "")
            if text:
                LOGGER.info("TEXT INPUT: %s", text)
                await self.send_no_wait("Input.insertText", {"text": text})
        else:
            LOGGER.warning("Unknown control event type: %s", event_type)

    async def _dispatch_mouse_event(self, event: dict) -> None:
        type_mapping = {
            "mousemove": "mouseMoved",
            "mousedown": "mousePressed",
            "mouseup": "mouseReleased",
            "click": "mousePressed",
            "dblclick": "mousePressed",
            "contextmenu": "mousePressed",
        }

        x, y = self._convert_coordinates(event)
        button = self._map_mouse_button(event.get("button", 0))
        
        # For contextmenu, use right button
        if event.get("type") == "contextmenu":
            button = "right"
            LOGGER.info("CONTROL EVENT: contextmenu (right-click) at (%d, %d)", x, y)
        
        # Check if this is a drag operation (mousemove with button pressed)
        is_dragging = event.get("isDragging", False)
        buttons = event.get("buttons", 0)  # Bitmask of pressed buttons
        
        # For drag operations during mousemove, we need to specify which button is held
        if event.get("type") == "mousemove" and is_dragging and buttons > 0:
            # Map buttons bitmask to button name
            # buttons: 1 = left, 2 = right, 4 = middle
            if buttons & 1:
                button = "left"
            elif buttons & 2:
                button = "right"
            elif buttons & 4:
                button = "middle"

        params = {
            "type": type_mapping.get(event["type"], "mouseMoved"),
            "x": x,
            "y": y,
            "button": button,
            "clickCount": 2 if event.get("type") == "dblclick" else 1,
            "modifiers": self._compute_modifiers(event),
        }
        
        # For mousemoved events during drag, we need to set button to "none" but keep buttons
        # Chrome CDP expects button="none" for mouseMoved but uses buttons bitmask to track pressed buttons
        if event.get("type") == "mousemove":
            if is_dragging and buttons > 0:
                # During drag, button should indicate which is pressed
                # But for mouseMoved, we still use "none" and rely on buttons
                params["button"] = "none"
                params["buttons"] = buttons  # Pass the buttons bitmask to indicate drag state
            else:
                params["button"] = "none"

        # Use send_no_wait for input events to avoid blocking/timeouts
        # Log drag events and non-mousemove events
        if event.get("type") != "mousemove":
            LOGGER.info("CDP SEND_NO_WAIT: Input.dispatchMouseEvent type='%s' x=%d y=%d", params["type"], x, y)
        elif is_dragging:
            LOGGER.debug("CDP: Drag move at (%d, %d) buttons=%d", x, y, buttons)
        
        # Use active session if available
        if self._active_session_id:
            await self.send_message_to_target_no_wait(self._active_session_id, "Input.dispatchMouseEvent", params)
            # Send mouseReleased for click and contextmenu
            if event.get("type") in ("click", "contextmenu"):
                await self.send_message_to_target_no_wait(
                    self._active_session_id,
                    "Input.dispatchMouseEvent",
                    {
                        **params,
                        "type": "mouseReleased",
                    },
                )
        else:
            await self.send_no_wait("Input.dispatchMouseEvent", params)
            # Send mouseReleased for click and contextmenu
            if event.get("type") in ("click", "contextmenu"):
                await self.send_no_wait(
                    "Input.dispatchMouseEvent",
                    {
                        **params,
                        "type": "mouseReleased",
                    },
                )

    async def _dispatch_wheel_event(self, event: dict) -> None:
        x, y = self._convert_coordinates(event)

        params = {
            "type": "mouseWheel",
            "x": x,
            "y": y,
            "deltaX": float(event.get("deltaX", 0)),
            "deltaY": float(event.get("deltaY", 0)),
            "modifiers": self._compute_modifiers(event),
        }
        
        # Use active session if available
        if self._active_session_id:
            await self.send_message_to_target_no_wait(self._active_session_id, "Input.dispatchMouseEvent", params)
        else:
            await self.send_no_wait("Input.dispatchMouseEvent", params)

    async def _dispatch_key_event(self, event: dict) -> None:
        mapping = {
            "keydown": "keyDown",
            "keyup": "keyUp",
            "keypress": "char",
        }

        key = event.get("key", "")
        code = event.get("code", "")
        
        # Special keys that should NOT be treated as text input
        special_keys = {
            'Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 
            'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
            'Insert', 'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen',
            'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
            'Control', 'Alt', 'Shift', 'Meta', 'ContextMenu'
        }
        
        # For Chinese and other multi-byte characters, use Input.insertText
        # But exclude special keys
        if (len(key) > 1 and 
            event["type"] == "keydown" and 
            not code.startswith("Key") and 
            not code.startswith("Digit") and
            key not in special_keys):
            # This is likely a composed character (e.g., Chinese input)
            LOGGER.info("KEYBOARD EVENT: insertText | Text: %s", key)
            if self._active_session_id:
                await self.send_message_to_target_no_wait(self._active_session_id, "Input.insertText", {"text": key})
            else:
                await self.send_no_wait("Input.insertText", {"text": key})
            return
        
        text = key if len(key) == 1 else ""
        
        # Log keyboard events with key info
        if event["type"] == "keydown":
            LOGGER.info("KEYBOARD EVENT: keydown | Key: %s | Code: %s", key, event.get("code"))

        params = {
            "type": mapping[event["type"]],
            "key": key,
            "code": event.get("code", ""),
            "windowsVirtualKeyCode": event.get("keyCode", 0),
            "text": text,
            "unmodifiedText": text,
            "modifiers": self._compute_modifiers(event),
            "autoRepeat": event.get("repeat", False),
        }

        # Use active session for keyboard events
        if self._active_session_id:
            await self.send_message_to_target_no_wait(self._active_session_id, "Input.dispatchKeyEvent", params)
        else:
            await self.send_no_wait("Input.dispatchKeyEvent", params)

    def _compute_modifiers(self, event: dict) -> int:
        modifiers = 0
        if event.get("ctrlKey"):
            modifiers |= 1
        if event.get("shiftKey"):
            modifiers |= 2
        if event.get("altKey"):
            modifiers |= 4
        if event.get("metaKey"):
            modifiers |= 8
        return modifiers

    def _map_mouse_button(self, button: int) -> str:
        mapping = {0: "left", 1: "middle", 2: "right"}
        return mapping.get(button, "left")

    def _convert_coordinates(self, event: dict) -> tuple[int, int]:
        raw_x = event.get("x", 0)
        raw_y = event.get("y", 0)
        
        # Frontend already sends coordinates in the correct viewport space
        # Just use them directly without any transformation
        x = max(0, min(self.viewport_width - 1, int(raw_x)))
        y = max(0, min(self.viewport_height - 1, int(raw_y)))
        
        # 🔥 新增：坐标验证和警告
        if int(raw_x) != x or int(raw_y) != y:
            LOGGER.warning(
                f"⚠️  坐标超出viewport: ({int(raw_x)}, {int(raw_y)}) "
                f"→ 钳制到 ({x}, {y}) [viewport: {self.viewport_width}x{self.viewport_height}]"
            )
        
        return x, y
    
    async def _notify_session_switch(self, session_id: str, target_id: str):
        """通知前端active session已切换（用于多标签页场景）"""
        try:
            if self._mjpeg_server:
                # 🔥 修复：发送完整ID，不能截断为8位
                # 前端需要完整ID来调用CDP API
                await self._mjpeg_server.broadcast_control_message({
                    'type': 'TAB_SWITCHED',
                    'sessionId': session_id,  # 完整ID
                    'targetId': target_id,    # 完整ID
                    'viewport': {
                        'width': self.viewport_width,
                        'height': self.viewport_height
                    }
                })
                LOGGER.info(f"📢 已通知前端：标签页切换 → {target_id[:8]} (完整ID已发送)")
        except Exception as e:
            LOGGER.warning(f"通知前端标签页切换失败: {e}")
    
    async def _notify_tab_created(self, target_id: str, url: str):
        """通知前端有新标签页创建（用于点击链接自动切换）"""
        try:
            if self._mjpeg_server:
                await self._mjpeg_server.broadcast_control_message({
                    "type": "TAB_CREATED",
                    "targetId": target_id,
                    "url": url
                })
                LOGGER.info(f"📢 已通知前端：新标签页创建 → {target_id[:8]} (URL: {url[:50] if url else '空URL'})")
        except Exception as e:
            LOGGER.warning(f"通知前端新标签页创建失败: {e}")
    
    async def _delayed_notify_tab_created(self, target_id: str, url: str):
        """延迟通知前端新标签页创建（给URL时间加载）"""
        # 等待2秒，让URL有时间加载
        await asyncio.sleep(2.0)
        
        # 尝试获取最新的URL
        if target_id in self._target_info:
            latest_url = self._target_info[target_id].get("url", url)
            if latest_url and latest_url != url:
                LOGGER.info(f"🔄 URL已更新: {url or '空'} → {latest_url[:50]}")
                url = latest_url
        
        # 如果URL仍为空，使用about:blank作为占位符
        if not url:
            url = "about:blank"
            LOGGER.info(f"⚠️  标签页 {target_id[:8]} URL仍为空，使用about:blank")
        
        # 发送通知
        await self._notify_tab_created(target_id, url)
    
    async def get_current_url(self) -> str:
        """获取当前活动标签页的URL"""
        # Prefer the active session navigation history (most accurate), then fall back to main target
        # and last-known URL so the UI remains deterministic during init / reconnect races.
            
        try:
            if self._active_session_id:
                history = await self.send_message_to_target(self._active_session_id, "Page.getNavigationHistory", wait=True)
            else:
                history = await self.call("Page.getNavigationHistory", {})
            entries = history.get("entries", [])
            current_index = history.get("currentIndex", -1)
            if 0 <= current_index < len(entries):
                url = entries[current_index].get("url", "about:blank")
                # If we recently initiated a navigation, prefer the intent URL briefly to avoid flaky
                # status reads right after Page.navigate returns.
                if (
                    self._last_known_url
                    and self._last_known_url != "about:blank"
                    and self._last_known_url != url
                    and (time.time() - self._last_known_url_ts) < 3.0
                ):
                    return self._last_known_url
                if url and url != "about:blank":
                    self._last_known_url = url
                    self._last_known_url_ts = time.time()
                return url if url != "about:blank" else (self._last_known_url or "about:blank")
        except Exception as e:
            LOGGER.debug("Failed to get current URL: %s", e)
        return self._last_known_url or "about:blank"
    
    async def _enable_session_domains(self, session_id: str) -> None:
        """Enable necessary domains for a session"""
        try:
            await self.send_message_to_target(session_id, "Page.enable", wait=False)
            await self.send_message_to_target(session_id, "DOM.enable", wait=False)
            await self.send_message_to_target(session_id, "Runtime.enable", wait=False)
            
            # 🔥 关键修复：强制设置统一的viewport（防止多标签页坐标偏移）
            await self.send_message_to_target(
                session_id,
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": self.viewport_width,
                    "height": self.viewport_height,
                    "deviceScaleFactor": 1,
                    "mobile": False,
                    "screenWidth": self.viewport_width,
                    "screenHeight": self.viewport_height,
                },
                wait=False
            )
            
            LOGGER.info(f"✅ Session {session_id[:8]}: 域已启用 + viewport设置为 {self.viewport_width}x{self.viewport_height}")
            
            # 🎬 注入录制器（第一次尝试，作为备份）
            # 主要的注入会在Page.loadEventFired时执行
            await asyncio.sleep(1.0)
            asyncio.create_task(self.inject_recorder(session_id))
            # 注入元素定位脚本（XPath）
            asyncio.create_task(self.inject_element_locator(session_id))
            
        except Exception as e:
            LOGGER.warning("Failed to enable domains for session %s: %s", session_id[:8], e)
    
    async def _capture_initial_screenshot(self) -> None:
        """Capture an initial screenshot immediately after session is established"""
        try:
            # Skip initial screenshot if not in POLL mode
            # PUSH mode and initializing mode will handle frames on their own
            if self._capture_mode != "poll":
                LOGGER.info(f"⏭️ Skipping initial screenshot (mode: {self._capture_mode})")
                return
            
            # Wait longer for page to load and render
            await asyncio.sleep(2.0)
            
            # Check again after sleep in case mode changed
            if self._capture_mode != "poll":
                LOGGER.info(f"⏭️ Skipping initial screenshot (mode changed to: {self._capture_mode})")
                return
            
            if not self._active_session_id:
                LOGGER.warning("No active session for initial screenshot")
                return
            
            LOGGER.info("📸 [POLL] Capturing initial screenshot for session: %s", self._active_session_id[:8])
            
            # Retry up to 5 times if screenshot is empty
            for attempt in range(5):
                result = await self.send_message_to_target(
                    self._active_session_id,
                    "Page.captureScreenshot",
                    {
                        "format": "jpeg",
                        "quality": self._quality,
                        "captureBeyondViewport": False
                    },
                    wait=True
                )
                
                frame_data = result.get("data")
                if frame_data and len(frame_data) > 0:
                    binary = base64.b64decode(frame_data)
                    width, height = _get_image_dimensions(binary)
                    LOGGER.info("📸 [POLL] Initial screenshot captured! Binary size: %d bytes, 分辨率: %dx%d (attempt %d)", 
                               len(binary), width, height, attempt + 1)
                    metadata = {
                        "offsetTop": 0,
                        "pageScaleFactor": 1,
                        "deviceWidth": self.viewport_width,
                        "deviceHeight": self.viewport_height,
                        "scrollOffsetX": 0,
                        "scrollOffsetY": 0
                    }
                    await self._push_frame_to_queue_and_mjpeg(binary, metadata)
                    LOGGER.info("Initial screenshot queued successfully")
                    return
                else:
                    LOGGER.warning("Screenshot attempt %d returned empty data, retrying...", attempt + 1)
                    await asyncio.sleep(1.0)
            
            LOGGER.error("Failed to capture initial screenshot after 5 attempts (all returned empty data)")
        except Exception as e:
            LOGGER.error("Failed to capture initial screenshot: %s", e, exc_info=True)
    
    async def _create_fallback_target(self) -> None:
        """Create a fallback target when all targets are destroyed"""
        try:
            await asyncio.sleep(0.5)  # Wait a bit to see if a new target is created naturally
            if self._active_session_id:
                return  # A new target was created
            
            LOGGER.info("Creating fallback target...")
            result = await self.call("Target.createTarget", {"url": "about:blank"})
            new_target_id = result.get("targetId")
            if new_target_id:
                LOGGER.info("Created fallback target: %s", new_target_id)
                # Wait for auto-attach event
                for _ in range(10):
                    await asyncio.sleep(0.3)
                    if self._active_session_id:
                        LOGGER.info("Fallback target attached successfully")
                        break
        except Exception as e:
            LOGGER.error("Failed to create fallback target: %s", e)

    async def list_tabs(self) -> list:
        """List all open tabs"""
        # Use cached target info instead of calling Target.getTargets
        # because flatten=True prevents calling it on main target
        tabs = []
        for target_id, info in self._target_info.items():
            if info.get("type") == "page":
                tabs.append({
                    "targetId": target_id,
                    "title": info.get("title", "Untitled"),
                    "url": info.get("url", ""),
                    "attached": target_id in self._target_sessions
                })
        return tabs

    async def switch_tab(self, target_id: str) -> bool:
        """Switch to a specific tab"""
        try:
            # 🔥 检查连接状态
            if not await self._ensure_connected():
                LOGGER.error("CDP连接已断开，无法切换标签页")
                return False
            
            # First activate the target
            await asyncio.wait_for(
                self.call("Target.activateTarget", {"targetId": target_id}),
                timeout=5.0
            )
            
            # Attach to the target to get its session (or reuse existing)
            if target_id in self._target_sessions:
                session_id = self._target_sessions[target_id]
                LOGGER.info("Reusing existing session for tab: %s (session: %s)", target_id[:8], session_id[:8])
            else:
                # 🔥 即使CDP已经attached，也可以调用attachToTarget获取sessionId
                # CDP会返回现有的session而不是创建新的
                LOGGER.info(f"Target {target_id[:8]} not in _target_sessions, attaching...")
                try:
                    result = await asyncio.wait_for(
                        self.call("Target.attachToTarget", {
                            "targetId": target_id,
                            "flatten": True
                        }),
                        timeout=10.0
                    )
                    session_id = result.get("sessionId")
                    if not session_id:
                        LOGGER.error(f"❌ attachToTarget返回空session: {result}")
                        return False
                    
                    self._target_sessions[target_id] = session_id
                    LOGGER.info(f"✅ Got session for tab {target_id[:8]}: {session_id[:8]}")
                    
                    # Enable domains for newly attached session
                    await self._enable_session_domains(session_id)
                except asyncio.TimeoutError:
                    LOGGER.error(f"❌ attachToTarget超时 (10秒): {target_id[:8]}")
                    return False
                except Exception as e:
                    LOGGER.error(f"❌ attachToTarget失败: {e}")
                    return False
            
            # Update active target and session
            self._active_target_id = target_id
            self._active_session_id = session_id
            
            LOGGER.info("Switched to tab: %s (session: %s)", target_id, session_id)
            
            # 🔥 通知前端
            if self._mjpeg_server:
                await self._notify_session_switch(session_id, target_id)
            
            # Give Chrome time to switch context
            await asyncio.sleep(0.1)
            
            # Force capture a screenshot immediately after switching
            # This ensures the video stream updates right away
            try:
                result = await self.send_message_to_target(
                    session_id,
                    "Page.captureScreenshot",
                    {
                        "format": "jpeg",
                        "quality": self._quality,
                        "captureBeyondViewport": False
                    },
                    wait=True
                )
                frame_data = result.get("data")
                if frame_data:
                    binary = base64.b64decode(frame_data)
                    
                    # 记录切换标签页后的截图分辨率
                    width, height = _get_image_dimensions(binary)
                    LOGGER.info(f"📐 [标签切换] 截图实际分辨率: {width}x{height} (viewport设置: {self.viewport_width}x{self.viewport_height})")
                    
                    metadata = {
                        "offsetTop": 0,
                        "pageScaleFactor": 1,
                        "deviceWidth": self.viewport_width,
                        "deviceHeight": self.viewport_height,
                        "scrollOffsetX": 0,
                        "scrollOffsetY": 0
                    }
                    # Drop old frames if queue is full
                    if self._frame_queue.full():
                        try:
                            self._frame_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    await self._push_frame_to_queue_and_mjpeg(binary, metadata)
                    LOGGER.info("Captured screenshot after tab switch (size: %d bytes)", len(binary))
            except Exception as e:
                LOGGER.warning("Failed to capture screenshot after tab switch: %s", e)
            
            return True
        except Exception as e:
            LOGGER.error("Failed to switch tab: %s", e)
            return False

    async def close_tab(self, target_id: str) -> bool:
        """Close a specific tab"""
        try:
            # Count how many page targets we have
            page_targets = [tid for tid, info in self._target_info.items() 
                           if info.get("type") == "page"]
            
            # Prevent closing the last tab (would cause Chrome to exit)
            if len(page_targets) <= 1:
                LOGGER.warning("Cannot close the last tab - would cause Chrome to exit")
                return False
            
            # If closing the active tab, switch to another one first
            if target_id == self._active_target_id:
                LOGGER.info("Closing active tab, switching to another first...")
                # Find another tab to switch to
                for other_tid in page_targets:
                    if other_tid != target_id:
                        success = await self.switch_tab(other_tid)
                        if success:
                            LOGGER.info("Switched to tab %s before closing %s", other_tid, target_id)
                            break
                        else:
                            LOGGER.warning("Failed to switch to tab %s", other_tid)
                
                # If we couldn't switch, don't close
                if target_id == self._active_target_id:
                    LOGGER.error("Failed to switch away from active tab, aborting close")
                    return False
            
            # Now safe to close the tab
            await self.call("Target.closeTarget", {"targetId": target_id})
            LOGGER.info("Closed tab: %s", target_id)
            return True
        except Exception as e:
            LOGGER.error("Failed to close tab: %s", e)
            return False

    async def create_tab(self, url: str = "about:blank") -> Optional[str]:
        """Create a new tab"""
        try:
            result = await self.call("Target.createTarget", {"url": url})
            target_id = result.get("targetId")
            LOGGER.info("Created new tab: %s", target_id)
            return target_id
        except Exception as e:
            LOGGER.error("Failed to create tab: %s", e)
            return None
    
    async def execute_script(self, script: str):
        """Execute JavaScript in the active tab"""
        if not self._active_session_id:
            raise RuntimeError("No active session")
        
        try:
            result = await self.send_message_to_target(
                self._active_session_id,
                "Runtime.evaluate",
                {
                    "expression": script,
                    "returnByValue": True,
                    "awaitPromise": True
                },
                wait=True
            )
            
            if result.get("exceptionDetails"):
                error = result["exceptionDetails"].get("text", "Script error")
                raise RuntimeError(f"Script execution failed: {error}")
            
            return result.get("result", {}).get("value")
        except Exception as e:
            LOGGER.error("Failed to execute script: %s", e)
            raise

    async def _get_element_at_position(self, x: int, y: int) -> Optional[dict]:
        """Get element information at given coordinates"""
        if not self._active_session_id:
            LOGGER.info("XPath: No active session for element lookup")
            return None
            
        try:
            LOGGER.info("XPath: Getting element at position (%d, %d) for session %s", x, y, self._active_session_id[:8])
            
            # Ensure DOM tree is initialized
            try:
                await self.send_message_to_target(
                    self._active_session_id,
                    "DOM.getDocument",
                    {"depth": -1, "pierce": True},
                    wait=True
                )
            except Exception as e:
                LOGGER.debug("DOM.getDocument call (may already be initialized): %s", e)
            
            # Get node at position (use active session)
            result = await self.send_message_to_target(
                self._active_session_id,
                "DOM.getNodeForLocation",
                {"x": x, "y": y, "includeUserAgentShadowDOM": True},
                wait=True
            )
            
            LOGGER.info("XPath: DOM.getNodeForLocation result: %s", str(result)[:200])
            
            node_id = result.get("nodeId")
            backend_node_id = result.get("backendNodeId")
            
            # If we got backendNodeId instead of nodeId, convert it
            if not node_id and backend_node_id:
                LOGGER.info("XPath: Got backendNodeId %s, converting to nodeId", backend_node_id)
                try:
                    push_result = await self.send_message_to_target(
                        self._active_session_id,
                        "DOM.pushNodesByBackendIdsToFrontend",
                        {"backendNodeIds": [backend_node_id]},
                        wait=True
                    )
                    LOGGER.info("XPath: pushNodesByBackendIdsToFrontend result: %s", push_result)
                    node_ids = push_result.get("nodeIds", [])
                    if node_ids and node_ids[0]:
                        node_id = node_ids[0]
                        LOGGER.info("XPath: Converted to nodeId: %s", node_id)
                    else:
                        LOGGER.warning("XPath: pushNodesByBackendIdsToFrontend returned empty or invalid nodeIds: %s", node_ids)
                except Exception as e:
                    LOGGER.error("XPath: Failed to convert backendNodeId: %s", e, exc_info=True)
            
            if not node_id:
                LOGGER.info("XPath: No node found at position (%d, %d)", x, y)
                return None
            
            LOGGER.info("XPath: Found node ID: %s", node_id)
            
            # Get basic node info first
            node_result = await self.send_message_to_target(
                self._active_session_id,
                "DOM.describeNode",
                {"nodeId": node_id},
                wait=True
            )
            
            node = node_result.get("node", {})
            if not node:
                LOGGER.warning("XPath: No node details returned")
                return None
            
            tag_name = node.get("nodeName", "").lower()
            node_attrs_list = node.get("attributes", [])
            
            # Parse attributes
            attrs = {}
            for i in range(0, len(node_attrs_list), 2):
                if i + 1 < len(node_attrs_list):
                    attrs[node_attrs_list[i]] = node_attrs_list[i + 1]
            
            LOGGER.info("XPath: Target node: tag=%s, id=%s, class=%s", tag_name, attrs.get("id", ""), attrs.get("class", "")[:50] if attrs.get("class") else "")
            
            # Use JavaScript to generate XPath and CSS selector
            js_code = """
            function() {
                const element = this;
                
                // Generate XPath
                function getXPath(el) {
                    if (!el || el.nodeType !== 1) return '';
                    if (el.id) {
                        return '//*[@id="' + el.id + '"]';
                    }
                    if (el === document.body) {
                        return '/html/body';
                    }
                    if (el === document.documentElement) {
                        return '/html';
                    }
                    
                    let path = [];
                    while (el && el.nodeType === 1) {
                        let index = 1;
                        let sibling = el.previousSibling;
                        while (sibling) {
                            if (sibling.nodeType === 1 && sibling.nodeName === el.nodeName) {
                                index++;
                            }
                            sibling = sibling.previousSibling;
                        }
                        
                        let tagName = el.nodeName.toLowerCase();
                        let pathIndex = '[' + index + ']';
                        path.unshift(tagName + pathIndex);
                        
                        el = el.parentElement;
                        if (!el || el === document.documentElement) {
                            path.unshift('html');
                            break;
                        }
                    }
                    
                    return '/' + path.join('/');
                }
                
                // Generate CSS selector
                function getCSSSelector(el) {
                    if (!el || el.nodeType !== 1) return '';
                    if (el.id) {
                        return '#' + el.id;
                    }
                    
                    let path = [];
                    let current = el;
                    while (current && current.nodeType === 1 && path.length < 5) {
                        let selector = current.nodeName.toLowerCase();
                        if (current.className && typeof current.className === 'string') {
                            let classes = current.className.trim().split(/\\s+/).filter(c => c).slice(0, 2);
                            if (classes.length > 0) {
                                selector += '.' + classes.join('.');
                            }
                        }
                        path.unshift(selector);
                        if (current.id) {
                            break;
                        }
                        current = current.parentElement;
                    }
                    
                    return path.join(' > ');
                }
                
                return {
                    xpath: getXPath(element),
                    css: getCSSSelector(element),
                    tag: element.nodeName.toLowerCase()
                };
            }
            """
            
            # Resolve node to object
            resolve_result = await self.send_message_to_target(
                self._active_session_id,
                "DOM.resolveNode",
                {"nodeId": node_id},
                wait=True
            )
            
            object_id = resolve_result.get("object", {}).get("objectId")
            if not object_id:
                LOGGER.warning("XPath: Could not resolve node to object")
                # Fallback to simple XPath
                xpath = f"//*[@id='{attrs['id']}']" if attrs.get("id") else f"//{tag_name}"
                css_selector = f"#{attrs['id']}" if attrs.get("id") else tag_name
            else:
                # Execute JavaScript to get XPath and CSS
                eval_result = await self.send_message_to_target(
                    self._active_session_id,
                    "Runtime.callFunctionOn",
                    {
                        "functionDeclaration": js_code,
                        "objectId": object_id,
                        "returnByValue": True
                    },
                    wait=True
                )
                
                result_value = eval_result.get("result", {}).get("value", {})
                xpath = result_value.get("xpath", f"//{tag_name}")
                css_selector = result_value.get("css", tag_name)
                LOGGER.info("XPath: Generated via JS: xpath=%s, css=%s", xpath, css_selector)
            
            LOGGER.info("Element found: tag=%s, css=%s, xpath=%s", tag_name, css_selector, xpath)
            
            return {
                "tag": tag_name,
                "css": css_selector,
                "xpath": xpath,
                "id": attrs.get("id"),
                "class": attrs.get("class")
            }
        except Exception as e:
            LOGGER.warning("Failed to get element at position (%d, %d): %s", x, y, e)
            return None

    def _generate_unique_css_selector_sync(self, node: dict, attrs: dict) -> str:
        """Generate a unique CSS selector for the element (synchronous)"""
        tag = node.get("nodeName", "").lower()
        
        # Try ID first (most specific)
        if attrs.get("id"):
            return f"#{attrs['id']}"
        
        # Try unique attributes
        selectors = [tag]
        
        # Add class if present
        if attrs.get("class"):
            classes = attrs["class"].split()
            if classes:
                selectors.append(f".{classes[0]}")
        
        # Add type for inputs
        if tag == "input" and attrs.get("type"):
            selectors.append(f'[type="{attrs["type"]}"]')
        
        # Add name if present
        if attrs.get("name"):
            selectors.append(f'[name="{attrs["name"]}"]')
        
        return "".join(selectors)

    def _generate_xpath_sync(self, node: dict, attrs: dict) -> str:
        """Generate XPath for the element (synchronous)"""
        tag = node.get("nodeName", "").lower()
        
        # Build XPath
        if attrs.get("id"):
            return f"//*[@id='{attrs['id']}']"
        
        xpath_parts = [f"//{tag}"]
        if attrs.get("class"):
            classes = attrs["class"].split()
            if classes:
                xpath_parts.append(f"[contains(@class, '{classes[0]}')]")
        elif attrs.get("name"):
            xpath_parts.append(f"[@name='{attrs['name']}']")
        
        return "".join(xpath_parts)

    def set_fps(self, fps: int) -> None:
        """Set capture frame rate (1-60 fps)"""
        self._fps = max(1, min(60, fps))
        LOGGER.info("FPS set to: %d", self._fps)

    def set_quality(self, quality: int) -> None:
        """Set JPEG quality (1-100)"""
        self._quality = max(1, min(100, quality))
        LOGGER.info("Quality set to: %d", self._quality)
    
    def set_format(self, format_type: str) -> None:
        """Set screenshot format: 'png' (lossless) or 'jpeg' (compressed)"""
        if format_type in ["png", "jpeg"]:
            self._screenshot_format = format_type
            LOGGER.info("Screenshot format set to: %s", format_type)
    
    async def set_resolution(self, width: int, height: int) -> None:
        """Change viewport resolution dynamically"""
        if width == self.viewport_width and height == self.viewport_height:
            LOGGER.info(f"分辨率已经是 {width}x{height}，无需更改")
            return
        
        LOGGER.info(f"📐 开始更改分辨率: {self.viewport_width}x{self.viewport_height} → {width}x{height}")
        
        # Update internal resolution
        self.viewport_width = width
        self.viewport_height = height
        
        # Apply new resolution to all active sessions
        try:
            # 🔥 关键修复：必须发送到active session，而不是主session
            if self._active_session_id:
                await self.send_message_to_target(
                    self._active_session_id,
                    "Emulation.setDeviceMetricsOverride",
                    {
                        "width": width,
                        "height": height,
                        "deviceScaleFactor": 1,
                        "mobile": False,
                        "screenWidth": width,
                        "screenHeight": height,
                    },
                    wait=True
                )
                LOGGER.info(f"✅ Active session分辨率已更改为 {width}x{height}")
                
                # 同时更新所有已打开的标签页（防止切换标签时分辨率不一致）
                for target_id, session_id in self._target_sessions.items():
                    if session_id != self._active_session_id:
                        try:
                            await self.send_message_to_target(
                                session_id,
                                "Emulation.setDeviceMetricsOverride",
                                {
                                    "width": width,
                                    "height": height,
                                    "deviceScaleFactor": 1,
                                    "mobile": False,
                                    "screenWidth": width,
                                    "screenHeight": height,
                                },
                                wait=False  # 异步发送，不等待响应
                            )
                            LOGGER.debug(f"✅ 标签页 {target_id[:8]} 分辨率已更新")
                        except Exception as e:
                            LOGGER.warning(f"更新标签页 {target_id[:8]} 分辨率失败: {e}")
            else:
                LOGGER.warning("⚠️ 没有active session，跳过分辨率设置")
                
        except Exception as e:
            LOGGER.error(f"❌ 更改分辨率失败: {e}")
            raise

    def get_capture_mode_info(self) -> dict:
        """Get current capture mode information"""
        if self._capture_mode == "push":
            return {
                "mode": "push",
                "detail": "Page.startScreencast 活跃",
                "fps_target": self._fps,
                "quality": self._quality
            }
        elif self._capture_mode == "poll":
            return {
                "mode": "poll",
                "detail": f"Page.captureScreenshot 轮询中 ({self._mode_switch_reason})",
                "fps_target": self._fps,
                "quality": self._quality
            }
        else:
            return {
                "mode": "initializing",
                "detail": "正在初始化...",
                "fps_target": self._fps,
                "quality": self._quality
            }

    async def _screencast_refresh_loop(self) -> None:
        """
        Smart frame capture with automatic fallback.
        
        Starts with PUSH mode (Page.startScreencast), automatically falls back to 
        POLL mode (Page.captureScreenshot) if no frames are received within 5 seconds.
        """
        LOGGER.info("🎬 Frame capture loop STARTED")
        LOGGER.info("📡 Initial mode: PUSH (Page.startScreencast)")
        LOGGER.info("🔧 Resolution: %dx%d @ %dfps, Quality: %d", 
                   self.viewport_width, self.viewport_height, self._fps, self._quality)
        
        try:
            # Wait for active session
            retry_count = 0
            while not self._active_session_id:
                retry_count += 1
                LOGGER.info(f"⏳ Waiting for active session... (attempt {retry_count})")
                await asyncio.sleep(0.5)
                if retry_count > 20:  # 10 seconds timeout
                    LOGGER.error("❌ Timeout waiting for active session")
                    return
            
            LOGGER.info(f"✅ Active session ready: {self._active_session_id[:8]}")
            
            # Chrome headless --headless=new 不可靠支持 Page.startScreencast
            # 直接使用优化的POLL模式
            LOGGER.info("📸 Using optimized POLL mode (headless Chrome limitation)")
            self._capture_mode = "poll"
            self._mode_switch_reason = "Chrome headless limitations"
            
            # Optimized POLL mode loop
            loop_count = 0
            
            while True:
                loop_count += 1
                now = time.time()
                
                if not self.websocket or not self._active_session_id:
                    LOGGER.warning("⚠️ Connection lost, stopping capture loop")
                    break
                
                # Optimized POLL mode: actively capture screenshots
                if loop_count == 1:
                    LOGGER.info("🔄 [POLL MODE] Starting optimized screenshot polling")
                    LOGGER.info("📸 Target: %d fps at %dx%d, Quality: %d", 
                               self._fps, self.viewport_width, self.viewport_height, self._quality)
                
                try:
                    start_time = time.time()
                    
                    # High-quality screenshot parameters (optimized for MJPEG mode)
                    params = {
                        "format": "jpeg",
                        "quality": self._quality,
                        "captureBeyondViewport": False,
                        "optimizeForSpeed": False,  # Prioritize quality over speed (critical for dynamic content)
                        "fromSurface": True,  # Capture from render surface for better quality
                    }
                    
                    result = await self.send_message_to_target(
                        self._active_session_id,
                        "Page.captureScreenshot",
                        params,
                        wait=True
                    )
                    
                    frame_data = result.get("data")
                    if frame_data:
                        binary = base64.b64decode(frame_data)
                        
                        # 记录轮询模式第一帧的实际分辨率
                        if loop_count == 1:
                            width, height = _get_image_dimensions(binary)
                            LOGGER.info(f"📐 [POLL轮询] 截图实际分辨率: {width}x{height} (viewport设置: {self.viewport_width}x{self.viewport_height})")
                        
                        # 🔥 改进1: 画面变化检测（借鉴货拉拉）
                        frame_changed = True
                        if self._adaptive_fps_enabled:
                            current_hash = hashlib.md5(binary).hexdigest()
                            if current_hash == self._last_frame_hash:
                                self._no_change_count += 1
                                frame_changed = False
                            else:
                                # 画面变化：重置计数器
                                if self._no_change_count >= 30:  # 只有真正静止很久才记录日志
                                    LOGGER.info(f"🎬 画面恢复动态 (静止了{self._no_change_count}帧)")
                                self._no_change_count = 0
                                self._last_frame_hash = current_hash
                                frame_changed = True
                        
                        # Drop old frames if queue is full (keep only latest)
                        while self._frame_queue.full():
                            try:
                                self._frame_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                break
                        
                        metadata = {
                            "offsetTop": 0,
                            "pageScaleFactor": 1,
                            "deviceWidth": self.viewport_width,
                            "deviceHeight": self.viewport_height,
                            "scrollOffsetX": 0,
                            "scrollOffsetY": 0
                        }
                        await self._push_frame_to_queue_and_mjpeg(binary, metadata)
                        
                        # Performance monitoring
                        self._frame_count += 1
                        if now - self._last_fps_log_time >= 5.0:
                            elapsed = now - self._last_fps_log_time
                            actual_fps = self._frame_count / elapsed
                            capture_time = (time.time() - start_time) * 1000
                            LOGGER.info(f"📊 [POLL MODE] FPS: {actual_fps:.1f} | Avg capture: {capture_time:.1f}ms")
                            self._frame_count = 0
                            self._last_fps_log_time = now
                        
                        if loop_count == 1:
                            LOGGER.info("✅ [POLL MODE] First frame captured")
                    
                    # 🔥 改进1: 自适应睡眠 - 静止画面降低FPS
                    elapsed = time.time() - start_time
                    
                    if self._adaptive_fps_enabled and self._no_change_count >= 30:
                        # 画面静止超过30帧（约2秒），降低到5fps
                        if self._no_change_count == 30:
                            LOGGER.info(f"🎬 画面静止超过2秒，降低FPS: {self._fps}fps → {self._static_fps}fps")
                        target_interval = 1.0 / self._static_fps
                    else:
                        # 画面动态或刚静止不久，保持正常FPS
                        target_interval = 1.0 / self._fps
                    
                    sleep_time = max(0.001, target_interval - elapsed)
                    await asyncio.sleep(sleep_time)
                
                except Exception as e:
                    if loop_count % 100 == 1:
                        LOGGER.warning(f"⚠️ [POLL MODE] Capture failed: {e}")
                    await asyncio.sleep(0.1)
        
        except asyncio.CancelledError:
            LOGGER.info("🛑 Capture loop CANCELLED")
            # Stop screencast if active
            if self._capture_mode == "push":
                try:
                    if self._active_session_id:
                        await self.send_message_to_target(
                            self._active_session_id,
                            "Page.stopScreencast",
                            {},
                            wait=False
                        )
                        LOGGER.info("🛑 [PUSH MODE] Screencast stopped")
                except Exception:
                    pass
        
        except Exception as e:
            LOGGER.error(f"❌ Capture loop ERROR: {e}", exc_info=True)


__all__ = ["CDPClient", "LOGGER"]
