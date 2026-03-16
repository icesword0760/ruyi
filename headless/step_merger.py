"""
步骤智能合并器 - V5

功能：
1. 合并连续输入事件
2. 去除重复点击
3. 合并短时间内的相似操作
4. 延迟flush机制
"""

import asyncio
import logging
import time
from typing import Dict, Optional, Any, Callable
from dataclasses import dataclass, field

LOGGER = logging.getLogger(__name__)


@dataclass
class PendingStep:
    """待处理的步骤"""
    step: Dict[str, Any]
    timer: Optional[asyncio.Task] = None
    created_at: float = field(default_factory=time.time)


class StepMerger:
    """
    步骤智能合并器
    
    合并策略：
    1. 连续输入 → 合并为一个fill操作
    2. 重复点击（1秒内） → 去重
    3. 连续滚动 → 合并为一个scroll
    """
    
    def __init__(self, flush_delay: float = 2.0):
        """
        Args:
            flush_delay: 延迟flush时间（秒）
        """
        self.flush_delay = flush_delay
        
        # Pending步骤
        self.pending_input: Optional[PendingStep] = None
        self.pending_scroll: Optional[PendingStep] = None
        
        # 去重
        self.last_click: Optional[Dict] = None
        self.last_click_time: float = 0
        self.click_dedupe_window = 1.0  # 1秒内的重复点击去重
        
        LOGGER.info("✅ 步骤合并器已初始化 (flush_delay=%.1fs)", flush_delay)
    
    async def process_step(
        self,
        step: Dict[str, Any],
        flush_callback: Callable
    ) -> Optional[Dict[str, Any]]:
        """
        处理步骤，决定是否立即返回或延迟合并
        
        Args:
            step: 要处理的步骤
            flush_callback: 当步骤需要flush时的回调 async def flush_callback(step)
            
        Returns:
            如果返回步骤，则应该立即广播
            如果返回None，则步骤被pending或丢弃
        """
        step_type = step.get('type')
        
        if step_type == 'input':
            return await self._handle_input_merge(step, flush_callback)
        
        elif step_type == 'scroll':
            return await self._handle_scroll_merge(step, flush_callback)
        
        elif step_type == 'click':
            return await self._handle_click_dedup(step, flush_callback)
        
        else:
            # 其他类型直接返回，但先flush pending步骤
            await self._flush_all(flush_callback)
            return step
    
    async def _handle_input_merge(
        self,
        step: Dict,
        flush_callback: Callable
    ) -> Optional[Dict]:
        """合并连续输入"""
        # 获取目标选择器（用于判断是否同一个输入框）
        selectors = step.get('selectors', [])
        target_selector = selectors[0] if selectors else ''
        
        # 如果是同一个输入框
        if (self.pending_input and 
            self._get_step_selector(self.pending_input.step) == target_selector):
            
            # 更新值和时间戳
            self.pending_input.step['value'] = step['value']
            self.pending_input.step['timestamp'] = step['timestamp']
            self.pending_input.step['_merge_count'] = self.pending_input.step.get('_merge_count', 1) + 1
            
            # 取消旧timer
            if self.pending_input.timer:
                self.pending_input.timer.cancel()
            
            # 创建新timer
            self.pending_input.timer = asyncio.create_task(
                self._flush_input_after_delay(flush_callback)
            )
            
            LOGGER.debug(f"合并输入: {step['value'][:20]}... (合并次数: {self.pending_input.step.get('_merge_count', 1)})")
            return None  # 不立即返回
        
        else:
            # 不同输入框，先flush旧的
            old_step = await self._flush_pending_input(flush_callback)
            
            # 开始新的pending
            self.pending_input = PendingStep(
                step=step,
                timer=asyncio.create_task(
                    self._flush_input_after_delay(flush_callback)
                )
            )
            
            return old_step  # 返回旧步骤（如果有）
    
    async def _handle_scroll_merge(
        self,
        step: Dict,
        flush_callback: Callable
    ) -> Optional[Dict]:
        """合并连续滚动"""
        if self.pending_scroll:
            # 更新滚动位置
            self.pending_scroll.step['scrollX'] = step['scrollX']
            self.pending_scroll.step['scrollY'] = step['scrollY']
            self.pending_scroll.step['timestamp'] = step['timestamp']
            self.pending_scroll.step['_merge_count'] = self.pending_scroll.step.get('_merge_count', 1) + 1
            
            # 取消旧timer
            if self.pending_scroll.timer:
                self.pending_scroll.timer.cancel()
            
            # 创建新timer
            self.pending_scroll.timer = asyncio.create_task(
                self._flush_scroll_after_delay(flush_callback)
            )
            
            LOGGER.debug(f"合并滚动: ({step['scrollX']}, {step['scrollY']})")
            return None
        
        else:
            # 开始新的pending
            self.pending_scroll = PendingStep(
                step=step,
                timer=asyncio.create_task(
                    self._flush_scroll_after_delay(flush_callback)
                )
            )
            return None
    
    async def _handle_click_dedup(
        self,
        step: Dict,
        flush_callback: Callable
    ) -> Optional[Dict]:
        """去重点击（防止误触发双击被记录为两次单击）"""
        current_time = time.time()
        selectors = step.get('selectors', [])
        selector = selectors[0] if selectors else ''
        
        # 检查是否是重复点击（dedup_window内同一目标）
        if self.last_click:
            time_diff = current_time - self.last_click_time
            last_selector = self._get_step_selector(self.last_click)
            same_target = last_selector == selector
            
            if time_diff < self.click_dedupe_window and same_target:
                LOGGER.debug(f"过滤重复点击: {selector} (时间差: {time_diff:.3f}s)")
                return None  # 丢弃重复点击
        
        # 先flush其他pending
        await self._flush_all(flush_callback)
        
        # 记录最后点击
        self.last_click = step
        self.last_click_time = current_time
        
        return step
    
    async def _flush_input_after_delay(self, flush_callback: Callable):
        """延迟flush输入"""
        try:
            await asyncio.sleep(self.flush_delay)
            await self._flush_pending_input(flush_callback)
        except asyncio.CancelledError:
            # Timer被取消，正常情况
            pass
    
    async def _flush_scroll_after_delay(self, flush_callback: Callable):
        """延迟flush滚动"""
        try:
            await asyncio.sleep(self.flush_delay)
            await self._flush_pending_scroll(flush_callback)
        except asyncio.CancelledError:
            pass
    
    async def _flush_pending_input(self, flush_callback: Callable) -> Optional[Dict]:
        """Flush pending输入"""
        if self.pending_input:
            step = self.pending_input.step
            if self.pending_input.timer:
                self.pending_input.timer.cancel()
            self.pending_input = None
            
            merge_count = step.get('_merge_count', 1)
            LOGGER.info(f"Flush输入步骤: {step['value'][:20]}... (合并了{merge_count}次)")
            
            # 添加元数据
            if '_metadata' in step:
                step['_metadata']['merged_count'] = merge_count
            
            await flush_callback(step)
            return step
        return None
    
    async def _flush_pending_scroll(self, flush_callback: Callable) -> Optional[Dict]:
        """Flush pending滚动"""
        if self.pending_scroll:
            step = self.pending_scroll.step
            if self.pending_scroll.timer:
                self.pending_scroll.timer.cancel()
            self.pending_scroll = None
            
            merge_count = step.get('_merge_count', 1)
            LOGGER.info(f"Flush滚动步骤: ({step['scrollX']}, {step['scrollY']}) (合并了{merge_count}次)")
            
            if '_metadata' in step:
                step['_metadata']['merged_count'] = merge_count
            
            await flush_callback(step)
            return step
        return None
    
    async def _flush_all(self, flush_callback: Callable):
        """Flush所有pending步骤"""
        await self._flush_pending_input(flush_callback)
        await self._flush_pending_scroll(flush_callback)
    
    async def flush_on_stop(self, flush_callback: Callable):
        """停止录制时flush所有pending"""
        LOGGER.info("录制停止，flush所有pending步骤")
        await self._flush_all(flush_callback)
    
    def _get_step_selector(self, step: Dict) -> str:
        """获取步骤的主选择器"""
        selectors = step.get('selectors', [])
        if isinstance(selectors, list) and selectors:
            return selectors[0]
        return ''
    
    def reset(self):
        """重置合并器状态"""
        if self.pending_input and self.pending_input.timer:
            self.pending_input.timer.cancel()
        if self.pending_scroll and self.pending_scroll.timer:
            self.pending_scroll.timer.cancel()
        
        self.pending_input = None
        self.pending_scroll = None
        self.last_click = None
        self.last_click_time = 0
        
        LOGGER.debug("步骤合并器已重置")
