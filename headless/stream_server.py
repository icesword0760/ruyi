"""
统一流媒体服务器
支持MJPEG和H.264双模式
"""
import asyncio
import json
import logging
import time
import struct
import os
from typing import Optional, Set, Callable
from enum import Enum

import websockets
from websockets.server import WebSocketServerProtocol

from .h264_stream_protocol import H264StreamProtocol, H264StreamStats

LOGGER = logging.getLogger(__name__)


class StreamMode(Enum):
    """流媒体模式"""
    MJPEG = "mjpeg"
    H264 = "h264"


class StreamServer:
    """
    统一流媒体服务器
    
    支持两种模式：
    1. MJPEG模式：直接发送JPEG帧（HTTP multipart）
    2. H.264模式：发送H.264编码流（二进制协议）
    
    通过WebSocket传输，支持动态模式切换。
    """
    
    def __init__(self, port: int = 5567, host: str = "0.0.0.0"):
        self.port = port
        self.host = host
        self._server: Optional[websockets.WebSocketServer] = None
        self._clients: Set[WebSocketServerProtocol] = set()
        self._client_modes: dict = {}  # 每个客户端的模式
        self._frame_queue: Optional[asyncio.Queue] = None
        self._running = False
        self._broadcast_task: Optional[asyncio.Task] = None
        
        # 回调函数
        self._control_callback = None
        self._recorder_callback = None
        self._element_query_callback = None
        self._mode_switch_callback = None
        self._all_clients_disconnected_callback = None
        self._cleanup_delay_task: Optional[asyncio.Task] = None
        
        # 统计
        self._stats = {
            'frames_sent': 0,
            'bytes_sent': 0,
            'start_time': 0,
            'control_events': 0,
            'h264_clients': 0,
            'mjpeg_clients': 0,
            'binary_events': 0  # 🔥 新增：二进制事件统计
        }
        
        # H.264统计
        self._h264_stats = H264StreamStats()
        
        # 🔥 新增：二进制协议配置
        self.use_binary_protocol = os.getenv('USE_BINARY_PROTOCOL', 'true').lower() == 'true'
        
        # 🔥 新增：事件类型映射（与前端保持一致）
        self.event_type_map = {
            0: 'mousemove',
            1: 'mousedown',
            2: 'mouseup',
            3: 'click',
            4: 'dblclick',
            5: 'wheel',
            6: 'keydown',
            7: 'keyup',
            8: 'keypress'
        }
        
        LOGGER.info(f"🎬 StreamServer初始化: {host}:{port}")
        if self.use_binary_protocol:
            LOGGER.info("✅ 二进制事件协议已启用")
    
    def set_control_callback(self, callback: Callable):
        """设置控制事件回调"""
        self._control_callback = callback
        LOGGER.info("✅ 控制事件回调已设置")
    
    def set_recorder_callback(self, callback: Callable):
        """设置录制事件回调"""
        self._recorder_callback = callback
        LOGGER.info("✅ 录制事件回调已设置")
    
    def set_element_query_callback(self, callback: Callable):
        """设置元素查询回调"""
        self._element_query_callback = callback
        LOGGER.info("✅ 元素查询回调已设置")
    
    def set_mode_switch_callback(self, callback: Callable):
        """设置模式切换回调"""
        self._mode_switch_callback = callback
        LOGGER.info("✅ 模式切换回调已设置")

    def set_all_clients_disconnected_callback(self, callback: Callable):
        """设置所有客户端断开后的回调（用于自动释放资源）"""
        self._all_clients_disconnected_callback = callback
        LOGGER.info("✅ 全部客户端断开回调已设置")
    
    async def start(self):
        """启动服务器"""
        if self._running:
            LOGGER.warning("服务器已在运行")
            return
        
        # 创建帧队列
        if self._frame_queue is None:
            self._frame_queue = asyncio.Queue(maxsize=10)
        
        # 启动WebSocket服务器
        self._server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port,
            max_size=10 * 1024 * 1024  # 10MB
        )
        
        self._running = True
        self._stats['start_time'] = time.time()
        
        # 启动广播任务
        self._broadcast_task = asyncio.create_task(self._broadcast_frames())
        
        LOGGER.info(f"🎬 StreamServer已启动: ws://{self.host}:{self.port}")
    
    async def _delayed_cleanup(self):
        """延迟后确认无新客户端连接，再触发资源释放回调"""
        try:
            await asyncio.sleep(10)
            if len(self._clients) == 0 and self._all_clients_disconnected_callback:
                LOGGER.info("🛑 10 秒内无新客户端连接，触发资源释放...")
                await self._all_clients_disconnected_callback()
        except asyncio.CancelledError:
            LOGGER.info("📱 资源释放已取消（有新客户端连接）")

    async def stop(self):
        """停止服务器"""
        if not self._running:
            return
        
        LOGGER.info("🛑 停止StreamServer...")
        
        self._running = False
        
        # 取消广播任务
        if self._broadcast_task:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass
        
        # 关闭所有客户端
        for client in list(self._clients):
            try:
                await client.close()
            except:
                pass
        self._clients.clear()
        
        # 关闭服务器
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        
        LOGGER.info("🛑 StreamServer已停止")
    
    async def _handle_client(self, websocket: WebSocketServerProtocol):
        """处理客户端连接"""
        client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        LOGGER.info(f"📱 客户端连接: {client_addr}")
        
        self._clients.add(websocket)
        # 默认使用MJPEG模式
        self._client_modes[websocket] = StreamMode.MJPEG
        self._stats['mjpeg_clients'] += 1

        if self._cleanup_delay_task and not self._cleanup_delay_task.done():
            LOGGER.info("📱 新客户端连接，取消资源释放定时器")
            self._cleanup_delay_task.cancel()
            self._cleanup_delay_task = None
        
        try:
            async for message in websocket:
                await self._handle_message(websocket, message)
        
        except websockets.exceptions.ConnectionClosedError:
            LOGGER.info(f"📱 客户端断开: {client_addr}")
        except Exception as e:
            LOGGER.error(f"❌ 处理客户端消息失败 {client_addr}: {e}")
        finally:
            self._clients.discard(websocket)
            mode = self._client_modes.pop(websocket, None)
            if mode == StreamMode.H264:
                self._stats['h264_clients'] -= 1
            else:
                self._stats['mjpeg_clients'] -= 1

            if len(self._clients) == 0 and self._all_clients_disconnected_callback:
                LOGGER.info("📭 所有投屏客户端已断开，启动延迟资源释放 (10s)...")
                if self._cleanup_delay_task and not self._cleanup_delay_task.done():
                    self._cleanup_delay_task.cancel()
                self._cleanup_delay_task = asyncio.ensure_future(
                    self._delayed_cleanup()
                )
    
    async def _handle_message(self, websocket: WebSocketServerProtocol, message):
        """处理客户端消息"""
        try:
            # 🚀 Scrcpy优化：支持二进制事件协议
            if isinstance(message, bytes):
                # 二进制消息 - Scrcpy事件协议
                await self._handle_binary_event(websocket, message)
                return
            
            # 解析JSON消息
            if isinstance(message, str):
                data = json.loads(message)
            else:
                return
            
            msg_type = data.get('type')
            
            # 模式切换消息
            if msg_type == 'switch_mode':
                mode_str = data.get('mode', 'mjpeg')
                await self._handle_mode_switch(websocket, mode_str)
            
            # 连接消息
            elif msg_type == 'connect':
                # 发送欢迎消息
                await websocket.send(json.dumps({
                    'type': 'connected',
                    'mode': self._client_modes[websocket].value,
                    'server_version': '2.0'
                }))
            
            # 控制消息
            elif msg_type == 'control':
                if self._control_callback:
                    event = data.get('event', {})
                    await self._control_callback(event)
                self._stats['control_events'] += 1
            
            # 录制消息（兼容 type='recorder' 和 channel='recorder' 两种格式）
            elif msg_type == 'recorder' or data.get('channel') == 'recorder':
                if self._recorder_callback:
                    # 提取内部 data 字段（前端发送格式: {channel:'recorder', data:{type:'recording_started',...}}）
                    recorder_data = data.get('data', data)
                    LOGGER.info(f"📝 [STREAM] 转发录制消息: {recorder_data.get('type', 'unknown')}")
                    await self._recorder_callback(recorder_data)
            
            # 元素查询
            elif msg_type == 'query_element':
                if self._element_query_callback:
                    result = await self._element_query_callback(data)
                    await websocket.send(json.dumps({
                        'type': 'element_info',
                        'request_id': data.get('request_id'),
                        'result': result
                    }))
        
        except json.JSONDecodeError as e:
            LOGGER.error(f"❌ JSON解析失败: {e}")
        except Exception as e:
            LOGGER.error(f"❌ 处理消息失败: {e}")
    
    async def _handle_binary_event(self, websocket: WebSocketServerProtocol, data: bytes):
        """
        🔥 增强：处理二进制事件（通用协议，支持MJPEG和Scrcpy模式）
        
        Args:
            websocket: 客户端连接
            data: 二进制事件数据
        """
        try:
            if not self.use_binary_protocol:
                LOGGER.warning("⚠️  二进制协议未启用，忽略二进制消息")
                return
            
            # 解析二进制事件为标准JSON格式
            event = self._parse_binary_event(data)
            
            if event:
                self._stats['binary_events'] += 1
                self._stats['control_events'] += 1
                
                # 🔥 记录详细信息（仅debug模式）
                if LOGGER.isEnabledFor(logging.DEBUG):
                    LOGGER.debug(f"📦 收到二进制事件: {event['type']} ({len(data)}字节)")
                
                # 调用控制回调
                if self._control_callback:
                    await self._control_callback(event)
            
        except Exception as e:
            LOGGER.error(f"❌ 二进制事件处理失败: {e}", exc_info=True)
    
    def _parse_binary_event(self, data: bytes) -> dict:
        """
        🔥 新增：解析二进制事件为标准事件字典
        
        协议格式（与前端MJPEGEventEncoder完全兼容）：
        - 鼠标事件（13字节）：[type:1][x:2][y:2][button:1][timestamp:4][reserved:3]
        - 滚轮事件（17字节）：[type:1][x:2][y:2][deltaY:4][deltaX:4][timestamp:4]
        - 键盘事件（可变）：[type:1][keyCode:2][modifiers:1][timestamp:4][key:N]
        
        Args:
            data: 二进制数据
            
        Returns:
            dict: 标准事件字典，失败返回None
        """
        if len(data) < 1:
            LOGGER.error("❌ 事件数据太短")
            return None
        
        try:
            event_type_code = data[0]
            event_type = self.event_type_map.get(event_type_code)
            
            if event_type is None:
                LOGGER.error(f"❌ 未知事件类型: {event_type_code}")
                return None
            
            # 🔥 鼠标事件（13字节）
            if len(data) == 13 and event_type_code <= 4:
                x = struct.unpack('>H', data[1:3])[0]  # big-endian unsigned short
                y = struct.unpack('>H', data[3:5])[0]
                button = data[5]
                timestamp = struct.unpack('>I', data[6:10])[0]  # big-endian unsigned int
                
                return {
                    'type': event_type,
                    'x': x,
                    'y': y,
                    'button': button,
                    'timestamp': timestamp
                }
            
            # 🔥 滚轮事件（17字节）
            elif len(data) == 17 and event_type_code == 5:
                x = struct.unpack('>H', data[1:3])[0]
                y = struct.unpack('>H', data[3:5])[0]
                deltaY = struct.unpack('>i', data[5:9])[0]  # big-endian signed int
                deltaX = struct.unpack('>i', data[9:13])[0]
                timestamp = struct.unpack('>I', data[13:17])[0]
                
                return {
                    'type': 'wheel',
                    'x': x,
                    'y': y,
                    'deltaY': deltaY,
                    'deltaX': deltaX,
                    'timestamp': timestamp
                }
            
            # 🔥 键盘事件（可变长度）
            elif event_type_code >= 6 and event_type_code <= 8 and len(data) >= 8:
                keyCode = struct.unpack('>H', data[1:3])[0]
                modifiers = data[3]
                timestamp = struct.unpack('>I', data[4:8])[0]
                
                # 解码key字符串（UTF-8）
                key = data[8:].decode('utf-8', errors='ignore') if len(data) > 8 else ''
                
                return {
                    'type': event_type,
                    'keyCode': keyCode,
                    'key': key,
                    'ctrlKey': bool(modifiers & 1),
                    'shiftKey': bool(modifiers & 2),
                    'altKey': bool(modifiers & 4),
                    'metaKey': bool(modifiers & 8),
                    'timestamp': timestamp
                }
            
            else:
                LOGGER.error(f"❌ 无效的事件数据: 类型={event_type_code}, 长度={len(data)}")
                return None
                
        except Exception as e:
            LOGGER.error(f"❌ 解析二进制事件失败: {e}", exc_info=True)
            return None
    
    async def _handle_mode_switch(self, websocket: WebSocketServerProtocol, mode_str: str):
        """
        处理模式切换
        
        支持三种模式：
        - 'mjpeg': MJPEG直传模式
        - 'h264': 标准H.264模式
        - 'scrcpy': Scrcpy优化模式
        """
        try:
            # 🚀 Scrcpy优化：支持scrcpy模式
            if mode_str == 'scrcpy':
                # Scrcpy模式映射到H264传输
                new_mode = StreamMode.H264
                actual_mode_str = 'scrcpy'
            else:
                new_mode = StreamMode(mode_str)
                actual_mode_str = mode_str
            
            old_mode = self._client_modes.get(websocket, StreamMode.MJPEG)
            
            if new_mode == old_mode:
                return
            
            # 更新统计
            if old_mode == StreamMode.H264:
                self._stats['h264_clients'] -= 1
            else:
                self._stats['mjpeg_clients'] -= 1
            
            if new_mode == StreamMode.H264:
                self._stats['h264_clients'] += 1
            else:
                self._stats['mjpeg_clients'] += 1
            
            # 更新模式
            self._client_modes[websocket] = new_mode
            
            LOGGER.info(f"🔄 客户端切换模式: {old_mode.value} → {actual_mode_str}")
            
            # 🔥 关键修复：通知HeadlessBridge更新模式
            if self._mode_switch_callback:
                try:
                    await self._mode_switch_callback(actual_mode_str)
                except Exception as e:
                    LOGGER.error(f"❌ 模式切换失败: {e}")
            
            # 发送确认
            await websocket.send(json.dumps({
                'type': 'mode_switched',
                'mode': actual_mode_str
            }))
        
        except ValueError:
            LOGGER.error(f"❌ 无效的模式: {mode_str}")
    
    async def broadcast_mjpeg_frame(self, jpeg_data: bytes, metadata: dict):
        """广播MJPEG帧"""
        if not self._running or not self._frame_queue:
            return
        
        try:
            # 放入队列
            self._frame_queue.put_nowait({
                'type': 'mjpeg',
                'data': jpeg_data,
                'metadata': metadata
            })
        except asyncio.QueueFull:
            # 丢弃旧帧
            try:
                self._frame_queue.get_nowait()
                self._frame_queue.put_nowait({
                    'type': 'mjpeg',
                    'data': jpeg_data,
                    'metadata': metadata
                })
            except:
                pass
    
    async def broadcast_h264_frame(self, h264_data: bytes, pts: int, is_keyframe: bool):
        """广播H.264帧"""
        if not self._running or not self._frame_queue:
            return
        
        try:
            # 放入队列
            self._frame_queue.put_nowait({
                'type': 'h264',
                'data': h264_data,
                'pts': pts,
                'keyframe': is_keyframe
            })
            
            # 更新统计
            self._h264_stats.update_frame(len(h264_data), is_keyframe, time.time())
        
        except asyncio.QueueFull:
            # 丢弃旧帧（非关键帧）
            if not is_keyframe:
                try:
                    self._frame_queue.get_nowait()
                    self._frame_queue.put_nowait({
                        'type': 'h264',
                        'data': h264_data,
                        'pts': pts,
                        'keyframe': is_keyframe
                    })
                except:
                    pass
    
    async def broadcast_h264_init(self, init_data: bytes):
        """广播H.264初始化数据（SPS+PPS）"""
        if not self._running:
            return
        
        # 打包初始化数据
        packet = H264StreamProtocol.pack_init_data(init_data)
        
        # 发送给所有H.264客户端
        for client in list(self._clients):
            if self._client_modes.get(client) == StreamMode.H264:
                try:
                    await client.send(packet)
                    LOGGER.info(f"📦 已发送初始化数据: {len(init_data)} bytes")
                except Exception as e:
                    LOGGER.error(f"❌ 发送初始化数据失败: {e}")
    
    async def _broadcast_frames(self):
        """广播帧循环"""
        LOGGER.info("📡 开始广播帧...")
        
        frame_count = 0
        last_log_time = time.time()
        
        try:
            while self._running:
                # 从队列获取帧
                frame = await self._frame_queue.get()
                
                frame_type = frame['type']
                
                if frame_type == 'mjpeg':
                    # MJPEG帧
                    await self._broadcast_mjpeg(frame['data'], frame['metadata'])
                
                elif frame_type == 'h264':
                    # H.264帧
                    await self._broadcast_h264(
                        frame['data'],
                        frame['pts'],
                        frame['keyframe']
                    )
                
                frame_count += 1
                
                # 每5秒打印一次统计
                now = time.time()
                if now - last_log_time >= 5.0:
                    elapsed = now - self._stats['start_time']
                    fps = frame_count / elapsed if elapsed > 0 else 0
                    bandwidth = (self._stats['bytes_sent'] * 8) / elapsed if elapsed > 0 else 0
                    
                    LOGGER.info(
                        f"📊 Stream统计: 帧数={frame_count}, "
                        f"FPS={fps:.1f}, "
                        f"带宽={bandwidth/1000000:.1f}Mbps, "
                        f"客户端={len(self._clients)} "
                        f"(MJPEG={self._stats['mjpeg_clients']}, "
                        f"H264={self._stats['h264_clients']})"
                    )
                    
                    if self._stats['h264_clients'] > 0:
                        LOGGER.info(f"📊 H.264统计: {self._h264_stats}")
                    
                    last_log_time = now
        
        except asyncio.CancelledError:
            LOGGER.info("📡 广播任务被取消")
        except Exception as e:
            LOGGER.error(f"❌ 广播失败: {e}")
    
    async def _broadcast_mjpeg(self, jpeg_data: bytes, metadata: dict):
        """广播MJPEG帧给MJPEG客户端"""
        if not self._clients:
            return
        
        for client in list(self._clients):
            if self._client_modes.get(client) != StreamMode.MJPEG:
                continue
            
            try:
                # 发送JPEG数据（原有格式）
                await client.send(jpeg_data)
                
                self._stats['frames_sent'] += 1
                self._stats['bytes_sent'] += len(jpeg_data)
            
            except Exception as e:
                LOGGER.error(f"❌ 发送MJPEG帧失败: {e}")
    
    async def _broadcast_h264(self, h264_data: bytes, pts: int, is_keyframe: bool):
        """广播H.264帧给H.264客户端"""
        if not self._clients:
            return
        
        # 打包H.264帧
        packet = H264StreamProtocol.pack_video_frame(h264_data, pts, is_keyframe)
        
        for client in list(self._clients):
            if self._client_modes.get(client) != StreamMode.H264:
                continue
            
            try:
                # 发送二进制包
                await client.send(packet)
                
                self._stats['frames_sent'] += 1
                self._stats['bytes_sent'] += len(packet)
            
            except Exception as e:
                LOGGER.error(f"❌ 发送H.264帧失败: {e}")
    
    async def broadcast_control_message(self, message: dict):
        """广播控制消息（录制、状态等）"""
        if not self._clients:
            LOGGER.debug("broadcast_control_message: 无活跃客户端")
            return
        
        msg_json = json.dumps(message)
        stale_clients = []
        sent_count = 0
        
        for client in list(self._clients):
            try:
                await client.send(msg_json)
                sent_count += 1
            except Exception as e:
                LOGGER.warning(f"⚠️ 广播失败(将移除stale连接): {e}")
                stale_clients.append(client)
        
        for client in stale_clients:
            self._clients.discard(client)
            mode = self._client_modes.pop(client, None)
            if mode == StreamMode.H264:
                self._stats['h264_clients'] -= 1
            else:
                self._stats['mjpeg_clients'] -= 1
        
        msg_type = message.get('type', 'unknown')
        if stale_clients:
            LOGGER.info(f"📡 广播 {msg_type}: 成功={sent_count}, 移除stale={len(stale_clients)}, 剩余客户端={len(self._clients)}")
        else:
            LOGGER.debug(f"📡 广播 {msg_type}: 成功={sent_count}")
    
    def get_stats(self) -> dict:
        """获取统计信息"""
        elapsed = time.time() - self._stats['start_time']
        
        return {
            **self._stats,
            'elapsed_seconds': round(elapsed, 1),
            'avg_fps': round(self._stats['frames_sent'] / max(1, elapsed), 1),
            'avg_bandwidth_mbps': round(
                (self._stats['bytes_sent'] * 8) / max(1, elapsed) / 1000000,
                2
            ),
            'total_clients': len(self._clients),
            'h264_stats': self._h264_stats.get_summary() if self._stats['h264_clients'] > 0 else None
        }
