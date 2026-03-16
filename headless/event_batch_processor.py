"""
事件批处理器 - 通用模块
用于MJPEG和WebRTC模式，批量处理控制事件以减少CDP往返延迟

核心优化：
- 10ms批处理窗口
- 异步并发发送
- 队列大小限制防止积压
- 详细性能统计
"""
import asyncio
import logging
import time
from typing import Optional, Dict, Any, Callable
from collections import deque

LOGGER = logging.getLogger(__name__)


class EventBatchProcessor:
    """
    事件批处理器
    
    原理：
    1. 收集短时间窗口（10ms）内的多个事件
    2. 批量并发发送到CDP，而不是逐个发送
    3. 显著减少CDP往返次数和延迟
    
    示例：
        处理10个连续鼠标移动事件
        - 不使用批处理：10次CDP调用 = 10 * 40ms = 400ms
        - 使用批处理：1次并发调用 = 40ms
        - 延迟减少：90%
    """
    
    def __init__(
        self,
        cdp_client,
        batch_size: int = 20,        # 🔥 修正：合理批次
        batch_interval: float = 0.005,  # 🔥 修正：5ms快速响应
        queue_maxsize: int = 200      # ✅ 保留：增大队列
    ):
        """
        初始化批处理器
        
        Args:
            cdp_client: CDP客户端实例
            batch_size: 最大批处理大小
            batch_interval: 批处理时间窗口（秒）
            queue_maxsize: 事件队列最大大小
        """
        self.cdp_client = cdp_client
        self.batch_size = batch_size
        self.batch_interval = batch_interval
        
        # 事件队列
        self.event_queue = asyncio.Queue(maxsize=queue_maxsize)
        
        # 处理循环任务
        self.processing_task: Optional[asyncio.Task] = None
        self.running = False
        
        # 性能统计
        self.stats = {
            'events_received': 0,
            'events_processed': 0,
            'events_dropped': 0,
            'batches_sent': 0,
            'total_batch_size': 0,
            'avg_batch_size': 0,
            'max_batch_size': 0,
            'total_process_time': 0,
            'avg_process_time': 0,
            'last_batch_time': 0
        }
        
        # 最近批次大小（用于计算平均值）
        self.recent_batch_sizes = deque(maxlen=100)
        self.recent_process_times = deque(maxlen=100)
        
        LOGGER.info(f"🔧 EventBatchProcessor初始化: batch_size={batch_size}, interval={batch_interval}ms")
    
    async def start(self):
        """启动批处理循环"""
        if self.running:
            LOGGER.warning("⚠️  批处理器已在运行")
            return
        
        self.running = True
        self.processing_task = asyncio.create_task(self._process_loop())
        LOGGER.info("✅ 事件批处理器已启动")
    
    async def stop(self):
        """停止批处理器"""
        if not self.running:
            return
        
        self.running = False
        
        if self.processing_task:
            self.processing_task.cancel()
            try:
                await self.processing_task
            except asyncio.CancelledError:
                pass
            self.processing_task = None
        
        # 处理队列中剩余事件
        remaining_events = []
        while not self.event_queue.empty():
            try:
                event = self.event_queue.get_nowait()
                remaining_events.append(event)
            except asyncio.QueueEmpty:
                break
        
        if remaining_events:
            LOGGER.info(f"🔄 处理队列中剩余的{len(remaining_events)}个事件...")
            await self._process_batch(remaining_events)
        
        LOGGER.info("✅ 事件批处理器已停止")
        self._log_stats()
    
    async def add_event(self, event: Dict[str, Any]) -> bool:
        """
        添加事件到处理队列
        
        Args:
            event: 事件字典
            
        Returns:
            bool: 是否成功添加
        """
        try:
            # 🔥 修复：简化逻辑，移除阻塞性清理
            self.event_queue.put_nowait(event)
            self.stats['events_received'] += 1
            return True
        except asyncio.QueueFull:
            # 队列满，简单丢弃策略
            event_type = event.get('type', '')
            
            # 高频事件直接丢弃
            if event_type in ['mousemove', 'wheel']:
                self.stats['events_dropped'] += 1
                return False
            
            # 重要事件：尝试丢弃最老的事件，为新事件腾空间
            try:
                self.event_queue.get_nowait()  # 丢弃队首事件
                self.event_queue.put_nowait(event)
                self.stats['events_received'] += 1
                self.stats['events_dropped'] += 1
                return True
            except:
                self.stats['events_dropped'] += 1
                return False
    
    async def _process_loop(self):
        """
        批处理主循环
        
        策略：
        1. 设置批处理截止时间（当前时间 + batch_interval）
        2. 在截止时间前收集尽可能多的事件（最多batch_size个）
        3. 到达截止时间或收集满batch_size后，批量处理
        4. 重复
        """
        LOGGER.info("🔄 批处理循环已启动")
        
        while self.running:
            try:
                batch = []
                loop = asyncio.get_event_loop()
                deadline = loop.time() + self.batch_interval
                
                # 收集批次
                while len(batch) < self.batch_size:
                    # 计算剩余时间
                    timeout = deadline - loop.time()
                    if timeout <= 0:
                        # 时间到，立即处理当前批次
                        break
                    
                    try:
                        # 等待新事件，但不超过剩余时间
                        event = await asyncio.wait_for(
                            self.event_queue.get(),
                            timeout=timeout
                        )
                        batch.append(event)
                        
                    except asyncio.TimeoutError:
                        # 超时，批处理窗口结束
                        break
                
                # 如果有事件，批量处理
                if batch:
                    await self._process_batch(batch)
                else:
                    # 没有事件，短暂休眠避免空转
                    await asyncio.sleep(0.001)
                    
            except asyncio.CancelledError:
                LOGGER.info("🛑 批处理循环被取消")
                break
            except Exception as e:
                LOGGER.error(f"❌ 批处理循环错误: {e}", exc_info=True)
                await asyncio.sleep(0.1)  # 错误后短暂休眠
    
    async def _process_batch(self, batch: list):
        """
        批量处理事件
        
        使用asyncio.gather并发发送所有事件到CDP
        
        Args:
            batch: 事件列表
        """
        if not batch:
            return
        
        start_time = time.time()
        batch_size = len(batch)
        
        try:
            # 🔥 关键优化：并发发送所有事件
            tasks = [
                self.cdp_client.dispatch_control_event(event)
                for event in batch
            ]
            
            # 等待所有任务完成
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # 统计成功/失败
            success_count = sum(1 for r in results if not isinstance(r, Exception))
            error_count = batch_size - success_count
            
            if error_count > 0:
                LOGGER.warning(f"⚠️  批次中{error_count}/{batch_size}个事件失败")
                # 记录错误详情
                for i, result in enumerate(results):
                    if isinstance(result, Exception):
                        LOGGER.debug(f"  事件{i}失败: {result}")
            
            # 更新统计
            self.stats['events_processed'] += success_count
            self.stats['batches_sent'] += 1
            self.stats['total_batch_size'] += batch_size
            self.stats['max_batch_size'] = max(self.stats['max_batch_size'], batch_size)
            
            # 记录处理时间
            process_time = time.time() - start_time
            self.stats['total_process_time'] += process_time
            self.stats['last_batch_time'] = process_time
            
            # 更新最近数据
            self.recent_batch_sizes.append(batch_size)
            self.recent_process_times.append(process_time)
            
            # 计算平均值
            if self.recent_batch_sizes:
                self.stats['avg_batch_size'] = sum(self.recent_batch_sizes) / len(self.recent_batch_sizes)
            if self.recent_process_times:
                self.stats['avg_process_time'] = sum(self.recent_process_times) / len(self.recent_process_times)
            
            # 详细日志（仅debug）
            if LOGGER.isEnabledFor(logging.DEBUG):
                LOGGER.debug(
                    f"📦 批次处理完成: {batch_size}个事件, "
                    f"耗时{process_time*1000:.1f}ms, "
                    f"成功{success_count}"
                )
            
        except Exception as e:
            LOGGER.error(f"❌ 批量处理失败: {e}", exc_info=True)
            self.stats['events_dropped'] += batch_size
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取统计信息
        
        Returns:
            dict: 统计数据
        """
        return {
            **self.stats,
            'queue_size': self.event_queue.qsize(),
            'queue_maxsize': self.event_queue.maxsize,
            'running': self.running
        }
    
    def _log_stats(self):
        """打印统计信息"""
        stats = self.get_stats()
        
        LOGGER.info("📊 批处理器统计:")
        LOGGER.info(f"  接收事件: {stats['events_received']}")
        LOGGER.info(f"  处理事件: {stats['events_processed']}")
        LOGGER.info(f"  丢弃事件: {stats['events_dropped']}")
        LOGGER.info(f"  发送批次: {stats['batches_sent']}")
        LOGGER.info(f"  平均批次大小: {stats['avg_batch_size']:.1f}")
        LOGGER.info(f"  最大批次大小: {stats['max_batch_size']}")
        LOGGER.info(f"  平均处理时间: {stats['avg_process_time']*1000:.1f}ms")
        
        if stats['batches_sent'] > 0:
            # 计算效率提升
            without_batch = stats['events_processed'] * 0.04  # 假设单次40ms
            with_batch = stats['total_process_time']
            improvement = (1 - with_batch / without_batch) * 100 if without_batch > 0 else 0
            LOGGER.info(f"  延迟优化: -{improvement:.1f}%")
    
    # 🔥 已移除：_cleanup_high_freq_events() 函数会遍历整个队列，导致阻塞
    # 改用简单的丢弃最老事件策略
    
    # 🔥 已移除：clear_queue() 清空队列会导致正在处理的事件丢失
    # 队列会自然消化，无需强制清空
    
    def reset_stats(self):
        """重置统计信息"""
        self.stats = {
            'events_received': 0,
            'events_processed': 0,
            'events_dropped': 0,
            'batches_sent': 0,
            'total_batch_size': 0,
            'avg_batch_size': 0,
            'max_batch_size': 0,
            'total_process_time': 0,
            'avg_process_time': 0,
            'last_batch_time': 0
        }
        self.recent_batch_sizes.clear()
        self.recent_process_times.clear()
        LOGGER.info("🔄 批处理器统计已重置")
