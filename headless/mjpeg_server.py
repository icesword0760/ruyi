"""
MJPEG WebSocket Server - 绕过WebRTC直接传输原始JPEG帧

提供一个独立的WebSocket端点，将CDP截图的原始JPEG字节流直接发送给客户端，
避免WebRTC的二次编码导致的质量损失。

同时支持通过同一WebSocket连接接收控制命令，降低控制延迟。
"""

import asyncio
import json
import logging
import struct
from typing import Optional, Set

import websockets
from websockets.server import WebSocketServerProtocol

LOGGER = logging.getLogger(__name__)


class MJPEGServer:
    """
    MJPEG over WebSocket server
    
    直接发送原始JPEG帧，不经过WebRTC编码，保证画质与原始截图一致。
    """
    
    def __init__(self, port: int = 5567, host: str = "0.0.0.0"):
        self.port = port
        self.host = host
        self._server: Optional[websockets.WebSocketServer] = None
        self._clients: Set[WebSocketServerProtocol] = set()
        self._frame_queue: Optional[asyncio.Queue] = None  # 延迟创建，避免事件循环问题
        self._running = False
        self._broadcast_task: Optional[asyncio.Task] = None
        self._control_callback = None  # 用于处理控制命令的回调函数
        self._recorder_callback = None  # 🎬 用于处理录制事件的回调函数
        self._element_query_callback = None  # V5: 用于处理元素查询的回调函数
        
        # 🔥 改进2: 带宽和性能统计（借鉴货拉拉）
        self._stats = {
            'frames_sent': 0,
            'bytes_sent': 0,
            'start_time': 0,
            'control_events': 0
        }
        
    async def start(self):
        """启动MJPEG WebSocket服务器"""
        if self._running:
            return
            
        self._running = True
        
        # 在当前事件循环中创建队列，避免事件循环冲突
        self._frame_queue = asyncio.Queue(maxsize=2)
        
        self._server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port,
            ping_interval=20,
            ping_timeout=10,
            max_size=10 * 1024 * 1024,  # 10MB max message size
        )
        
        # 启动广播任务
        self._broadcast_task = asyncio.create_task(self._broadcast_frames())
        
        # 初始化统计时间（使用time.time()而不是asyncio）
        import time
        self._stats['start_time'] = time.time()
        
        LOGGER.info(f"🎬 MJPEG WebSocket服务器启动: ws://{self.host}:{self.port}")
        
    async def stop(self):
        """停止MJPEG WebSocket服务器"""
        if not self._running:
            return
            
        self._running = False
        
        # 取消广播任务
        if self._broadcast_task:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass
        
        # 关闭所有客户端连接
        if self._clients:
            await asyncio.gather(
                *[client.close() for client in self._clients],
                return_exceptions=True
            )
            self._clients.clear()
        
        # 关闭服务器
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            
        LOGGER.info("🎬 MJPEG WebSocket服务器已停止")
        
    async def _handle_client(self, websocket: WebSocketServerProtocol):
        """处理新的WebSocket客户端连接"""
        client_id = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        LOGGER.info(f"📱 MJPEG客户端连接: {client_id}")
        
        self._clients.add(websocket)
        
        try:
            import time
            # 保持连接并处理客户端发送的控制消息
            async for message in websocket:
                # 处理JSON消息（控制命令或录制事件）
                if isinstance(message, str):
                    try:
                        data = json.loads(message)
                        
                        # 🎬 处理录制事件（新增）
                        if data.get('channel') == 'recorder':
                            # 录制事件通道
                            if self._recorder_callback:
                                event_data = data.get('data', {})
                                await self._recorder_callback(event_data)
                                event_type = event_data.get('type', 'unknown')
                                if event_type not in ['click', 'scroll']:  # 减少日志噪音
                                    LOGGER.debug(f"🎬 [录制事件] {event_type}")
                        
                        # V5: 处理元素查询请求
                        elif data.get('type') == 'check_element':
                            if self._element_query_callback:
                                result = await self._element_query_callback(
                                    'check_element',
                                    data.get('selector'),
                                    data.get('requestId')
                                )
                                await websocket.send(json.dumps(result))
                        
                        elif data.get('type') == 'get_element_position':
                            if self._element_query_callback:
                                result = await self._element_query_callback(
                                    'get_position',
                                    data.get('selector'),
                                    data.get('requestId')
                                )
                                await websocket.send(json.dumps(result))
                        
                        # 🔥 处理控制命令（原有）
                        elif data.get('type') == 'control' and data.get('event'):
                            # 🔥 丢弃过旧的事件（超过500ms）防止积压延迟
                            event_timestamp = data.get('timestamp', 0)
                            if event_timestamp > 0:
                                age_ms = (time.time() * 1000) - event_timestamp
                                if age_ms > 500:
                                    LOGGER.warning(f"⏱️ 丢弃过旧的控制事件 (延迟 {age_ms:.0f}ms): {data['event'].get('type')}")
                                    continue
                            
                            # 控制事件
                            if self._control_callback:
                                await self._control_callback(data['event'])
                                self._stats['control_events'] += 1
                                if data['event'].get('type') not in ['mousemove']:
                                    LOGGER.info(f"🖱️ [WS控制] {data['event'].get('type')}: ({data['event'].get('x')}, {data['event'].get('y')})")
                    except json.JSONDecodeError:
                        LOGGER.warning(f"无效的JSON消息: {message[:100]}")
                    except Exception as e:
                        LOGGER.error(f"处理消息失败: {e}")
        except websockets.exceptions.ConnectionClosed:
            LOGGER.info(f"📱 MJPEG客户端断开: {client_id}")
        except Exception as e:
            LOGGER.error(f"📱 MJPEG客户端错误: {client_id} - {e}")
        finally:
            self._clients.discard(websocket)
            
    async def push_frame(self, jpeg_bytes: bytes, metadata: dict = None):
        """
        推送一帧JPEG图像到队列
        
        Args:
            jpeg_bytes: JPEG图像字节流
            metadata: 可选的元数据（宽度、高度、时间戳等）
        """
        if not self._running or self._frame_queue is None:
            return
            
        # 清空旧帧，只保留最新帧
        while not self._frame_queue.empty():
            try:
                self._frame_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        try:
            await self._frame_queue.put((jpeg_bytes, metadata or {}))
        except asyncio.QueueFull:
            # 队列满了，丢弃当前帧
            pass
    
    async def _broadcast_frames(self):
        """广播帧到所有连接的客户端"""
        LOGGER.info("🎬 MJPEG广播任务启动")
        frame_count = 0
        
        while self._running:
            try:
                # 等待新帧
                jpeg_bytes, metadata = await asyncio.wait_for(
                    self._frame_queue.get(),
                    timeout=1.0
                )
                
                if not self._clients:
                    # 没有客户端连接，跳过
                    continue
                
                frame_count += 1
                
                # 准备消息：4字节长度 + JPEG数据
                # 这样客户端可以知道帧的大小
                message = struct.pack('!I', len(jpeg_bytes)) + jpeg_bytes
                
                # 广播到所有客户端
                if self._clients:
                    # 使用gather并忽略异常，避免单个客户端失败影响其他客户端
                    await asyncio.gather(
                        *[self._send_to_client(client, message) for client in list(self._clients)],
                        return_exceptions=True
                    )
                    
                    # 🔥 改进2: 记录统计数据
                    self._stats['frames_sent'] += 1
                    self._stats['bytes_sent'] += len(message)
                
                # 🔥 精简日志：每300帧（约10秒）记录一次
                if frame_count % 300 == 0:
                    stats = self.get_stats()
                    LOGGER.info(f"🎬 MJPEG已广播 {frame_count} 帧，带宽: {stats['bandwidth_mbps']:.1f}Mbps，客户端: {len(self._clients)}")
                    
            except asyncio.TimeoutError:
                # 1秒内没有新帧，继续等待
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                LOGGER.error(f"🎬 MJPEG广播错误: {e}", exc_info=True)
                await asyncio.sleep(0.1)
        
        LOGGER.info("🎬 MJPEG广播任务结束")
    
    async def _send_to_client(self, client: WebSocketServerProtocol, message: bytes):
        """发送消息到单个客户端"""
        try:
            await client.send(message)
        except websockets.exceptions.ConnectionClosed:
            # 客户端已断开，从列表中移除
            self._clients.discard(client)
        except Exception as e:
            LOGGER.warning(f"发送到客户端失败: {e}")
            self._clients.discard(client)
    
    @property
    def client_count(self) -> int:
        """返回当前连接的客户端数量"""
        return len(self._clients)
    
    def broadcast_control_message(self, message: dict):
        """
        向所有连接的客户端广播控制消息
        用于推送录制事件等实时更新
        """
        LOGGER.info(f"📡 [MJPEG] broadcast_control_message被调用: type={message.get('type')}, clients={len(self._clients)}")
        
        if not self._clients:
            LOGGER.warning(f"⚠️ [MJPEG] 没有连接的客户端，消息未发送")
            return
        
        LOGGER.info(f"📤 [MJPEG] 创建异步任务广播消息...")
        # 创建异步任务广播消息
        asyncio.create_task(self._do_broadcast_message(message))
        LOGGER.info(f"✅ [MJPEG] 异步任务已创建")
    
    async def _do_broadcast_message(self, message: dict):
        """实际执行消息广播"""
        LOGGER.info(f"📨 [MJPEG] _do_broadcast_message开始执行")
        message_json = json.dumps(message)
        LOGGER.info(f"📋 [MJPEG] 消息JSON: {message_json[:200]}")
        
        disconnected = set()
        
        for idx, client in enumerate(self._clients):
            try:
                LOGGER.info(f"📤 [MJPEG] 向客户端 #{idx+1} 发送消息...")
                await client.send(message_json)
                LOGGER.info(f"✅ [MJPEG] 客户端 #{idx+1} 发送成功")
            except Exception as e:
                LOGGER.warning(f"⚠️ [MJPEG] 客户端 #{idx+1} 广播消息失败: {e}")
                disconnected.add(client)
        
        # 移除断开的客户端
        self._clients -= disconnected
        LOGGER.info(f"✅ [MJPEG] _do_broadcast_message执行完成，发送了 {len(self._clients)} 个客户端")
    
    @property
    def is_running(self) -> bool:
        """返回服务器是否正在运行"""
        return self._running
    
    def get_stats(self) -> dict:
        """获取性能统计数据"""
        import time
        if self._stats['start_time'] == 0:
            return {
                'frames_sent': 0,
                'bytes_sent': 0,
                'bandwidth_mbps': 0,
                'avg_frame_size_kb': 0,
                'uptime_seconds': 0,
                'control_events': 0
            }
        
        elapsed = time.time() - self._stats['start_time']
        if elapsed == 0:
            elapsed = 0.001
        
        return {
            'frames_sent': self._stats['frames_sent'],
            'bytes_sent': self._stats['bytes_sent'],
            'bandwidth_mbps': (self._stats['bytes_sent'] * 8) / (elapsed * 1e6),
            'avg_frame_size_kb': (self._stats['bytes_sent'] / self._stats['frames_sent'] / 1024) if self._stats['frames_sent'] > 0 else 0,
            'uptime_seconds': elapsed,
            'control_events': self._stats['control_events']
        }
    
    def set_control_callback(self, callback):
        """
        设置控制命令回调函数
        
        Args:
            callback: async function(message: str) -> None
        """
        self._control_callback = callback
    
    def set_recorder_callback(self, callback):
        """
        🎬 设置录制事件回调函数
        
        Args:
            callback: async function(event_data: dict) -> None
        """
        self._recorder_callback = callback
    
    def set_element_query_callback(self, callback):
        """
        V5: 设置元素查询回调函数
        
        Args:
            callback: async function(query_type: str, selector: str, request_id: int) -> dict
        """
        self._element_query_callback = callback
        LOGGER.info("✅ 录制事件回调已设置")

