"""
Scrcpy专用捕获器 - 使用Page.startScreencast推送模式
完全独立实现，不影响现有MJPEG/WebRTC模式
"""
import asyncio
import base64
import logging
from typing import Optional, Callable, Dict, Any

logger = logging.getLogger(__name__)


class ScrcpyCaptureEngine:
    """
    Scrcpy模式专用捕获引擎
    特点：
    1. 使用Page.startScreencast推送模式（而非轮询）
    2. 每帧立即处理，无等待
    3. 支持动态帧率调整
    4. PNG无损格式，避免JPEG二次压缩
    """
    
    def __init__(self, cdp_client, encoding_format='png'):
        """
        初始化捕获引擎
        
        Args:
            cdp_client: CDP客户端实例
            encoding_format: 'jpeg' or 'png' (推荐PNG for H.264)
        """
        self.cdp_client = cdp_client
        self.encoding_format = encoding_format  # 'jpeg' or 'png'
        self.is_active = False
        self.frame_callback = None
        self.frame_count = 0
        self.dropped_frames = 0
        
        # 性能统计
        self.last_frame_time = 0
        self.avg_interval = 0
        self.frame_intervals = []  # 保留最近100个间隔
        
        # Screencast session ID
        self.session_id = None
        
        logger.info(f"📸 ScrcpyCaptureEngine初始化: format={encoding_format}")
    
    async def start(self, width: int, height: int, quality: int = 100, 
                   max_fps: int = 60, frame_callback: Optional[Callable] = None):
        """
        启动Screencast推送模式
        
        Args:
            width: 捕获宽度
            height: 捕获高度
            quality: 质量（1-100），PNG忽略此参数
            max_fps: 最大帧率（实际帧率由Chrome控制）
            frame_callback: 帧回调函数 async def callback(frame_data: bytes, metadata: dict)
        """
        if self.is_active:
            logger.warning("⚠️  ScrcpyCaptureEngine已在运行")
            return
        
        self.frame_callback = frame_callback
        self.is_active = True
        self.frame_count = 0
        self.dropped_frames = 0
        self.frame_intervals = []
        
        # 注册Screencast事件监听器
        if hasattr(self.cdp_client, 'add_event_listener'):
            self.cdp_client.add_event_listener('Page.screencastFrame', self._on_screencast_frame)
        else:
            # 兼容旧版CDP客户端，手动注册事件处理
            logger.warning("⚠️  CDP客户端不支持add_event_listener，使用兼容模式")
        
        # 启动Screencast
        try:
            params = {
                'format': self.encoding_format,
                'maxWidth': width,
                'maxHeight': height,
                'everyNthFrame': 1  # 不跳帧（最大性能）
            }
            
            # 只有JPEG格式需要质量参数
            if self.encoding_format == 'jpeg':
                params['quality'] = quality
            
            await self.cdp_client.send('Page.startScreencast', params)
            logger.info(f"✅ Screencast已启动: {width}x{height}@max{max_fps}fps, format={self.encoding_format}")
        except Exception as e:
            logger.error(f"❌ 启动Screencast失败: {e}")
            self.is_active = False
            raise
    
    async def _on_screencast_frame(self, params: Dict[str, Any]):
        """
        处理Screencast帧事件（推送模式）
        
        params结构:
        {
            'data': 'base64编码的图片数据',
            'metadata': {
                'timestamp': 123456.789,
                'deviceWidth': 1920,
                'deviceHeight': 1080,
                'pageScaleFactor': 1.0,
                'offsetTop': 0,
                'offsetBottom': 0,
                'offsetLeft': 0,
                'offsetRight': 0,
                'scrollOffsetX': 0,
                'scrollOffsetY': 0
            },
            'sessionId': 123
        }
        """
        if not self.is_active:
            return
        
        try:
            session_id = params.get('sessionId')
            self.session_id = session_id
            
            # 必须确认帧接收（否则Chrome会暂停推送）
            if session_id is not None:
                try:
                    await self.cdp_client.send('Page.screencastFrameAck', {
                        'sessionId': session_id
                    })
                except Exception as ack_err:
                    logger.error(f"❌ 确认Screencast帧失败: {ack_err}")
            
            # 解码帧数据
            frame_data = base64.b64decode(params.get('data', ''))
            metadata = params.get('metadata', {})
            
            # 性能统计
            import time
            current_time = time.time()
            if self.last_frame_time > 0:
                interval = current_time - self.last_frame_time
                self.frame_intervals.append(interval)
                # 保留最近100个样本
                if len(self.frame_intervals) > 100:
                    self.frame_intervals.pop(0)
                # 计算平均间隔
                self.avg_interval = sum(self.frame_intervals) / len(self.frame_intervals)
            self.last_frame_time = current_time
            
            self.frame_count += 1
            
            # 调试日志（前10帧 + 每1000帧）
            if self.frame_count <= 10 or self.frame_count % 1000 == 0:
                actual_fps = 1.0 / self.avg_interval if self.avg_interval > 0 else 0
                logger.info(f"📸 Screencast帧 #{self.frame_count}: {len(frame_data)} bytes, "
                          f"fps={actual_fps:.1f}")
            
            # 调用回调
            if self.frame_callback:
                try:
                    await self.frame_callback(frame_data, metadata)
                except Exception as cb_err:
                    logger.error(f"❌ 帧回调失败: {cb_err}")
                    self.dropped_frames += 1
        
        except Exception as e:
            logger.error(f"❌ 处理Screencast帧失败: {e}", exc_info=True)
            self.dropped_frames += 1
    
    async def stop(self):
        """停止Screencast"""
        if not self.is_active:
            return
        
        self.is_active = False
        
        try:
            await self.cdp_client.send('Page.stopScreencast')
            
            # 移除事件监听器
            if hasattr(self.cdp_client, 'remove_event_listener'):
                self.cdp_client.remove_event_listener('Page.screencastFrame', self._on_screencast_frame)
            
            # 统计报告
            total_frames = self.frame_count + self.dropped_frames
            if total_frames > 0:
                success_rate = (self.frame_count / total_frames) * 100
                avg_fps = 1.0 / self.avg_interval if self.avg_interval > 0 else 0
                logger.info(f"⏹️  Screencast已停止: 总帧数={self.frame_count}, "
                          f"丢帧={self.dropped_frames}, 成功率={success_rate:.1f}%, "
                          f"平均FPS={avg_fps:.1f}")
        except Exception as e:
            logger.error(f"❌ 停止Screencast失败: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取性能统计"""
        actual_fps = 1.0 / self.avg_interval if self.avg_interval > 0 else 0
        return {
            'is_active': self.is_active,
            'frame_count': self.frame_count,
            'dropped_frames': self.dropped_frames,
            'avg_fps': actual_fps,
            'avg_interval_ms': self.avg_interval * 1000,
            'format': self.encoding_format
        }
