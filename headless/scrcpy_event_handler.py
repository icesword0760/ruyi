"""
Scrcpy专用事件处理器 - WebSocket二进制协议
支持低延迟事件传输和批处理
"""
import struct
import asyncio
import logging
import time
from enum import IntEnum
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class ScrcpyEventType(IntEnum):
    """事件类型枚举"""
    MOUSE_MOVE = 0
    MOUSE_DOWN = 1
    MOUSE_UP = 2
    MOUSE_CLICK = 3
    MOUSE_DBLCLICK = 4
    MOUSE_WHEEL = 5
    KEY_DOWN = 6
    KEY_UP = 7
    KEY_PRESS = 8


class ScrcpyEventHandler:
    """
    Scrcpy事件处理器 - 二进制协议
    
    协议格式：
    鼠标事件（13字节）：
    [1字节类型][2字节x][2字节y][1字节button][4字节timestamp][3字节保留]
    
    滚轮事件（17字节）：
    [1字节类型][2字节x][2字节y][4字节deltaY][4字节deltaX][4字节timestamp]
    
    键盘事件（可变长）：
    [1字节类型][2字节keyCode][1字节modifiers][4字节timestamp][N字节key(UTF-8)]
    """
    
    def __init__(self, cdp_client):
        """
        初始化事件处理器
        
        Args:
            cdp_client: CDP客户端实例
        """
        self.cdp_client = cdp_client
        self.event_queue = asyncio.Queue(maxsize=100)  # 限制队列大小防止积压
        self.batch_size = 10  # 批处理大小
        self.batch_interval = 0.01  # 10ms批处理
        self.processing_task = None
        
        # 性能统计
        self.events_processed = 0
        self.events_dropped = 0
        self.last_process_time = 0
        self.process_times = []
        
        logger.info("🎮 ScrcpyEventHandler初始化")
    
    async def start(self):
        """启动事件处理循环"""
        if self.processing_task and not self.processing_task.done():
            logger.warning("⚠️  事件处理器已在运行")
            return
        
        self.processing_task = asyncio.create_task(self._process_loop())
        logger.info("✅ Scrcpy事件处理器已启动")
    
    async def stop(self):
        """停止事件处理"""
        if self.processing_task:
            self.processing_task.cancel()
            try:
                await self.processing_task
            except asyncio.CancelledError:
                pass
        
        avg_time = sum(self.process_times) / len(self.process_times) if self.process_times else 0
        logger.info(f"⏹️  Scrcpy事件处理器已停止: 处理={self.events_processed}, "
                  f"丢弃={self.events_dropped}, 平均耗时={avg_time:.1f}ms")
    
    async def handle_binary_event(self, data: bytes):
        """
        处理二进制事件数据
        
        Args:
            data: 二进制事件数据
        """
        if len(data) < 1:
            return
        
        try:
            event_type = data[0]
            
            if event_type <= ScrcpyEventType.MOUSE_WHEEL:
                # 鼠标/滚轮事件
                event = self._parse_mouse_event(data)
            elif event_type <= ScrcpyEventType.KEY_PRESS:
                # 键盘事件
                event = self._parse_keyboard_event(data)
            else:
                logger.warning(f"⚠️  未知事件类型: {event_type}")
                return
            
            # 加入队列（非阻塞）
            try:
                self.event_queue.put_nowait(event)
            except asyncio.QueueFull:
                self.events_dropped += 1
                if self.events_dropped % 10 == 1:
                    logger.warning(f"⚠️  事件队列已满，丢弃事件（已丢弃{self.events_dropped}个）")
        
        except Exception as e:
            logger.error(f"❌ 解析事件失败: {e}", exc_info=True)
    
    async def handle_json_event(self, event: Dict[str, Any]):
        """
        处理JSON事件（兼容旧协议）
        
        Args:
            event: JSON事件数据
        """
        try:
            # 直接加入队列
            self.event_queue.put_nowait(event)
        except asyncio.QueueFull:
            self.events_dropped += 1
            if self.events_dropped % 10 == 1:
                logger.warning(f"⚠️  事件队列已满，丢弃事件（已丢弃{self.events_dropped}个）")
    
    def _parse_mouse_event(self, data: bytes) -> Dict[str, Any]:
        """解析鼠标事件"""
        event_type = data[0]
        
        if event_type == ScrcpyEventType.MOUSE_WHEEL:
            # 滚轮事件：17字节
            if len(data) < 17:
                raise ValueError(f"滚轮事件数据不足: {len(data)} < 17")
            
            x, y, deltaY, deltaX, timestamp = struct.unpack('!HHiiI', data[1:17])
            return {
                'type': 'wheel',
                'x': x,
                'y': y,
                'deltaY': deltaY,
                'deltaX': deltaX,
                'deltaZ': 0,
                'deltaMode': 0,
                'timestamp': timestamp
            }
        else:
            # 鼠标事件：13字节
            if len(data) < 13:
                raise ValueError(f"鼠标事件数据不足: {len(data)} < 13")
            
            x, y, button, timestamp = struct.unpack('!HHBI', data[1:10])
            
            type_map = {
                ScrcpyEventType.MOUSE_MOVE: 'mousemove',
                ScrcpyEventType.MOUSE_DOWN: 'mousedown',
                ScrcpyEventType.MOUSE_UP: 'mouseup',
                ScrcpyEventType.MOUSE_CLICK: 'click',
                ScrcpyEventType.MOUSE_DBLCLICK: 'dblclick'
            }
            
            return {
                'type': type_map.get(event_type, 'click'),
                'x': x,
                'y': y,
                'button': button,
                'timestamp': timestamp
            }
    
    def _parse_keyboard_event(self, data: bytes) -> Dict[str, Any]:
        """解析键盘事件"""
        event_type = data[0]
        
        if len(data) < 8:
            raise ValueError(f"键盘事件数据不足: {len(data)} < 8")
        
        keyCode, modifiers, timestamp = struct.unpack('!HBI', data[1:8])
        
        # 解析按键字符串（UTF-8）
        key = data[8:].decode('utf-8') if len(data) > 8 else ''
        
        type_map = {
            ScrcpyEventType.KEY_DOWN: 'keydown',
            ScrcpyEventType.KEY_UP: 'keyup',
            ScrcpyEventType.KEY_PRESS: 'keypress'
        }
        
        return {
            'type': type_map.get(event_type, 'keydown'),
            'key': key,
            'code': '',  # 简化处理
            'keyCode': keyCode,
            'ctrlKey': bool(modifiers & 0x01),
            'shiftKey': bool(modifiers & 0x02),
            'altKey': bool(modifiers & 0x04),
            'metaKey': bool(modifiers & 0x08),
            'timestamp': timestamp
        }
    
    async def _process_loop(self):
        """事件处理循环（批处理）"""
        batch = []
        
        try:
            while True:
                try:
                    # 等待事件（带超时实现批处理）
                    event = await asyncio.wait_for(
                        self.event_queue.get(),
                        timeout=self.batch_interval
                    )
                    batch.append(event)
                    
                    # 达到批处理大小或队列为空时处理
                    if len(batch) >= self.batch_size or self.event_queue.empty():
                        await self._process_batch(batch)
                        batch = []
                
                except asyncio.TimeoutError:
                    # 超时，处理当前批次
                    if batch:
                        await self._process_batch(batch)
                        batch = []
        
        except asyncio.CancelledError:
            # 处理剩余事件
            if batch:
                await self._process_batch(batch)
            raise
    
    async def _process_batch(self, events: list):
        """批量处理事件"""
        if not events:
            return
        
        start_time = time.perf_counter()
        
        try:
            # 批量发送到CDP（并发）
            tasks = [self._dispatch_event(event) for event in events]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            self.events_processed += len(events)
            
            process_time = (time.perf_counter() - start_time) * 1000
            self.process_times.append(process_time)
            
            # 保留最近100个样本
            if len(self.process_times) > 100:
                self.process_times.pop(0)
            
            # 调试日志
            if len(events) > 1:
                logger.debug(f"📦 批处理{len(events)}个事件, 耗时={process_time:.1f}ms")
        
        except Exception as e:
            logger.error(f"❌ 批处理事件失败: {e}")
    
    async def _dispatch_event(self, event: Dict[str, Any]):
        """分发单个事件到CDP"""
        try:
            event_type = event['type']
            
            if event_type in ('click', 'mousedown', 'mouseup', 'mousemove', 'dblclick'):
                # CDP鼠标事件
                cdp_type = 'mousePressed' if event_type == 'mousedown' \
                      else 'mouseReleased' if event_type == 'mouseup' \
                      else 'mouseMoved'
                
                button_map = {0: 'left', 1: 'middle', 2: 'right'}
                button = button_map.get(event.get('button', 0), 'left')
                
                await self.cdp_client.send('Input.dispatchMouseEvent', {
                    'type': cdp_type,
                    'x': event['x'],
                    'y': event['y'],
                    'button': button,
                    'clickCount': 2 if event_type == 'dblclick' else 1
                })
            
            elif event_type == 'wheel':
                # CDP滚轮事件
                await self.cdp_client.send('Input.dispatchMouseEvent', {
                    'type': 'mouseWheel',
                    'x': event['x'],
                    'y': event['y'],
                    'deltaX': event.get('deltaX', 0),
                    'deltaY': event.get('deltaY', 0)
                })
            
            elif event_type in ('keydown', 'keyup', 'keypress'):
                # CDP键盘事件
                cdp_type = 'keyDown' if event_type == 'keydown' \
                      else 'keyUp' if event_type == 'keyup' \
                      else 'char'
                
                modifiers = (
                    (1 if event.get('ctrlKey') else 0) |
                    (2 if event.get('shiftKey') else 0) |
                    (4 if event.get('altKey') else 0) |
                    (8 if event.get('metaKey') else 0)
                )
                
                await self.cdp_client.send('Input.dispatchKeyEvent', {
                    'type': cdp_type,
                    'text': event.get('key', ''),
                    'unmodifiedText': event.get('key', ''),
                    'code': event.get('code', ''),
                    'key': event.get('key', ''),
                    'windowsVirtualKeyCode': event.get('keyCode', 0),
                    'modifiers': modifiers
                })
        
        except Exception as e:
            logger.error(f"❌ 分发事件失败: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取事件处理统计"""
        avg_time = sum(self.process_times) / len(self.process_times) if self.process_times else 0
        
        return {
            'events_processed': self.events_processed,
            'events_dropped': self.events_dropped,
            'avg_process_time_ms': avg_time,
            'queue_size': self.event_queue.qsize(),
            'running': self.processing_task and not self.processing_task.done()
        }
