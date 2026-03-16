"""
H.264流传输协议
实现类似scrcpy的二进制协议
"""
import struct
import logging
from typing import Tuple
from enum import IntEnum

LOGGER = logging.getLogger(__name__)


class H264MessageType(IntEnum):
    """消息类型"""
    VIDEO_FRAME = 0x01      # 视频帧
    INIT_DATA = 0x02        # 初始化数据（SPS+PPS）
    CONTROL = 0x03          # 控制消息
    STATS = 0x04            # 统计信息


class H264StreamProtocol:
    """
    H.264流传输协议
    
    消息格式:
    +--------+--------+--------+--------+----------------+
    | Magic  | Type   | Length | PTS    | Payload        |
    | (4B)   | (1B)   | (4B)   | (8B)   | (Variable)     |
    +--------+--------+--------+--------+----------------+
    
    Magic: 0x48323634 ('H264')
    Type: 消息类型
    Length: Payload长度
    PTS: 演示时间戳（微秒）
    Payload: 实际数据
    
    对于视频帧，Payload格式:
    +--------+----------------+
    | Flags  | H.264 Data     |
    | (1B)   | (Variable)     |
    +--------+----------------+
    
    Flags: bit 0 = is_keyframe
    """
    
    MAGIC = 0x48323634  # 'H264'
    HEADER_SIZE = 17    # 4 + 1 + 4 + 8
    
    @classmethod
    def pack_video_frame(
        cls,
        h264_data: bytes,
        pts: int,
        is_keyframe: bool
    ) -> bytes:
        """
        打包视频帧
        
        Args:
            h264_data: H.264 NAL units
            pts: 演示时间戳（微秒）
            is_keyframe: 是否为关键帧
            
        Returns:
            打包后的二进制数据
        """
        # 构建flags
        flags = 1 if is_keyframe else 0
        
        # Payload = flags + h264_data
        payload = struct.pack('B', flags) + h264_data
        
        # 构建header
        header = struct.pack(
            '!IBIQ',
            cls.MAGIC,              # Magic (4 bytes, big-endian)
            H264MessageType.VIDEO_FRAME,  # Type (1 byte)
            len(payload),           # Length (4 bytes, big-endian)
            pts                     # PTS (8 bytes, big-endian)
        )
        
        return header + payload
    
    @classmethod
    def pack_init_data(cls, init_data: bytes) -> bytes:
        """
        打包初始化数据（SPS+PPS）
        
        Args:
            init_data: SPS + PPS
            
        Returns:
            打包后的二进制数据
        """
        header = struct.pack(
            '!IBIQ',
            cls.MAGIC,
            H264MessageType.INIT_DATA,
            len(init_data),
            0  # PTS=0 for init data
        )
        
        return header + init_data
    
    @classmethod
    def pack_stats(cls, stats: dict) -> bytes:
        """
        打包统计信息
        
        Args:
            stats: 统计字典
            
        Returns:
            打包后的二进制数据
        """
        import json
        stats_json = json.dumps(stats).encode('utf-8')
        
        header = struct.pack(
            '!IBIQ',
            cls.MAGIC,
            H264MessageType.STATS,
            len(stats_json),
            0
        )
        
        return header + stats_json
    
    @classmethod
    def unpack_message(cls, data: bytes) -> Tuple[int, bytes, int]:
        """
        解包消息
        
        Args:
            data: 接收到的二进制数据
            
        Returns:
            (message_type, payload, pts)
            
        Raises:
            ValueError: 如果数据格式无效
        """
        if len(data) < cls.HEADER_SIZE:
            raise ValueError(f"Data too short: {len(data)} < {cls.HEADER_SIZE}")
        
        # 解析header
        magic, msg_type, length, pts = struct.unpack(
            '!IBIQ',
            data[:cls.HEADER_SIZE]
        )
        
        # 验证magic
        if magic != cls.MAGIC:
            raise ValueError(f"Invalid magic: 0x{magic:08X}, expected 0x{cls.MAGIC:08X}")
        
        # 提取payload
        payload = data[cls.HEADER_SIZE:cls.HEADER_SIZE + length]
        
        if len(payload) != length:
            raise ValueError(f"Incomplete payload: {len(payload)} < {length}")
        
        return msg_type, payload, pts
    
    @classmethod
    def unpack_video_frame(cls, data: bytes) -> Tuple[bytes, int, bool]:
        """
        解包视频帧
        
        Args:
            data: 完整的消息数据
            
        Returns:
            (h264_data, pts, is_keyframe)
        """
        msg_type, payload, pts = cls.unpack_message(data)
        
        if msg_type != H264MessageType.VIDEO_FRAME:
            raise ValueError(f"Not a video frame: type={msg_type}")
        
        # 解析flags
        flags = payload[0]
        is_keyframe = bool(flags & 1)
        
        # 提取H.264数据
        h264_data = payload[1:]
        
        return h264_data, pts, is_keyframe


class H264StreamStats:
    """H.264流统计"""
    
    def __init__(self):
        self.reset()
    
    def reset(self):
        """重置统计"""
        self.total_frames = 0
        self.keyframes = 0
        self.total_bytes = 0
        self.min_frame_size = float('inf')
        self.max_frame_size = 0
        self.avg_frame_size = 0
        
        # 实时统计
        self.last_frame_time = 0
        self.frame_intervals = []
        self.actual_fps = 0
    
    def update_frame(self, frame_size: int, is_keyframe: bool, timestamp: float):
        """更新帧统计"""
        self.total_frames += 1
        if is_keyframe:
            self.keyframes += 1
        
        self.total_bytes += frame_size
        self.min_frame_size = min(self.min_frame_size, frame_size)
        self.max_frame_size = max(self.max_frame_size, frame_size)
        
        if self.total_frames > 0:
            self.avg_frame_size = self.total_bytes // self.total_frames
        
        # 计算实际FPS
        if self.last_frame_time > 0:
            interval = timestamp - self.last_frame_time
            self.frame_intervals.append(interval)
            
            # 保留最近30个间隔
            if len(self.frame_intervals) > 30:
                self.frame_intervals.pop(0)
            
            # 计算平均FPS
            if self.frame_intervals:
                avg_interval = sum(self.frame_intervals) / len(self.frame_intervals)
                if avg_interval > 0:
                    self.actual_fps = 1.0 / avg_interval
        
        self.last_frame_time = timestamp
    
    def get_summary(self) -> dict:
        """获取统计摘要"""
        return {
            'total_frames': self.total_frames,
            'keyframes': self.keyframes,
            'keyframe_ratio': self.keyframes / max(1, self.total_frames),
            'total_bytes': self.total_bytes,
            'total_mb': round(self.total_bytes / (1024 * 1024), 2),
            'min_frame_size': self.min_frame_size if self.min_frame_size != float('inf') else 0,
            'max_frame_size': self.max_frame_size,
            'avg_frame_size': self.avg_frame_size,
            'actual_fps': round(self.actual_fps, 2)
        }
    
    def __str__(self) -> str:
        s = self.get_summary()
        return (f"H264Stats(frames={s['total_frames']}, "
                f"keyframes={s['keyframes']}, "
                f"total={s['total_mb']}MB, "
                f"avg_size={s['avg_frame_size']}B, "
                f"fps={s['actual_fps']})")
