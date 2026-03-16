"""
H.264硬件编码器模块
支持多平台硬件加速编码
"""
import asyncio
import subprocess
import logging
import platform
import struct
import time
from typing import Optional, Callable, Dict, Any
from enum import Enum

LOGGER = logging.getLogger(__name__)


class H264Codec(Enum):
    """H.264编码器类型"""
    VIDEOTOOLBOX = "h264_videotoolbox"  # macOS硬件加速
    NVENC = "h264_nvenc"                 # NVIDIA GPU
    QSV = "h264_qsv"                     # Intel Quick Sync
    VAAPI = "h264_vaapi"                 # Intel/AMD on Linux
    X264 = "libx264"                     # 软件编码（备选）


class H264Profile(Enum):
    """H.264配置文件"""
    BASELINE = "baseline"
    MAIN = "main"
    HIGH = "high"


class H264Preset(Enum):
    """编码速度预设"""
    ULTRAFAST = "ultrafast"
    SUPERFAST = "superfast"
    VERYFAST = "veryfast"
    FASTER = "faster"
    FAST = "fast"
    MEDIUM = "medium"


class H264Encoder:
    """
    H.264硬件加速编码器
    
    使用FFmpeg subprocess进行编码，支持：
    - 多平台硬件加速自动检测
    - 低延迟配置（zerolatency tune）
    - 动态码率调整
    - SPS/PPS自动提取
    """
    
    def __init__(
        self,
        width: int = 1920,
        height: int = 1080,
        fps: int = 30,
        bitrate: int = 5000000,
        preset: H264Preset = H264Preset.ULTRAFAST,
        profile: H264Profile = H264Profile.HIGH,
        on_frame: Optional[Callable[[bytes, int, bool], None]] = None
    ):
        """
        初始化H.264编码器
        
        Args:
            width: 视频宽度
            height: 视频高度
            fps: 帧率
            bitrate: 码率 (bps)
            preset: 编码预设
            profile: H.264配置文件
            on_frame: 帧回调函数(h264_data, pts, is_keyframe)
        """
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate
        self.preset = preset
        self.profile = profile
        self.on_frame = on_frame
        
        # FFmpeg进程
        self.process: Optional[subprocess.Popen] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._running = False
        
        # 编码器选择
        self.codec = self._detect_best_codec()
        
        # 时间戳管理
        self._frame_count = 0
        self._start_time = None
        
        # SPS/PPS缓存
        self.sps: Optional[bytes] = None
        self.pps: Optional[bytes] = None
        self.init_data: Optional[bytes] = None
        
        # 性能统计
        self.stats = {
            'total_frames': 0,
            'keyframes': 0,
            'total_bytes': 0,
            'encoding_errors': 0,
            'avg_frame_size': 0
        }
        
        LOGGER.info(f"🎬 H.264编码器初始化: {width}x{height}@{fps}fps, 码率:{bitrate/1000000}Mbps")
        LOGGER.info(f"🔧 选择编码器: {self.codec.value}")
    
    def _detect_best_codec(self) -> H264Codec:
        """自动检测最佳硬件编码器"""
        system = platform.system()
        
        LOGGER.info(f"🔍 检测平台: {system}")
        
        if system == 'Darwin':  # macOS
            if self._check_encoder('h264_videotoolbox'):
                LOGGER.info("✅ 使用VideoToolbox硬件编码")
                return H264Codec.VIDEOTOOLBOX
        
        elif system == 'Linux':
            # 优先级: NVENC > VAAPI > 软件
            if self._check_encoder('h264_nvenc'):
                LOGGER.info("✅ 使用NVIDIA NVENC硬件编码")
                return H264Codec.NVENC
            elif self._check_encoder('h264_vaapi'):
                LOGGER.info("✅ 使用VAAPI硬件编码")
                return H264Codec.VAAPI
        
        elif system == 'Windows':
            if self._check_encoder('h264_nvenc'):
                LOGGER.info("✅ 使用NVIDIA NVENC硬件编码")
                return H264Codec.NVENC
            elif self._check_encoder('h264_qsv'):
                LOGGER.info("✅ 使用Intel QSV硬件编码")
                return H264Codec.QSV
        
        LOGGER.warning("⚠️ 无硬件编码器，使用x264软件编码")
        return H264Codec.X264
    
    def _check_encoder(self, encoder: str) -> bool:
        """检查FFmpeg是否支持指定编码器"""
        try:
            result = subprocess.run(
                ['ffmpeg', '-encoders'],
                capture_output=True,
                text=True,
                timeout=3
            )
            return encoder in result.stdout
        except Exception as e:
            LOGGER.debug(f"检查编码器失败 {encoder}: {e}")
            return False
    
    async def start(self):
        """启动编码器"""
        if self._running:
            LOGGER.warning("编码器已在运行")
            return
        
        LOGGER.info("🚀 启动H.264编码进程...")
        
        # 构建FFmpeg命令
        cmd = self._build_ffmpeg_command()
        LOGGER.info(f"FFmpeg命令: {' '.join(cmd)}")
        
        try:
            # 启动FFmpeg进程
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            self._running = True
            self._start_time = time.time()
            
            # 启动输出读取任务
            self._reader_task = asyncio.create_task(self._read_h264_stream())
            
            # 启动错误日志读取
            asyncio.create_task(self._read_stderr())
            
            LOGGER.info("✅ H.264编码器已启动")
            
        except Exception as e:
            LOGGER.error(f"❌ 启动编码器失败: {e}")
            raise
    
    def _build_ffmpeg_command(self) -> list:
        """构建FFmpeg命令行"""
        cmd = [
            'ffmpeg',
            '-loglevel', 'warning',
            
            # 输入配置
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-pix_fmt', 'rgb24',
            '-s', f'{self.width}x{self.height}',
            '-r', str(self.fps),
            '-i', '-',  # 从stdin读取
            
            # 编码器选择
            '-c:v', self.codec.value,
        ]
        
        # 编码器特定参数
        if self.codec == H264Codec.VIDEOTOOLBOX:
            # macOS VideoToolbox
            cmd.extend([
                '-profile:v', self.profile.value,
                '-b:v', str(self.bitrate),
                '-maxrate', str(int(self.bitrate * 1.2)),
                '-bufsize', str(int(self.bitrate * 2)),
                '-g', str(self.fps * 2),  # GOP size: 2秒
                '-keyint_min', str(self.fps),
                '-realtime', '1',
            ])
        
        elif self.codec == H264Codec.NVENC:
            # NVIDIA NVENC
            cmd.extend([
                '-preset', 'p1',  # NVENC preset (p1=fastest)
                '-tune', 'll',    # Low latency
                '-profile:v', self.profile.value,
                '-b:v', str(self.bitrate),
                '-maxrate', str(int(self.bitrate * 1.2)),
                '-bufsize', str(int(self.bitrate * 2)),
                '-g', str(self.fps * 2),
                '-zerolatency', '1',
            ])
        
        elif self.codec == H264Codec.QSV:
            # Intel Quick Sync
            cmd.extend([
                '-preset', 'veryfast',
                '-profile:v', self.profile.value,
                '-b:v', str(self.bitrate),
                '-maxrate', str(int(self.bitrate * 1.2)),
                '-bufsize', str(int(self.bitrate * 2)),
                '-g', str(self.fps * 2),
                '-look_ahead', '0',
            ])
        
        elif self.codec == H264Codec.VAAPI:
            # VAAPI
            cmd.extend([
                '-profile:v', self.profile.value,
                '-b:v', str(self.bitrate),
                '-maxrate', str(int(self.bitrate * 1.2)),
                '-bufsize', str(int(self.bitrate * 2)),
                '-g', str(self.fps * 2),
            ])
        
        else:  # X264软件编码
            cmd.extend([
                '-preset', self.preset.value,
                '-tune', 'zerolatency',
                '-profile:v', self.profile.value,
                '-b:v', str(self.bitrate),
                '-maxrate', str(int(self.bitrate * 1.2)),
                '-bufsize', str(int(self.bitrate * 2)),
                '-g', str(self.fps * 2),
                '-keyint_min', str(self.fps),
                '-x264-params', 'nal-hrd=cbr:force-cfr=1',
            ])
        
        # 输出配置
        cmd.extend([
            '-f', 'h264',      # 原始H.264流
            '-flags', '+cgop', # 封闭GOP
            '-'                # 输出到stdout
        ])
        
        return cmd
    
    async def encode_frame(self, rgb_data: bytes):
        """
        编码一帧
        
        Args:
            rgb_data: RGB24格式的原始帧数据
        """
        if not self._running or not self.process or not self.process.stdin:
            LOGGER.warning("编码器未运行")
            return
        
        try:
            # 写入原始帧数据
            self.process.stdin.write(rgb_data)
            await self.process.stdin.drain()
            
            self._frame_count += 1
            
        except Exception as e:
            LOGGER.error(f"❌ 编码帧失败: {e}")
            self.stats['encoding_errors'] += 1
    
    async def _read_h264_stream(self):
        """读取H.264编码输出"""
        LOGGER.info("📖 开始读取H.264流...")
        
        buffer = bytearray()
        nal_start_code = b'\x00\x00\x00\x01'
        
        try:
            while self._running and self.process and self.process.stdout:
                # 读取数据块
                chunk = await self.process.stdout.read(65536)
                if not chunk:
                    break
                
                buffer.extend(chunk)
                
                # 解析NAL units
                while len(buffer) > 4:
                    # 查找起始码
                    start_idx = buffer.find(nal_start_code)
                    if start_idx == -1:
                        break
                    
                    # 查找下一个起始码
                    next_idx = buffer.find(nal_start_code, start_idx + 4)
                    
                    if next_idx == -1:
                        # 没有下一个起始码，继续读取
                        break
                    
                    # 提取NAL unit
                    nal_unit = bytes(buffer[start_idx:next_idx])
                    buffer = buffer[next_idx:]
                    
                    # 处理NAL unit
                    await self._process_nal_unit(nal_unit)
        
        except asyncio.CancelledError:
            LOGGER.info("H.264流读取被取消")
        except Exception as e:
            LOGGER.error(f"❌ 读取H.264流失败: {e}")
        finally:
            LOGGER.info("📖 H.264流读取结束")
    
    async def _process_nal_unit(self, nal_unit: bytes):
        """处理NAL unit"""
        if len(nal_unit) < 5:
            return
        
        # 解析NAL类型
        nal_type = nal_unit[4] & 0x1F
        
        # 提取SPS/PPS
        if nal_type == 7:  # SPS
            self.sps = nal_unit
            LOGGER.info(f"📦 提取SPS: {len(nal_unit)} bytes")
        elif nal_type == 8:  # PPS
            self.pps = nal_unit
            LOGGER.info(f"📦 提取PPS: {len(nal_unit)} bytes")
            # SPS和PPS都有了，生成init_data
            if self.sps and self.pps:
                self.init_data = self.sps + self.pps
                LOGGER.info(f"✅ 初始化数据准备完成: {len(self.init_data)} bytes")
        
        # 判断是否为关键帧
        is_keyframe = nal_type == 5  # IDR帧
        
        # 生成PTS
        pts = self._generate_pts()
        
        # 统计
        self.stats['total_frames'] += 1
        self.stats['total_bytes'] += len(nal_unit)
        if is_keyframe:
            self.stats['keyframes'] += 1
        
        if self.stats['total_frames'] > 0:
            self.stats['avg_frame_size'] = self.stats['total_bytes'] // self.stats['total_frames']
        
        # 回调
        if self.on_frame:
            try:
                await self.on_frame(nal_unit, pts, is_keyframe)
            except Exception as e:
                LOGGER.error(f"❌ 帧回调失败: {e}")
    
    def _generate_pts(self) -> int:
        """生成演示时间戳（微秒）"""
        if self._start_time is None:
            self._start_time = time.time()
        
        elapsed = time.time() - self._start_time
        pts = int(elapsed * 1_000_000)
        return pts
    
    async def _read_stderr(self):
        """读取FFmpeg错误输出"""
        try:
            while self._running and self.process and self.process.stderr:
                line = await self.process.stderr.readline()
                if not line:
                    break
                
                line_str = line.decode('utf-8', errors='ignore').strip()
                if line_str:
                    # 过滤掉一些噪音日志
                    if 'deprecated' not in line_str.lower():
                        LOGGER.debug(f"[FFmpeg] {line_str}")
        except Exception as e:
            LOGGER.debug(f"读取stderr失败: {e}")
    
    async def stop(self):
        """停止编码器"""
        if not self._running:
            return
        
        LOGGER.info("🛑 停止H.264编码器...")
        
        self._running = False
        
        # 关闭stdin
        if self.process and self.process.stdin:
            try:
                self.process.stdin.close()
                await self.process.stdin.wait_closed()
            except Exception as e:
                LOGGER.debug(f"关闭stdin失败: {e}")
        
        # 取消读取任务
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
        
        # 终止进程
        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                LOGGER.warning("FFmpeg未响应，强制终止")
                self.process.kill()
                await self.process.wait()
            except Exception as e:
                LOGGER.error(f"停止进程失败: {e}")
        
        # 打印统计
        LOGGER.info(f"📊 编码统计: 总帧数={self.stats['total_frames']}, "
                   f"关键帧={self.stats['keyframes']}, "
                   f"平均帧大小={self.stats['avg_frame_size']} bytes, "
                   f"错误={self.stats['encoding_errors']}")
        
        LOGGER.info("✅ H.264编码器已停止")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取编码统计信息"""
        return {
            **self.stats,
            'codec': self.codec.value,
            'resolution': f'{self.width}x{self.height}',
            'fps': self.fps,
            'bitrate': self.bitrate,
            'running': self._running
        }
