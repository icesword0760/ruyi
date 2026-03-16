"""
自适应质量控制器
根据实际FPS动态调整JPEG质量和CDP截图参数

目标：
- FPS低：降低质量以提升速度
- FPS高：提升质量以改善画面
"""
import logging
import time
from typing import Dict, Any
from collections import deque

LOGGER = logging.getLogger(__name__)


class AdaptiveQualityController:
    """
    自适应质量控制器
    
    原理：
    1. 监控实际FPS与目标FPS的差距
    2. FPS不足时：降低质量、启用速度优化
    3. FPS充裕时：提升质量、禁用速度优化
    
    收益：
    - 动态场景保持流畅：牺牲质量换取FPS
    - 静态场景提升画质：利用余量提升质量
    """
    
    def __init__(
        self,
        target_fps: int = 30,
        min_quality: int = 70,
        max_quality: int = 98,
        adjustment_interval: float = 5.0
    ):
        """
        初始化自适应质量控制器
        
        Args:
            target_fps: 目标FPS
            min_quality: 最低质量
            max_quality: 最高质量
            adjustment_interval: 调整间隔（秒）
        """
        self.target_fps = target_fps
        self.min_quality = min_quality
        self.max_quality = max_quality
        self.adjustment_interval = adjustment_interval
        
        # 当前设置
        self.current_quality = 90  # 初始质量
        self.optimize_for_speed = False  # 是否优化速度
        
        # FPS历史（用于平滑调整）
        self.fps_history = deque(maxlen=10)
        
        # 上次调整时间
        self.last_adjustment_time = 0
        
        # 统计信息
        self.stats = {
            'adjustments': 0,
            'quality_increases': 0,
            'quality_decreases': 0,
            'speed_mode_enabled': 0,
            'speed_mode_disabled': 0,
            'avg_quality': 0,
            'total_quality': 0,
            'measurement_count': 0
        }
        
        LOGGER.info(
            f"🎨 AdaptiveQualityController初始化: "
            f"target={target_fps}fps, quality={min_quality}-{max_quality}"
        )
    
    def adjust_quality(self, actual_fps: float) -> Dict[str, Any]:
        """
        根据实际FPS调整质量
        
        Args:
            actual_fps: 实际测得的FPS
            
        Returns:
            dict: CDP截图参数 {"quality": int, "optimizeForSpeed": bool}
        """
        # 添加到历史
        self.fps_history.append(actual_fps)
        self.stats['measurement_count'] += 1
        self.stats['total_quality'] += self.current_quality
        self.stats['avg_quality'] = self.stats['total_quality'] / self.stats['measurement_count']
        
        # 检查是否需要调整
        now = time.time()
        if now - self.last_adjustment_time < self.adjustment_interval:
            # 还没到调整时间
            return self._get_current_settings()
        
        # 计算平均FPS
        if len(self.fps_history) < 3:
            # 数据不足，不调整
            return self._get_current_settings()
        
        avg_fps = sum(self.fps_history) / len(self.fps_history)
        
        # 计算FPS偏差（-1到1之间）
        fps_ratio = avg_fps / self.target_fps
        
        old_quality = self.current_quality
        old_speed_mode = self.optimize_for_speed
        
        # 🔥 调整策略
        if fps_ratio < 0.8:
            # FPS严重不足（<80%）：激进降低质量
            self.current_quality = max(self.min_quality, self.current_quality - 10)
            self.optimize_for_speed = True
            
            if self.current_quality != old_quality:
                self.stats['quality_decreases'] += 1
            if self.optimize_for_speed and not old_speed_mode:
                self.stats['speed_mode_enabled'] += 1
                
            LOGGER.info(
                f"⚡ FPS不足({avg_fps:.1f}/{self.target_fps}), "
                f"降低质量: {old_quality} → {self.current_quality}, 速度优化: ON"
            )
            
        elif fps_ratio < 0.9:
            # FPS略微不足（80-90%）：温和降低质量
            self.current_quality = max(self.min_quality, self.current_quality - 5)
            self.optimize_for_speed = True
            
            if self.current_quality != old_quality:
                self.stats['quality_decreases'] += 1
            if self.optimize_for_speed and not old_speed_mode:
                self.stats['speed_mode_enabled'] += 1
                
            LOGGER.info(
                f"⚡ FPS略低({avg_fps:.1f}/{self.target_fps}), "
                f"微调质量: {old_quality} → {self.current_quality}"
            )
            
        elif fps_ratio > 1.2:
            # FPS充裕（>120%）：激进提升质量
            self.current_quality = min(self.max_quality, self.current_quality + 5)
            self.optimize_for_speed = False
            
            if self.current_quality != old_quality:
                self.stats['quality_increases'] += 1
            if not self.optimize_for_speed and old_speed_mode:
                self.stats['speed_mode_disabled'] += 1
                
            LOGGER.info(
                f"🎨 FPS充裕({avg_fps:.1f}/{self.target_fps}), "
                f"提升质量: {old_quality} → {self.current_quality}, 速度优化: OFF"
            )
            
        elif fps_ratio > 1.1:
            # FPS略有余量（110-120%）：温和提升质量
            self.current_quality = min(self.max_quality, self.current_quality + 2)
            self.optimize_for_speed = False
            
            if self.current_quality != old_quality:
                self.stats['quality_increases'] += 1
            if not self.optimize_for_speed and old_speed_mode:
                self.stats['speed_mode_disabled'] += 1
                
            LOGGER.debug(
                f"🎨 FPS略高({avg_fps:.1f}/{self.target_fps}), "
                f"微调质量: {old_quality} → {self.current_quality}"
            )
        else:
            # FPS适中（90-110%）：保持当前设置
            pass
        
        # 记录调整
        if self.current_quality != old_quality or self.optimize_for_speed != old_speed_mode:
            self.stats['adjustments'] += 1
            self.last_adjustment_time = now
        
        return self._get_current_settings()
    
    def _get_current_settings(self) -> Dict[str, Any]:
        """获取当前CDP截图参数"""
        return {
            "quality": self.current_quality,
            "optimizeForSpeed": self.optimize_for_speed,
            "fromSurface": True,  # 始终从渲染表面捕获
            "captureBeyondViewport": False
        }
    
    def get_quality(self) -> int:
        """获取当前质量"""
        return self.current_quality
    
    def is_speed_optimized(self) -> bool:
        """是否启用速度优化"""
        return self.optimize_for_speed
    
    def force_quality(self, quality: int):
        """强制设置质量"""
        self.current_quality = max(self.min_quality, min(self.max_quality, quality))
        LOGGER.info(f"🔧 强制设置质量: {self.current_quality}")
    
    def force_speed_mode(self, enable: bool):
        """强制设置速度模式"""
        self.optimize_for_speed = enable
        LOGGER.info(f"🔧 强制设置速度优化: {enable}")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self.stats,
            'current_quality': self.current_quality,
            'optimize_for_speed': self.optimize_for_speed,
            'target_fps': self.target_fps,
            'recent_avg_fps': sum(self.fps_history) / len(self.fps_history) if self.fps_history else 0
        }
    
    def print_stats(self):
        """打印统计信息"""
        stats = self.get_stats()
        
        LOGGER.info("📊 自适应质量统计:")
        LOGGER.info(f"  当前质量: {stats['current_quality']}")
        LOGGER.info(f"  速度优化: {'ON' if stats['optimize_for_speed'] else 'OFF'}")
        LOGGER.info(f"  目标FPS: {stats['target_fps']}")
        LOGGER.info(f"  最近平均FPS: {stats['recent_avg_fps']:.1f}")
        LOGGER.info(f"  平均质量: {stats['avg_quality']:.1f}")
        LOGGER.info(f"  调整次数: {stats['adjustments']}")
        LOGGER.info(f"    质量提升: {stats['quality_increases']}")
        LOGGER.info(f"    质量降低: {stats['quality_decreases']}")
        LOGGER.info(f"    速度模式启用: {stats['speed_mode_enabled']}")
        LOGGER.info(f"    速度模式禁用: {stats['speed_mode_disabled']}")
    
    def reset_stats(self):
        """重置统计信息"""
        self.stats = {
            'adjustments': 0,
            'quality_increases': 0,
            'quality_decreases': 0,
            'speed_mode_enabled': 0,
            'speed_mode_disabled': 0,
            'avg_quality': 0,
            'total_quality': 0,
            'measurement_count': 0
        }
        self.fps_history.clear()
        self.last_adjustment_time = 0
        LOGGER.info("🔄 自适应质量统计已重置")
