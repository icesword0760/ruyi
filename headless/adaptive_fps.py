"""
增强自适应FPS控制器
根据画面变化动态调整帧率，降低静态场景的CPU和带宽消耗

策略：
- Active (30fps): 画面持续变化
- Slow (15fps): 画面缓慢变化  
- Static (5fps): 画面基本静止
- Frozen (1fps): 画面完全静止
"""
import logging
import time
from typing import Dict, Any
from enum import Enum

LOGGER = logging.getLogger(__name__)


class FPSLevel(Enum):
    """FPS等级"""
    ACTIVE = "active"      # 活跃：30fps
    SLOW = "slow"          # 慢速：15fps
    STATIC = "static"      # 静态：5fps
    FROZEN = "frozen"      # 冻结：1fps


class EnhancedAdaptiveFPS:
    """
    增强自适应FPS控制器
    
    原理：
    1. 检测画面变化（通过帧哈希对比）
    2. 根据连续无变化帧数，逐级降低FPS
    3. 画面恢复变化时，立即恢复到最高FPS
    
    收益：
    - 静态场景（如文档浏览）：CPU降低70-90%
    - 动态场景（如视频播放）：保持高FPS无影响
    """
    
    def __init__(
        self,
        active_fps: int = 30,
        slow_fps: int = 15,
        static_fps: int = 5,
        frozen_fps: int = 1
    ):
        """
        初始化自适应FPS控制器
        
        Args:
            active_fps: 活跃场景FPS
            slow_fps: 慢速变化FPS
            static_fps: 静态场景FPS
            frozen_fps: 冻结场景FPS
        """
        self.fps_levels = {
            FPSLevel.ACTIVE: active_fps,
            FPSLevel.SLOW: slow_fps,
            FPSLevel.STATIC: static_fps,
            FPSLevel.FROZEN: frozen_fps
        }
        
        self.current_level = FPSLevel.ACTIVE
        self.no_change_count = 0
        
        # 降级阈值（帧数）
        self.thresholds = {
            FPSLevel.SLOW: 30,      # 1秒无变化 (30帧@30fps)
            FPSLevel.STATIC: 60,    # 2秒无变化
            FPSLevel.FROZEN: 90     # 3秒无变化
        }
        
        # 统计信息
        self.stats = {
            'total_frames': 0,
            'changed_frames': 0,
            'active_frames': 0,
            'slow_frames': 0,
            'static_frames': 0,
            'frozen_frames': 0,
            'level_switches': 0,
            'last_switch_time': 0
        }
        
        # 性能统计
        self.level_start_time = time.time()
        self.level_frame_count = 0
        
        LOGGER.info(f"🎬 EnhancedAdaptiveFPS初始化: {active_fps}/{slow_fps}/{static_fps}/{frozen_fps}fps")
    
    def get_sleep_time(self, frame_changed: bool) -> float:
        """
        获取下一帧的等待时间
        
        Args:
            frame_changed: 当前帧是否有变化
            
        Returns:
            float: 睡眠时间（秒）
        """
        self.stats['total_frames'] += 1
        
        # 更新变化计数
        if frame_changed:
            if self.no_change_count > 0:
                # 从静止恢复到活跃
                LOGGER.info(f"🎬 画面恢复动态 (静止了{self.no_change_count}帧)")
            
            self.stats['changed_frames'] += 1
            self.no_change_count = 0
            
            # 立即切换到最高FPS
            if self.current_level != FPSLevel.ACTIVE:
                self._switch_level(FPSLevel.ACTIVE)
        else:
            self.no_change_count += 1
            
            # 根据无变化帧数，逐级降低FPS
            old_level = self.current_level
            
            if self.no_change_count >= self.thresholds[FPSLevel.FROZEN]:
                new_level = FPSLevel.FROZEN
            elif self.no_change_count >= self.thresholds[FPSLevel.STATIC]:
                new_level = FPSLevel.STATIC
            elif self.no_change_count >= self.thresholds[FPSLevel.SLOW]:
                new_level = FPSLevel.SLOW
            else:
                new_level = FPSLevel.ACTIVE
            
            if new_level != old_level:
                self._switch_level(new_level)
        
        # 更新等级统计
        self.level_frame_count += 1
        if self.current_level == FPSLevel.ACTIVE:
            self.stats['active_frames'] += 1
        elif self.current_level == FPSLevel.SLOW:
            self.stats['slow_frames'] += 1
        elif self.current_level == FPSLevel.STATIC:
            self.stats['static_frames'] += 1
        elif self.current_level == FPSLevel.FROZEN:
            self.stats['frozen_frames'] += 1
        
        # 计算睡眠时间
        fps = self.fps_levels[self.current_level]
        sleep_time = 1.0 / fps
        
        return sleep_time
    
    def _switch_level(self, new_level: FPSLevel):
        """切换FPS等级"""
        old_level = self.current_level
        old_fps = self.fps_levels[old_level]
        new_fps = self.fps_levels[new_level]
        
        # 计算当前等级的实际FPS
        elapsed = time.time() - self.level_start_time
        actual_fps = self.level_frame_count / elapsed if elapsed > 0 else 0
        
        LOGGER.info(
            f"📊 FPS切换: {old_level.value}({old_fps}fps) → {new_level.value}({new_fps}fps) "
            f"(实际={actual_fps:.1f}fps, 帧数={self.level_frame_count})"
        )
        
        self.current_level = new_level
        self.stats['level_switches'] += 1
        self.stats['last_switch_time'] = time.time()
        
        # 重置等级统计
        self.level_start_time = time.time()
        self.level_frame_count = 0
    
    def get_current_fps(self) -> int:
        """获取当前FPS设置"""
        return self.fps_levels[self.current_level]
    
    def get_current_level(self) -> FPSLevel:
        """获取当前FPS等级"""
        return self.current_level
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        total_frames = self.stats['total_frames']
        
        return {
            **self.stats,
            'current_level': self.current_level.value,
            'current_fps': self.fps_levels[self.current_level],
            'no_change_count': self.no_change_count,
            'change_rate': self.stats['changed_frames'] / total_frames if total_frames > 0 else 0,
            'active_rate': self.stats['active_frames'] / total_frames if total_frames > 0 else 0,
            'slow_rate': self.stats['slow_frames'] / total_frames if total_frames > 0 else 0,
            'static_rate': self.stats['static_frames'] / total_frames if total_frames > 0 else 0,
            'frozen_rate': self.stats['frozen_frames'] / total_frames if total_frames > 0 else 0
        }
    
    def print_stats(self):
        """打印统计信息"""
        stats = self.get_stats()
        
        LOGGER.info("📊 自适应FPS统计:")
        LOGGER.info(f"  当前等级: {stats['current_level']} ({stats['current_fps']}fps)")
        LOGGER.info(f"  总帧数: {stats['total_frames']}")
        LOGGER.info(f"  变化率: {stats['change_rate']*100:.1f}%")
        LOGGER.info(f"  FPS分布:")
        LOGGER.info(f"    Active (30fps): {stats['active_rate']*100:.1f}%")
        LOGGER.info(f"    Slow (15fps):   {stats['slow_rate']*100:.1f}%")
        LOGGER.info(f"    Static (5fps):  {stats['static_rate']*100:.1f}%")
        LOGGER.info(f"    Frozen (1fps):  {stats['frozen_rate']*100:.1f}%")
        LOGGER.info(f"  等级切换次数: {stats['level_switches']}")
        
        # 计算CPU节省估算
        avg_fps = (
            stats['active_rate'] * 30 +
            stats['slow_rate'] * 15 +
            stats['static_rate'] * 5 +
            stats['frozen_rate'] * 1
        )
        cpu_saving = (1 - avg_fps / 30) * 100 if avg_fps < 30 else 0
        LOGGER.info(f"  平均FPS: {avg_fps:.1f}")
        LOGGER.info(f"  CPU节省估算: {cpu_saving:.1f}%")
    
    def reset_stats(self):
        """重置统计信息"""
        self.stats = {
            'total_frames': 0,
            'changed_frames': 0,
            'active_frames': 0,
            'slow_frames': 0,
            'static_frames': 0,
            'frozen_frames': 0,
            'level_switches': 0,
            'last_switch_time': 0
        }
        self.level_start_time = time.time()
        self.level_frame_count = 0
        LOGGER.info("🔄 自适应FPS统计已重置")
