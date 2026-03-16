import asyncio
import json
import logging
import os
from io import BytesIO
from typing import Optional, Dict

import numpy as np
from PIL import Image
from av import VideoFrame

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import VideoStreamTrack

from headless.cdp_client import CDPClient
from headless.chrome_manager import ChromeManager
from headless.encoder_patch import apply_all_patches
from headless.scrcpy_capture import ScrcpyCaptureEngine
from headless.scrcpy_encoder import ScrcpyH264Encoder
from headless.scrcpy_event_handler import ScrcpyEventHandler

LOGGER = logging.getLogger(__name__)

# Global MJPEG server reference (will be set by server.py)
_mjpeg_server_instance = None

def set_mjpeg_server(mjpeg_server):
    """Set the global MJPEG server instance"""
    global _mjpeg_server_instance
    _mjpeg_server_instance = mjpeg_server
    LOGGER.info("MJPEG服务器已注册到WebRTC Bridge")

# Apply encoder patches at module import time
apply_all_patches()


class CDPVideoTrack(VideoStreamTrack):
    """
    High-quality video track optimized for screen sharing.
    
    Key optimizations:
    - High bitrate for crisp text and UI
    - Screen content tuning for VP8
    - Optimized for both static and dynamic content
    """

    kind = "video"

    def __init__(self, cdp_client: CDPClient, low_latency: bool = False) -> None:
        super().__init__()
        self._cdp = cdp_client
        self._last_frame = None
        self._low_latency = low_latency
        
        # 🔥 新增：低延迟模式配置
        if low_latency:
            # 低延迟优化配置（牺牲部分质量换取低延迟）
            self._encoder_options = {
                # VP8 low latency mode
                "tune": "screen",
                
                # 🔥 低延迟关键参数
                "deadline": "good",         # 更快的编码
                "cpu-used": "5",            # 5 = 快速编码（0-16范围）
                "lag-in-frames": "0",       # 零延迟
                "error-resilient": "1",     # 提高容错性
                
                # Bitrate control
                "target_bitrate": "5M",     # 降低目标码率
                "max_bitrate": "8M",
                "min_bitrate": "3M",
                
                # Rate control
                "rc_mode": "cbr",
                
                # 🔥 低延迟关键帧设置
                "g": "30",                  # 更频繁的关键帧（1秒1次）
                "kf-max-dist": "30",
                
                # Quality (略微放宽以提升速度)
                "qmin": "10",               # 略微降低最低质量
                "qmax": "56",
                
                # 🔥 低延迟buffer设置
                "buf-initial-sz": "10",     # 最小buffer
                "buf-optimal-sz": "20",
                "buf-sz": "30",
                
                # 编码速度优化
                "static-thresh": "1000",    # 减少静态区域检测开销
                "drop-frame": "0",          # 不丢帧
            }
            LOGGER.info("🚀 WebRTC低延迟编码器已启用")
        else:
            # Configure encoder options for screen sharing (高质量模式)
            # These will be picked up by aiortc's encoder
            self._encoder_options = {
                # VP8 screen content mode
                "tune": "screen",  # Optimize for screen content (text/UI)
                
                # Quality settings
                "deadline": "realtime",  # Balance quality and latency
                "cpu-used": "1",  # 0-16, lower = better quality, 1 is good balance
                
                # Bitrate control - CRITICAL FOR QUALITY
                "target_bitrate": "10M",  # 10 Mbps target
                "max_bitrate": "15M",     # 15 Mbps max
                "min_bitrate": "5M",      # 5 Mbps min
                
                # Rate control
                "rc_mode": "cbr",  # Constant bitrate for consistent quality
                
                # Keyframe settings
                "g": "120",  # Keyframe every 120 frames (4s at 30fps)
                
                # Quality
                "qmin": "4",   # Minimum quantizer (4 = high quality)
                "qmax": "48",  # Maximum quantizer (lower = better quality)
                
                # Screen sharing optimizations
                "static-thresh": "0",     # Detect static regions
                "max-intra-rate": "300",  # Allow more intra refresh
                "quality": "best",        # Best quality mode
                
                # Buffer settings for low latency
                "buf-initial-sz": "50",
                "buf-optimal-sz": "100",
            "buf-sz": "150",
        }

    async def recv(self):
        try:
            frame_bytes, _metadata = await asyncio.wait_for(self._cdp.next_frame(), timeout=1.0)
        except asyncio.TimeoutError:
            if self._last_frame:
                return self._last_frame
            return await self.recv()
            
        # Convert to RGB
        image = Image.open(BytesIO(frame_bytes)).convert("RGB")
        ndarray = np.array(image)

        # Create video frame
        pts, time_base = await self.next_timestamp()
        video_frame = VideoFrame.from_ndarray(ndarray, format="rgb24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        
        # Store for fallback
        self._last_frame = video_frame
        return video_frame


class HeadlessWebRTCSession:
    """
    Wraps a RTCPeerConnection that streams CDP frames and accepts control commands.
    """

    def __init__(self, cdp_client: CDPClient) -> None:
        self.cdp_client = cdp_client
        
        # Create RTCPeerConnection
        self.pc = RTCPeerConnection()
        
        # 🔥 新增：检查是否启用低延迟模式
        use_low_latency = os.getenv('WEBRTC_LOW_LATENCY', 'false').lower() == 'true'
        
        # Create video track (with low latency option)
        self.video_track = CDPVideoTrack(cdp_client, low_latency=use_low_latency)
        
        # Add track and get sender for configuration
        sender = self.pc.addTrack(self.video_track)
        
        # Configure encoding parameters for high quality
        # Note: aiortc will use these as hints for the encoder
        if hasattr(sender, '_track'):
            LOGGER.info("Configuring VP8 encoder for screen sharing with high bitrate")

        @self.pc.on("datachannel")
        def on_datachannel(channel):
            LOGGER.info("DataChannel opened: %s", channel.label)
            @channel.on("message")
            async def on_message(message):
                try:
                    # 🔥 新增：支持二进制事件协议（WebRTC DataChannel）
                    if isinstance(message, bytes):
                        # 解析二进制事件
                        # 使用StreamServer的解析器（复用代码）
                        import struct
                        event = self._parse_binary_event_webrtc(message)
                        if event:
                            await self.cdp_client.dispatch_control_event(event)
                        return
                    
                    # JSON协议（现有逻辑）
                    payload = json.loads(message)
                    await self.cdp_client.dispatch_control_event(payload)
                except json.JSONDecodeError:
                    LOGGER.warning("Invalid JSON on data channel: %s", message)
                except Exception as e:
                    LOGGER.error("Error dispatching control event: %s", e)

    async def process_offer(self, offer: dict) -> RTCSessionDescription:
        LOGGER.info("Processing WebRTC Offer")
        await self.pc.setRemoteDescription(
            RTCSessionDescription(sdp=offer["sdp"], type=offer["type"])
        )
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        LOGGER.info("Created WebRTC Answer")
        return self.pc.localDescription

    async def close(self) -> None:
        await self.pc.close()


class HeadlessBridge:
    """
    Coordinates the Chrome process, CDP connection and WebRTC sessions.
    """

    def __init__(
        self,
        chrome_executable: Optional[str] = None,
        remote_debugging_port: int = 9222,
        remote_debugging_address: str = "0.0.0.0",
        initial_url: Optional[str] = None,
        encoding_mode: str = "mjpeg",  # 🎬 新增：编码模式 ("mjpeg" or "h264")
    ) -> None:
        self.chrome = ChromeManager(
            executable_path=chrome_executable,
            remote_debugging_port=remote_debugging_port,
            remote_debugging_address=remote_debugging_address,
            headless=True,  # 恢复headless模式
        )
        self.cdp_client: Optional[CDPClient] = None
        self.active_session: Optional[HeadlessWebRTCSession] = None
        self._lock = asyncio.Lock()
        self.initial_url = initial_url
        self._bootstrapped = False
        self._pending_mjpeg_server = None  # Store MJPEG server for later assignment
        self._recorder_handler = None  # V5: 录制处理器引用（由server.py设置）
        self.encoding_mode = encoding_mode  # 🎬 编码模式
        # Best-effort URL fallback for controller status reads.
        self._last_known_url: str = initial_url or "about:blank"
        
        # 🚀 Scrcpy优化模块（独立实现，不影响其他模式）
        self.scrcpy_capture: Optional[ScrcpyCaptureEngine] = None
        self.scrcpy_encoder: Optional[ScrcpyH264Encoder] = None
        self.scrcpy_event_handler: Optional[ScrcpyEventHandler] = None
        self.width = 1920  # 默认分辨率
        self.height = 1080
        
        # 🔥 新增：事件批处理器（用于MJPEG/WebRTC优化）
        self.event_batch_processor: Optional['EventBatchProcessor'] = None
        self.use_event_batching = os.getenv('USE_EVENT_BATCHING', 'true').lower() == 'true'

    async def ensure_ready(self) -> None:
        # 🔥 修复：简化逻辑，避免频繁重启Chrome
        # 只在cdp_client不存在时才需要重新连接
        if not self.cdp_client:
            # CDP连接丢失，检查Chrome是否需要重启
            if not self.chrome.is_running:
                LOGGER.warning("🔄 Chrome未运行，正在启动...")
                self.chrome.start()
            
            ws_url = self.chrome.get_websocket_debugger_url()
            self.cdp_client = CDPClient(ws_url, stream_mode=self.encoding_mode)  # 🎬 传递编码模式
            await self.cdp_client.connect()
            LOGGER.info("✅ CDP已重新连接")
            
            # 🔥 新增：初始化事件批处理器
            if self.use_event_batching and not self.event_batch_processor:
                from .event_batch_processor import EventBatchProcessor
                self.event_batch_processor = EventBatchProcessor(
                    self.cdp_client,
                    batch_size=10,
                    batch_interval=0.01  # 10ms
                )
                await self.event_batch_processor.start()
                LOGGER.info("✅ 事件批处理器已启动")
            
            # Set MJPEG server if it was pending
            if self._pending_mjpeg_server:
                self.cdp_client.set_mjpeg_server(self._pending_mjpeg_server)
            if self.initial_url and not self._bootstrapped:
                LOGGER.info(f"🌐 导航到初始URL: {self.initial_url}")
                await self.cdp_client.navigate(self.initial_url)
                self._bootstrapped = True

    async def process_offer(self, offer: dict) -> RTCSessionDescription:
        async with self._lock:
            await self.ensure_ready()
            if self.active_session:
                await self.active_session.close()
            self.active_session = HeadlessWebRTCSession(self.cdp_client)
            return await self.active_session.process_offer(offer)

    async def navigate(self, url: str) -> None:
        # Track intent immediately so status can stay deterministic even if CDP is restarting.
        self._last_known_url = url
        await self.ensure_ready()
        assert self.cdp_client
        await self.cdp_client.navigate(url)
        self._bootstrapped = True

    async def reload(self) -> None:
        await self.ensure_ready()
        assert self.cdp_client
        await self.cdp_client.reload()

    async def history_back(self) -> str:
        return await self._history_step(-1)

    async def history_forward(self) -> str:
        return await self._history_step(1)

    async def _history_step(self, direction: int) -> str:
        await self.ensure_ready()
        assert self.cdp_client
        url = await self.cdp_client.history_step(direction)
        if url and url != "about:blank":
            self._last_known_url = url
        return url

    async def shutdown(self) -> None:
        """完全关闭并清理所有资源（幂等，可安全重复调用）"""
        if getattr(self, '_shutting_down', False):
            LOGGER.info("🛑 shutdown 已在执行中，跳过重复调用")
            return
        self._shutting_down = True
        LOGGER.info("🛑 开始关闭所有资源...")
        
        # 先停止Scrcpy模式（如果在运行）
        if self.encoding_mode == 'scrcpy':
            await self._stop_scrcpy_mode()
        
        # 🔥 新增：停止批处理器
        if self.event_batch_processor:
            await self.event_batch_processor.stop()
            self.event_batch_processor = None
            LOGGER.info("✅ 事件批处理器已停止")
        
        # 关闭WebRTC session
        if self.active_session:
            try:
                await self.active_session.close()
            except Exception as e:
                LOGGER.warning(f"⚠️  关闭WebRTC session失败: {e}")
            self.active_session = None
        
        # 关闭CDP连接
        if self.cdp_client:
            try:
                await self.cdp_client.close()
            except Exception as e:
                LOGGER.warning(f"⚠️  关闭CDP连接失败: {e}")
            self.cdp_client = None
        
        # 🔥 关键：停止Chrome（包括所有子进程）
        self.chrome.stop()
        
        # 重置状态标志
        self._bootstrapped = False
        
        # 🔥 新增：清理user_data_dir中的session数据
        import shutil
        try:
            # 只清理session相关的文件，保留扩展等配置
            session_dirs = [
                os.path.join(self.chrome.user_data_dir, 'Default', 'Sessions'),
                os.path.join(self.chrome.user_data_dir, 'Default', 'Session Storage'),
            ]
            for session_dir in session_dirs:
                if os.path.exists(session_dir):
                    shutil.rmtree(session_dir, ignore_errors=True)
                    LOGGER.info(f"🧹 清理了session目录: {session_dir}")
        except Exception as e:
            LOGGER.warning(f"⚠️  清理session数据失败: {e}")
        
        self._shutting_down = False
        LOGGER.info("✅ 所有资源已释放")

    async def reset(self) -> None:
        """重置并清理所有资源（释放实例）"""
        await self.shutdown()

    async def get_status(self) -> dict:
        try:
            await self.ensure_ready()
            assert self.cdp_client
            url = await self.cdp_client.get_current_url()
            if url and url != "about:blank":
                self._last_known_url = url
            return {
                "currentUrl": url or self._last_known_url,
                "remoteDebuggingPort": self.chrome.remote_debugging_port,
                "chromeRunning": self.chrome.is_running,
                "sessionActive": self.active_session is not None,
                "defaultUrl": self.initial_url,
                "viewportWidth": self.cdp_client.viewport_width,
                "viewportHeight": self.cdp_client.viewport_height,
            }
        except Exception as e:
            # Never fail status reads: the controller UI relies on refreshStatus() for deterministic flows.
            LOGGER.warning("Failed to get status (fallback): %s", e)
            return {
                "currentUrl": self._last_known_url,
                "remoteDebuggingPort": self.chrome.remote_debugging_port,
                "chromeRunning": self.chrome.is_running,
                "sessionActive": self.active_session is not None,
                "defaultUrl": self.initial_url,
                "viewportWidth": self.width,
                "viewportHeight": self.height,
            }

    async def set_fps(self, fps: int) -> None:
        await self.ensure_ready()
        assert self.cdp_client
        self.cdp_client.set_fps(fps)

    async def set_quality(self, quality: int) -> None:
        await self.ensure_ready()
        assert self.cdp_client
        self.cdp_client.set_quality(quality)
    
    async def set_resolution(self, width: int, height: int) -> None:
        """Change viewport resolution"""
        await self.ensure_ready()
        assert self.cdp_client
        
        # 更新内部分辨率
        self.width = width
        self.height = height
        
        await self.cdp_client.set_resolution(width, height)
        
        # 如果Scrcpy模式正在运行，需要重启以应用新分辨率
        if self.encoding_mode == 'scrcpy' and self.scrcpy_capture:
            LOGGER.info("🔄 Scrcpy模式：重启以应用新分辨率")
            await self._stop_scrcpy_mode()
            await self._start_scrcpy_mode()
    
    async def set_format(self, format_type: str) -> None:
        await self.ensure_ready()
        assert self.cdp_client
        self.cdp_client.set_format(format_type)

    async def list_tabs(self) -> list:
        await self.ensure_ready()
        assert self.cdp_client
        return await self.cdp_client.list_tabs()

    async def switch_tab(self, target_id: str) -> bool:
        await self.ensure_ready()
        assert self.cdp_client
        return await self.cdp_client.switch_tab(target_id)

    async def close_tab(self, target_id: str) -> bool:
        await self.ensure_ready()
        assert self.cdp_client
        return await self.cdp_client.close_tab(target_id)

    async def create_tab(self, url: str) -> Optional[str]:
        await self.ensure_ready()
        assert self.cdp_client
        return await self.cdp_client.create_tab(url)
    
    async def execute_script(self, script: str):
        """Execute JavaScript in the active tab"""
        await self.ensure_ready()
        assert self.cdp_client
        return await self.cdp_client.execute_script(script)

    async def get_capture_mode(self) -> dict:
        """Get current capture mode information"""
        await self.ensure_ready()
        assert self.cdp_client
        return self.cdp_client.get_capture_mode_info()
    
    def set_mjpeg_server(self, mjpeg_server):
        """Set MJPEG server for direct JPEG streaming and control"""
        if self.cdp_client:
            self.cdp_client.set_mjpeg_server(mjpeg_server)
        # Store for later use when cdp_client is created
        self._pending_mjpeg_server = mjpeg_server
        # 🔥 改进3: 设置控制命令回调（通过WebSocket接收）
        mjpeg_server.set_control_callback(self._handle_mjpeg_control_ws)
    
    async def switch_stream_mode(self, new_mode: str):
        """
        动态切换流模式
        
        支持三种模式：
        - 'mjpeg': MJPEG直传模式（兼容旧版）
        - 'h264': H.264模式（使用CDP截图+FFmpeg编码）
        - 'scrcpy': Scrcpy优化模式（Screencast推送+低延迟H.264+二进制事件）
        """
        await self.ensure_ready()
        
        old_mode = self.encoding_mode
        
        if old_mode == new_mode:
            LOGGER.info(f"已经是{new_mode}模式，无需切换")
            return
        
        LOGGER.info(f"🔄 切换模式: {old_mode} → {new_mode}")
        
        # 🔥 修复：停止旧模式（所有情况统一处理）
        if old_mode == 'scrcpy':
            await self._stop_scrcpy_mode()
        # 对于mjpeg/h264，不需要特殊停止，CDP客户端会在switch_stream_mode中处理
        
        # 🔥 修复：启动新模式
        if new_mode == 'scrcpy':
            await self._start_scrcpy_mode()
        elif self.cdp_client:
            # 对于mjpeg/h264，通知CDP客户端切换（CDP会重启截图循环）
            await self.cdp_client.switch_stream_mode(new_mode)
        
        self.encoding_mode = new_mode
        LOGGER.info(f"✅ 模式切换完成: {new_mode}")
    
    async def _handle_mjpeg_control_ws(self, event: dict):
        """处理MJPEG WebSocket传来的控制命令"""
        event_type = event.get('type')
        
        # 录制处理：在 dispatch 之前查询元素信息（此时页面还未因点击导航，数据准确）
        if self._recorder_handler and hasattr(self._recorder_handler, 'state'):
            if event_type in ['click', 'dblclick', 'keydown'] and \
               self._recorder_handler.state.value == 'recording':
                import time
                x = event.get('x', 0)
                y = event.get('y', 0)
                
                recorder_event = {
                    'type': event_type,
                    'timestamp': int(time.time() * 1000),
                    'target': {
                        'tagName': 'UNKNOWN',
                        'id': '',
                        'className': '',
                        'textContent': '',
                    },
                    'clientX': x,
                    'clientY': y,
                    'offsetX': x,
                    'offsetY': y,
                    'pageX': x,
                    'pageY': y,
                    'button': 0,
                    'is_remote_control': True,
                }
                
                if event_type == 'keydown':
                    recorder_event.update({
                        'key': event.get('key', ''),
                        'code': event.get('code', ''),
                        'ctrlKey': event.get('ctrlKey', False),
                        'metaKey': event.get('metaKey', False),
                        'altKey': event.get('altKey', False),
                        'shiftKey': event.get('shiftKey', False),
                    })
                
                # 点击/双击：查询 XPath + boundingBox（在 dispatch 之前，数据准确）
                # 使用 3 秒短超时，避免页面导航时 CDP 查询阻塞录制
                if event_type in ['click', 'dblclick'] and self.cdp_client:
                    if not self.cdp_client._active_session_id:
                        LOGGER.warning("⚠️ [录制] CDP 无活动 session，跳过元素查询")
                    else:
                        try:
                            element_info = await asyncio.wait_for(
                                self.cdp_client.get_element_info_at_coordinates(x, y),
                                timeout=3.0
                            )
                            if element_info and element_info.get('success'):
                                recorder_event['xpath'] = element_info.get('value', '')
                                recorder_event['locationType'] = element_info.get('locationType', 'xpath')
                                recorder_event['xpathIndex'] = element_info.get('index', 0)
                                recorder_event['iframes'] = element_info.get('iframes', [])
                                recorder_event['target'] = {
                                    'tagName': element_info.get('tagName', 'UNKNOWN'),
                                    'id': '',
                                    'className': '',
                                    'textContent': element_info.get('text', ''),
                                }
                        except asyncio.TimeoutError:
                            LOGGER.warning(f"⚠️ [录制] 查询元素XPath超时(3s)，跳过")
                        except Exception as e:
                            LOGGER.warning(f"⚠️ [录制] 查询元素XPath异常: {e}")
                        
                        try:
                            bb_js = f"""(function() {{
                                var el = document.elementFromPoint({x}, {y});
                                if (!el) return null;
                                var rect = el.getBoundingClientRect();
                                // 提取文本：优先 textContent，其次 alt/title/aria-label/placeholder，最后向上找父级文本
                                var text = (el.textContent || el.innerText || '').trim();
                                if (!text || text.length === 0) {{
                                    text = el.getAttribute('alt') || el.getAttribute('title') || 
                                           el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
                                }}
                                if ((!text || text.length === 0) && el.parentElement) {{
                                    // 对 img/svg 等无文本元素，尝试从父级或相邻兄弟获取
                                    var parent = el.parentElement;
                                    var pText = (parent.textContent || '').trim();
                                    if (pText && pText.length > 0 && pText.length < 200) {{
                                        text = pText;
                                    }} else {{
                                        text = parent.getAttribute('alt') || parent.getAttribute('title') || 
                                               parent.getAttribute('aria-label') || '';
                                    }}
                                }}
                                text = (text || '').substring(0, 200);
                                return {{
                                    tagName: el.tagName || '',
                                    textContent: text,
                                    id: el.id || '',
                                    className: (typeof el.className === 'string') ? el.className : '',
                                    alt: el.getAttribute('alt') || '',
                                    title: el.getAttribute('title') || '',
                                    src: (el.tagName === 'IMG') ? (el.src || '').substring(0, 300) : '',
                                    boundingBox: {{
                                        x: Math.round(rect.x * 10) / 10,
                                        y: Math.round(rect.y * 10) / 10,
                                        width: Math.round(rect.width * 10) / 10,
                                        height: Math.round(rect.height * 10) / 10
                                    }},
                                    viewportWidth: window.innerWidth,
                                    viewportHeight: window.innerHeight
                                }};
                            }})()"""
                            result = await asyncio.wait_for(
                                self.cdp_client.send_message_to_target(
                                    self.cdp_client._active_session_id,
                                    "Runtime.evaluate",
                                    {"expression": bb_js, "returnByValue": True}
                                ),
                                timeout=3.0
                            )
                            value = result.get("result", {}).get("value")
                            if value and isinstance(value, dict):
                                bb = value.get("boundingBox")
                                if bb and bb.get("width", 0) > 0:
                                    recorder_event['target']['boundingBox'] = bb
                                    recorder_event['target']['viewportWidth'] = value.get('viewportWidth', 0)
                                    recorder_event['target']['viewportHeight'] = value.get('viewportHeight', 0)
                                if value.get('textContent'):
                                    recorder_event['target']['textContent'] = value['textContent']
                                if value.get('tagName'):
                                    recorder_event['target']['tagName'] = value['tagName']
                                if value.get('id'):
                                    recorder_event['target']['id'] = value['id']
                                if value.get('className'):
                                    recorder_event['target']['className'] = value['className']
                                if value.get('alt'):
                                    recorder_event['target']['alt'] = value['alt']
                                if value.get('src'):
                                    recorder_event['target']['src'] = value['src']
                                text_preview = (value.get('textContent', '') or '')[:30]
                                LOGGER.info(
                                    f"🔍 [录制] 元素: tag={value.get('tagName')}, text='{text_preview}', "
                                    f"bb={bb}, vp={value.get('viewportWidth')}x{value.get('viewportHeight')}"
                                )
                        except asyncio.TimeoutError:
                            LOGGER.warning(f"⚠️ [录制] 查询boundingBox超时(3s)，跳过")
                        except Exception as e:
                            LOGGER.warning(f"⚠️ [录制] 查询boundingBox异常: {e}")
                
                # 附加当前 MJPEG 帧快照（dispatch 前，确保帧与 boundingBox 对应）
                if event_type in ['click', 'dblclick'] and self.cdp_client and self.cdp_client._latest_frame_jpeg:
                    import base64
                    recorder_event['_frame_base64'] = base64.b64encode(
                        self.cdp_client._latest_frame_jpeg
                    ).decode('ascii')
                
                await self._recorder_handler.handle_event(recorder_event)
        
        await self.dispatch_control_event(event)
    
    async def dispatch_control_event(self, event: dict) -> None:
        """
        🔥 增强：分发控制事件（支持批处理优化）
        
        优化策略：
        - 如果启用批处理：事件加入批处理队列（10ms窗口批量发送）
        - 如果未启用：直接发送到CDP（传统方式）
        """
        await self.ensure_ready()
        assert self.cdp_client
        
        # 🔥 使用批处理器（如果已启用）
        if self.event_batch_processor:
            await self.event_batch_processor.add_event(event)
        else:
            # 传统方式：直接发送
            await self.cdp_client.dispatch_control_event(event)
    
    def has_active_peer(self) -> bool:
        """Check if there's an active WebRTC peer connection"""
        return self.active_session is not None and self.active_session.pc.connectionState in ["connected", "connecting"]
    
    async def check_element_exists(self, selector: str) -> bool:
        """V5: 检查元素是否存在"""
        await self.ensure_ready()
        if not self.cdp_client:
            return False
        
        try:
            # 转义单引号
            safe_selector = selector.replace("'", "\\'")
            js_code = f"""
                (() => {{
                    try {{
                        const elements = document.querySelectorAll('{safe_selector}');
                        return elements.length > 0;
                    }} catch(e) {{
                        console.error('Selector error:', e);
                        return false;
                    }}
                }})()
            """
            
            result = await self.cdp_client.send_message(
                "Runtime.evaluate",
                {
                    "expression": js_code,
                    "returnByValue": True
                }
            )
            
            exists = result.get('result', {}).get('value', False)
            return exists
            
        except Exception as e:
            LOGGER.error(f"检查元素失败 {selector}: {e}")
            return False
    
    async def get_element_position(self, selector: str) -> Optional[Dict]:
        """V5: 获取元素的当前位置"""
        await self.ensure_ready()
        if not self.cdp_client:
            return None
        
        try:
            safe_selector = selector.replace("'", "\\'")
            js_code = f"""
                (() => {{
                    try {{
                        const element = document.querySelector('{safe_selector}');
                        if (!element) return null;
                        
                        const rect = element.getBoundingClientRect();
                        return {{
                            x: Math.round(rect.left + rect.width / 2),
                            y: Math.round(rect.top + rect.height / 2),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                            left: Math.round(rect.left),
                            top: Math.round(rect.top)
                        }};
                    }} catch(e) {{
                        return null;
                    }}
                }})()
            """
            
            result = await self.cdp_client.send_message(
                "Runtime.evaluate",
                {
                    "expression": js_code,
                    "returnByValue": True
                }
            )
            
            position = result.get('result', {}).get('value')
            return position
            
        except Exception as e:
            LOGGER.error(f"获取元素位置失败 {selector}: {e}")
            return None
    
    async def _start_scrcpy_mode(self):
        """
        启动Scrcpy优化模式
        
        包含：
        1. ScrcpyCaptureEngine - Screencast推送捕获
        2. ScrcpyH264Encoder - 低延迟H.264编码
        3. ScrcpyEventHandler - 二进制事件处理
        """
        await self.ensure_ready()
        
        if not self.cdp_client:
            LOGGER.error("❌ CDP客户端未初始化，无法启动Scrcpy模式")
            return
        
        if not self._pending_mjpeg_server:
            LOGGER.error("❌ StreamServer未设置，无法启动Scrcpy模式")
            return
        
        try:
            LOGGER.info("🚀 启动Scrcpy优化模式...")
            
            # 1. 创建捕获引擎（PNG格式，避免JPEG二次压缩）
            self.scrcpy_capture = ScrcpyCaptureEngine(
                self.cdp_client,
                encoding_format='png'
            )
            
            # 2. 创建编码器
            self.scrcpy_encoder = ScrcpyH264Encoder(
                width=self.width,
                height=self.height,
                fps=60,
                bitrate=8000000  # 8Mbps
            )
            
            # 启动编码器
            def on_nal_frame(nal_data: bytes, is_keyframe: bool):
                """编码器NAL回调（同步，在编码线程）"""
                # 将NAL数据发送到StreamServer
                if self._pending_mjpeg_server:
                    # 使用asyncio.run_coroutine_threadsafe从同步回调调用异步方法
                    import asyncio
                    loop = asyncio.get_event_loop()
                    asyncio.run_coroutine_threadsafe(
                        self._pending_mjpeg_server.broadcast_h264_frame(
                            nal_data,
                            0,  # pts（暂时简化）
                            is_keyframe
                        ),
                        loop
                    )
            
            self.scrcpy_encoder.start(on_nal_frame)
            
            # 3. 创建事件处理器
            self.scrcpy_event_handler = ScrcpyEventHandler(self.cdp_client)
            await self.scrcpy_event_handler.start()
            
            # 4. 启动捕获
            async def on_frame(frame_data: bytes, metadata: dict):
                """Screencast帧回调"""
                # 发送到编码器
                if self.scrcpy_encoder:
                    self.scrcpy_encoder.encode_frame(frame_data)
            
            await self.scrcpy_capture.start(
                width=self.width,
                height=self.height,
                quality=100,  # PNG忽略此参数
                max_fps=60,
                frame_callback=on_frame
            )
            
            LOGGER.info("✅ Scrcpy优化模式已启动")
            
        except Exception as e:
            LOGGER.error(f"❌ 启动Scrcpy模式失败: {e}", exc_info=True)
            await self._stop_scrcpy_mode()
            raise
    
    async def _stop_scrcpy_mode(self):
        """停止Scrcpy优化模式"""
        LOGGER.info("🛑 停止Scrcpy优化模式...")
        
        # 停止捕获
        if self.scrcpy_capture:
            try:
                await self.scrcpy_capture.stop()
            except Exception as e:
                LOGGER.error(f"停止捕获失败: {e}")
            self.scrcpy_capture = None
        
        # 停止编码器
        if self.scrcpy_encoder:
            try:
                self.scrcpy_encoder.stop()
            except Exception as e:
                LOGGER.error(f"停止编码器失败: {e}")
            self.scrcpy_encoder = None
        
        # 停止事件处理器
        if self.scrcpy_event_handler:
            try:
                await self.scrcpy_event_handler.stop()
            except Exception as e:
                LOGGER.error(f"停止事件处理器失败: {e}")
            self.scrcpy_event_handler = None
        
        LOGGER.info("✅ Scrcpy优化模式已停止")
