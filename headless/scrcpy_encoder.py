"""
Scrcpy专用H.264编码器 - 极低延迟配置
"""
import subprocess
import logging
import threading
import asyncio
import queue
import platform
import struct
import time
from typing import Optional, Callable, Dict, Any

logger = logging.getLogger(__name__)


class ScrcpyH264Encoder:
    """
    Scrcpy模式专用H.264编码器
    优化目标：最低延迟（牺牲部分压缩率）
    
    关键特性：
    1. 硬件编码器优先
    2. ultrafast preset + zerolatency tune
    3. 禁用B帧，减少参考帧
    4. 固定GOP，减少延迟
    5. PNG输入（无损）
    """
    
    def __init__(self, width: int, height: int, fps: int = 60, bitrate: int = 8000000):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate
        
        # 编码器配置：极限低延迟
        self.encoder = self._select_encoder()
        self.command = self._build_command()
        
        self.process = None
        self.output_thread = None
        self.nal_callback = None
        self.running = False
        
        # 性能统计
        self.frame_count = 0
        self.encode_times = []
        self.total_bytes = 0
        self.keyframe_count = 0
        
        logger.info(f"🎬 Scrcpy编码器初始化: {width}x{height}@{fps}fps, 码率={bitrate/1000000:.1f}Mbps")
        logger.info(f"🔧 选择编码器: {self.encoder}")
    
    def _select_encoder(self) -> str:
        """
        选择最佳编码器（优先硬件加速）
        返回：编码器名称
        """
        system = platform.system()
        
        # macOS: VideoToolbox
        if system == 'Darwin':
            if self._check_encoder('h264_videotoolbox'):
                logger.info("✅ 使用硬件编码器: h264_videotoolbox (macOS)")
                return 'h264_videotoolbox'
        
        # Windows/Linux: NVIDIA NVENC
        if self._check_encoder('h264_nvenc'):
            logger.info("✅ 使用硬件编码器: h264_nvenc (NVIDIA)")
            return 'h264_nvenc'
        
        # Linux: VAAPI
        if system == 'Linux' and self._check_encoder('h264_vaapi'):
            logger.info("✅ 使用硬件编码器: h264_vaapi (Intel/AMD)")
            return 'h264_vaapi'
        
        # Windows: QSV
        if system == 'Windows' and self._check_encoder('h264_qsv'):
            logger.info("✅ 使用硬件编码器: h264_qsv (Intel)")
            return 'h264_qsv'
        
        # 备用：软件编码器
        logger.info("⚠️  硬件编码器不可用，使用软件编码器: libx264")
        return 'libx264'
    
    def _check_encoder(self, encoder_name: str) -> bool:
        """检查编码器是否可用"""
        try:
            result = subprocess.run(
                ['ffmpeg', '-hide_banner', '-encoders'],
                capture_output=True,
                text=True,
                timeout=2
            )
            return encoder_name in result.stdout
        except Exception as e:
            logger.debug(f"检查编码器失败 {encoder_name}: {e}")
            return False
    
    def _build_command(self) -> list:
        """构建FFmpeg命令"""
        cmd = [
            'ffmpeg',
            '-loglevel', 'error',  # 只显示错误
            
            # 输入配置（PNG/JPEG图片流）
            '-f', 'image2pipe',
            '-vcodec', 'png',  # PNG解码器
            '-r', str(self.fps),
            '-i', '-',  # 从stdin读取
            
            # 编码器选择
            '-c:v', self.encoder,
        ]
        
        # ==== 低延迟关键参数 ====
        if self.encoder == 'h264_videotoolbox':
            # macOS VideoToolbox
            cmd.extend([
                '-profile:v', 'high',
                '-b:v', str(self.bitrate),
                '-maxrate', str(self.bitrate),
                '-bufsize', str(self.bitrate // 2),
                '-g', '30',  # GOP=30帧
                '-realtime', '1',
                '-allow_sw', '1',  # 允许回退到软件编码
            ])
        
        elif self.encoder == 'h264_nvenc':
            # NVIDIA NVENC
            cmd.extend([
                '-preset', 'p1',  # 最快preset
                '-tune', 'ull',   # Ultra Low Latency
                '-profile:v', 'high',
                '-b:v', str(self.bitrate),
                '-maxrate', str(self.bitrate),
                '-bufsize', str(self.bitrate // 2),
                '-g', '30',
                '-bf', '0',  # 禁用B帧
                '-zerolatency', '1',
                '-delay', '0',
                '-forced-idr', '1',
            ])
        
        elif self.encoder == 'h264_qsv':
            # Intel QSV
            cmd.extend([
                '-preset', 'veryfast',
                '-profile:v', 'high',
                '-b:v', str(self.bitrate),
                '-maxrate', str(self.bitrate),
                '-bufsize', str(self.bitrate // 2),
                '-g', '30',
                '-bf', '0',
                '-look_ahead', '0',
                '-async_depth', '1',
            ])
        
        elif self.encoder == 'h264_vaapi':
            # VAAPI
            cmd.extend([
                '-profile:v', 'high',
                '-b:v', str(self.bitrate),
                '-maxrate', str(self.bitrate),
                '-bufsize', str(self.bitrate // 2),
                '-g', '30',
                '-bf', '0',
            ])
        
        else:  # libx264软件编码
            cmd.extend([
                # 速度优先
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                
                # 质量控制
                '-crf', '23',
                '-profile:v', 'high',
                '-level', '4.2',
                
                # 码率控制
                '-b:v', str(self.bitrate),
                '-maxrate', str(self.bitrate),
                '-bufsize', str(self.bitrate // 2),
                
                # GOP和关键帧
                '-g', '30',  # GOP大小=30帧
                '-keyint_min', '30',
                '-sc_threshold', '0',  # 禁用场景切换检测
                
                # B帧控制
                '-bf', '0',  # 禁用B帧
                '-b_strategy', '0',
                
                # 参考帧
                '-refs', '1',  # 只使用1个参考帧
                
                # 其他优化
                '-rc-lookahead', '0',
                '-threads', '4',
                '-slices', '4',
            ])
        
        # 输出配置
        cmd.extend([
            '-pix_fmt', 'yuv420p',
            '-f', 'h264',
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-'  # 输出到stdout
        ])
        
        return cmd
    
    def start(self, nal_callback: Callable):
        """
        启动编码器
        
        Args:
            nal_callback: NAL单元回调 def callback(nal_data: bytes, is_keyframe: bool)
                         注意：这是同步回调，会在单独的线程中调用
        """
        if self.running:
            logger.warning("⚠️  编码器已在运行")
            return
        
        self.nal_callback = nal_callback
        self.running = True
        self.frame_count = 0
        self.encode_times = []
        
        try:
            # 启动FFmpeg进程
            self.process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0  # 无缓冲
            )
            
            # 启动输出读取线程
            self.output_thread = threading.Thread(target=self._read_output, daemon=True)
            self.output_thread.start()
            
            logger.info(f"✅ Scrcpy编码器已启动")
            logger.info(f"📋 命令: {' '.join(self.command[:10])}...")
        
        except Exception as e:
            logger.error(f"❌ 启动编码器失败: {e}")
            self.running = False
            raise
    
    def encode_frame(self, frame_data: bytes):
        """
        编码一帧
        
        Args:
            frame_data: 图片数据（PNG格式）
        """
        if not self.running or not self.process:
            return
        
        try:
            start_time = time.perf_counter()
            
            # 直接写入PNG数据（FFmpeg自动解码）
            self.process.stdin.write(frame_data)
            self.process.stdin.flush()
            
            encode_time = (time.perf_counter() - start_time) * 1000
            self.encode_times.append(encode_time)
            
            # 保留最近100个样本
            if len(self.encode_times) > 100:
                self.encode_times.pop(0)
            
            self.frame_count += 1
            
            # 调试日志（前10帧 + 每1000帧）
            if self.frame_count <= 10 or self.frame_count % 1000 == 0:
                avg_time = sum(self.encode_times) / len(self.encode_times) if self.encode_times else 0
                logger.info(f"🎬 编码帧 #{self.frame_count}: {len(frame_data)} bytes, "
                          f"耗时={encode_time:.1f}ms, 平均={avg_time:.1f}ms")
        
        except Exception as e:
            logger.error(f"❌ 编码帧失败: {e}")
    
    def _read_output(self):
        """读取编码输出（H.264 NAL单元）- 在独立线程运行"""
        nal_buffer = bytearray()
        
        try:
            while self.running and self.process:
                chunk = self.process.stdout.read(4096)
                if not chunk:
                    break
                
                nal_buffer.extend(chunk)
                
                # 解析NAL单元（查找起始码 0x00 0x00 0x00 0x01）
                while len(nal_buffer) > 4:
                    # 查找下一个NAL起始码
                    next_start = self._find_nal_start(nal_buffer, 4)
                    
                    if next_start == -1:
                        # 没找到，继续读取
                        break
                    
                    # 提取NAL单元
                    nal_data = bytes(nal_buffer[:next_start])
                    nal_buffer = nal_buffer[next_start:]
                    
                    # 判断是否是关键帧（NAL type = 5, IDR slice）
                    is_keyframe = self._is_keyframe_nal(nal_data)
                    if is_keyframe:
                        self.keyframe_count += 1
                    
                    self.total_bytes += len(nal_data)
                    
                    # 同步回调（在当前线程）
                    if self.nal_callback:
                        try:
                            self.nal_callback(nal_data, is_keyframe)
                        except Exception as cb_err:
                            logger.error(f"❌ NAL回调失败: {cb_err}")
        
        except Exception as e:
            logger.error(f"❌ 读取编码输出失败: {e}")
        finally:
            logger.info("⏹️  编码器输出线程已退出")
    
    def _find_nal_start(self, buffer: bytearray, start_pos: int) -> int:
        """查找NAL起始码位置"""
        for i in range(start_pos, len(buffer) - 3):
            if (buffer[i] == 0 and buffer[i+1] == 0 and 
                buffer[i+2] == 0 and buffer[i+3] == 1):
                return i
        return -1
    
    def _is_keyframe_nal(self, nal_data: bytes) -> bool:
        """判断NAL单元是否是关键帧"""
        if len(nal_data) < 5:
            return False
        # 跳过起始码，读取NAL header
        nal_header = nal_data[4]
        nal_type = nal_header & 0x1F
        # NAL类型: 5=IDR, 7=SPS, 8=PPS
        return nal_type == 5
    
    def stop(self):
        """停止编码器"""
        if not self.running:
            return
        
        self.running = False
        
        try:
            if self.process:
                self.process.stdin.close()
                self.process.terminate()
                self.process.wait(timeout=2)
            
            if self.output_thread:
                self.output_thread.join(timeout=2)
            
            # 统计报告
            if self.encode_times:
                avg_time = sum(self.encode_times) / len(self.encode_times)
                max_time = max(self.encode_times)
                min_time = min(self.encode_times)
                avg_size = self.total_bytes / self.frame_count if self.frame_count > 0 else 0
                logger.info(f"⏹️  编码器已停止: 总帧数={self.frame_count}, 关键帧={self.keyframe_count}, "
                          f"总字节={self.total_bytes}, 平均帧大小={avg_size:.0f}B")
                logger.info(f"⏹️  编码耗时: 平均={avg_time:.1f}ms, 最大={max_time:.1f}ms, 最小={min_time:.1f}ms")
        
        except Exception as e:
            logger.error(f"❌ 停止编码器失败: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取编码统计"""
        avg_time = sum(self.encode_times) / len(self.encode_times) if self.encode_times else 0
        avg_size = self.total_bytes / self.frame_count if self.frame_count > 0 else 0
        
        return {
            'encoder': self.encoder,
            'resolution': f'{self.width}x{self.height}',
            'fps': self.fps,
            'bitrate': self.bitrate,
            'frame_count': self.frame_count,
            'keyframe_count': self.keyframe_count,
            'total_bytes': self.total_bytes,
            'avg_encode_time_ms': avg_time,
            'avg_frame_size_bytes': avg_size,
            'running': self.running
        }
