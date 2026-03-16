"""
消息协议 - V5

功能：
1. 统一消息格式
2. 请求-响应ACK机制
3. 端到端trace
4. 版本控制
"""

import uuid
import time
import json
import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from enum import Enum

LOGGER = logging.getLogger(__name__)

# 协议版本
PROTOCOL_VERSION = "1.0"


class MessageType(Enum):
    """消息类型"""
    # 录制相关
    RECORDER_INIT = 'recorder_init'
    RECORDING_STARTED = 'recording_started'
    RECORDING_STOPPED = 'recording_stopped'
    RECORDING_PAUSED = 'recording_paused'
    RECORDING_RESUMED = 'recording_resumed'
    
    # 事件
    CLICK = 'click'
    INPUT = 'input'
    SCROLL = 'scroll'
    KEYDOWN = 'keydown'
    DBLCLICK = 'dblclick'
    NAVIGATE = 'navigate'
    
    # 步骤
    NEW_STEP = 'NEW_STEP'
    
    # 控制
    CONTROL = 'control'
    
    # 查询
    CHECK_ELEMENT = 'check_element'
    GET_ELEMENT_POSITION = 'get_element_position'
    
    # 响应
    ACK = 'ack'
    ERROR = 'error'
    QUERY_RESULT = 'query_result'


@dataclass
class Message:
    """统一消息格式"""
    version: str = PROTOCOL_VERSION
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    request_id: Optional[str] = None
    timestamp: int = field(default_factory=lambda: int(time.time() * 1000))
    type: str = ""
    channel: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        """转换为字典"""
        result = {
            "version": self.version,
            "trace_id": self.trace_id,
            "timestamp": self.timestamp,
            "type": self.type,
            "data": self.data
        }
        
        if self.request_id:
            result["request_id"] = self.request_id
        
        if self.channel:
            result["channel"] = self.channel
        
        return result
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'Message':
        """从字典创建"""
        return cls(
            version=data.get('version', PROTOCOL_VERSION),
            trace_id=data.get('trace_id', str(uuid.uuid4())),
            request_id=data.get('request_id'),
            timestamp=data.get('timestamp', int(time.time() * 1000)),
            type=data.get('type', ''),
            channel=data.get('channel'),
            data=data.get('data', {})
        )


class MessageProtocol:
    """
    消息协议管理器
    
    功能：
    1. 统一消息格式
    2. 请求-响应跟踪
    3. ACK机制
    4. Trace记录
    """
    
    def __init__(self):
        self.pending_requests: Dict[str, asyncio.Future] = {}
        self.traces: Dict[str, List[str]] = {}  # trace_id -> [event1, event2, ...]
        self.max_trace_size = 100
        
        LOGGER.info("✅ 消息协议管理器已初始化")
    
    def create_message(
        self,
        msg_type: str,
        data: Dict[str, Any],
        channel: Optional[str] = None,
        request_id: Optional[str] = None
    ) -> Message:
        """创建消息"""
        return Message(
            type=msg_type,
            data=data,
            channel=channel,
            request_id=request_id
        )
    
    def create_request(
        self,
        msg_type: str,
        data: Dict[str, Any],
        channel: Optional[str] = None
    ) -> Message:
        """创建带request_id的请求消息"""
        request_id = str(uuid.uuid4())
        return Message(
            type=msg_type,
            data=data,
            channel=channel,
            request_id=request_id
        )
    
    def create_ack(self, request_id: str, success: bool = True, error: Optional[str] = None) -> Message:
        """创建ACK响应"""
        return Message(
            type=MessageType.ACK.value,
            request_id=request_id,
            data={
                "success": success,
                "error": error
            }
        )
    
    async def send_with_ack(
        self,
        websocket,
        msg_type: str,
        data: Dict,
        timeout: float = 5.0
    ) -> Dict:
        """
        发送消息并等待ACK
        
        Returns:
            ACK的data部分
        """
        request = self.create_request(msg_type, data)
        request_id = request.request_id
        
        # 创建future等待响应
        future = asyncio.Future()
        self.pending_requests[request_id] = future
        
        try:
            # 发送消息
            await websocket.send(json.dumps(request.to_dict()))
            
            # 记录trace
            self._add_trace(request.trace_id, f"SEND: {msg_type}")
            
            # 等待ACK
            result = await asyncio.wait_for(future, timeout=timeout)
            
            # 记录trace
            self._add_trace(request.trace_id, f"ACK: {msg_type}")
            
            return result
            
        except asyncio.TimeoutError:
            LOGGER.warning(f"等待ACK超时: {msg_type} (request_id={request_id})")
            raise
        finally:
            self.pending_requests.pop(request_id, None)
    
    def handle_ack(self, message: Message):
        """处理ACK响应"""
        request_id = message.request_id
        
        if not request_id:
            LOGGER.warning("收到ACK但没有request_id")
            return
        
        future = self.pending_requests.get(request_id)
        if future and not future.done():
            if message.data.get('success'):
                future.set_result(message.data)
            else:
                future.set_exception(Exception(message.data.get('error', 'Unknown error')))
        
        # 记录trace
        self._add_trace(message.trace_id, f"HANDLE_ACK: {request_id}")
    
    def _add_trace(self, trace_id: str, event: str):
        """添加trace事件"""
        if trace_id not in self.traces:
            self.traces[trace_id] = []
        
        self.traces[trace_id].append(f"{time.time():.3f}: {event}")
        
        # 限制trace大小
        if len(self.traces) > self.max_trace_size:
            # 删除最旧的
            oldest = min(self.traces.keys())
            del self.traces[oldest]
    
    def get_trace(self, trace_id: str) -> List[str]:
        """获取trace记录"""
        return self.traces.get(trace_id, [])
    
    def log_trace(self, trace_id: str):
        """打印trace日志"""
        trace = self.get_trace(trace_id)
        if trace:
            LOGGER.info(f"Trace {trace_id}:")
            for event in trace:
                LOGGER.info(f"  {event}")


