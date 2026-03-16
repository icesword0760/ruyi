"""
WebSocket录制处理器 - V5增强版
处理来自recorder_websocket.js的录制事件

V5新增功能：
1. 智能选择器生成（ARIA, testid, 唯一性验证）
2. 步骤智能合并
3. 层级选择器fallback
4. 断言生成
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from enum import Enum

# V5: 导入新模块
from .selector_generator import SelectorGenerator, SelectorCandidate
from .step_merger import StepMerger

LOGGER = logging.getLogger(__name__)


class RecordingState(Enum):
    """录制状态枚举"""
    IDLE = 'idle'
    STARTING = 'starting'
    RECORDING = 'recording'
    PAUSED = 'paused'
    STOPPING = 'stopping'
    STOPPED = 'stopped'


@dataclass
class RecordingSession:
    """录制会话"""
    recording_id: int
    start_time: float
    steps: List[Dict[str, Any]] = field(default_factory=list)
    is_recording: bool = True
    url: str = ""
    title: str = ""
    viewport: Dict[str, int] = field(default_factory=dict)
    state: RecordingState = RecordingState.RECORDING


class WebSocketRecorderHandler:
    """
    WebSocket录制处理器 - V5增强版
    处理来自浏览器的WebSocket录制事件
    """
    
    def __init__(self, cdp_client=None):
        self.current_session: Optional[RecordingSession] = None
        self._step_callback: Optional[Callable] = None
        self._save_callback: Optional[Callable] = None  # V6: 录制持久化回调
        
        # V5: 智能选择器生成器
        self.selector_generator = SelectorGenerator(cdp_client)
        
        # V5: 步骤合并器
        self.step_merger = StepMerger(flush_delay=2.0)
        
        # 状态管理
        self.state = RecordingState.IDLE
        self._state_listeners: List[Callable] = []
        
        LOGGER.info("📝 WebSocket录制处理器已初始化（V5增强版）")
    
    def set_step_callback(self, callback: Callable):
        """设置步骤广播回调"""
        self._step_callback = callback
        LOGGER.info("✅ 步骤回调已设置")
    
    def set_save_callback(self, callback: Callable):
        """V6: 设置录制持久化回调 — callback(recording_id, recording_data)"""
        self._save_callback = callback
        LOGGER.info("✅ 录制持久化回调已设置")
    
    async def handle_event(self, event_data: Dict[str, Any]):
        """处理来自浏览器的事件"""
        event_type = event_data.get('type')
        
        LOGGER.info(f"📥 [RECORDER] 收到事件: {event_type}")
        LOGGER.debug(f"📋 [RECORDER] 事件数据: {event_data}")
        
        try:
            if event_type == 'recorder_init':
                LOGGER.info(f"🎬 [RECORDER] 处理录制器初始化")
                await self._handle_init(event_data)
                
            elif event_type == 'recording_started':
                LOGGER.info(f"🔴 [RECORDER] 处理录制开始")
                await self._handle_recording_started(event_data)
                
            elif event_type == 'recording_stopped':
                LOGGER.info(f"⏹️ [RECORDER] 处理录制停止")
                await self._handle_recording_stopped(event_data)
                
            elif event_type == 'click':
                LOGGER.info(f"🖱️ [RECORDER] 处理点击事件")
                await self._handle_click(event_data)
                
            elif event_type == 'dblclick':
                LOGGER.info(f"🖱️🖱️ [RECORDER] 处理双击事件")
                await self._handle_double_click(event_data)
                
            elif event_type == 'input':
                LOGGER.info(f"⌨️ [RECORDER] 处理输入事件")
                await self._handle_input(event_data)
                
            elif event_type == 'scroll':
                LOGGER.info(f"📜 [RECORDER] 处理滚动事件")
                await self._handle_scroll(event_data)
                
            elif event_type == 'keydown':
                LOGGER.info(f"⌨️ [RECORDER] 处理按键事件")
                await self._handle_keydown(event_data)
                
            else:
                LOGGER.warning(f"⚠️ [RECORDER] 未知事件类型: {event_type}")
                
        except Exception as e:
            LOGGER.error(f"❌ [RECORDER] 处理事件失败: {e}", exc_info=True)
    
    async def _handle_init(self, event_data: Dict):
        """处理录制器初始化"""
        url = event_data.get('url', '')
        title = event_data.get('title', '')
        LOGGER.info(f"🎬 录制器初始化: {title} ({url})")
    
    async def _handle_recording_started(self, event_data: Dict):
        """处理录制开始 - V5增强版"""
        if self.current_session and self.current_session.is_recording:
            LOGGER.warning("⚠️ 已有活动录制会话，先停止旧会话再启动新的")
            self.current_session.is_recording = False
            self._transition_state(RecordingState.STOPPED)
            self.current_session = None
        
        recording_id = int(time.time() * 1000)
        
        # V5: 状态转换
        self._transition_state(RecordingState.STARTING)
        
        self.current_session = RecordingSession(
            recording_id=recording_id,
            start_time=time.time(),
            url=event_data.get('url', ''),
            title=event_data.get('title', ''),
            viewport={'width': 1920, 'height': 1080},
            state=RecordingState.RECORDING
        )
        
        # V5: 重置步骤合并器
        self.step_merger.reset()
        
        LOGGER.info(f"🔴 WebSocket: 开始录制会话 {recording_id}")
        
        # 状态转换到RECORDING
        self._transition_state(RecordingState.RECORDING)
        
        # 广播录制开始
        if self._step_callback:
            message = {
                "type": "RECORDING_STARTED",
                "recording_id": recording_id,
                "timestamp": int(time.time() * 1000)
            }
            LOGGER.info(f"📤 [RECORDER] 广播录制开始消息: {message}")
            await self._step_callback(recording_id, message)
    
    async def _handle_recording_stopped(self, event_data: Dict):
        """处理录制停止 - V6持久化增强版"""
        if not self.current_session:
            LOGGER.warning("⚠️ 没有活动录制会话")
            return
        
        session = self.current_session
        session.is_recording = False
        session.state = RecordingState.STOPPING
        
        # V5: Flush所有pending步骤
        async def flush_callback(merged_step):
            self.current_session.steps.append(merged_step)
            await self._broadcast_step(merged_step)
        
        await self.step_merger.flush_on_stop(flush_callback)
        
        LOGGER.info(f"⏹️ WebSocket: 停止录制会话 {session.recording_id}, 共 {len(session.steps)} 步")
        
        # V6: 持久化保存录制数据
        if self._save_callback and len(session.steps) > 0:
            try:
                duration = int(time.time() - session.start_time)
                rec_data = {
                    "id": session.recording_id,
                    "name": f"录制 #{session.recording_id}",
                    "startTime": session.start_time,
                    "endTime": time.time(),
                    "steps": len(session.steps),
                    "stepData": session.steps,
                    "url": session.url,
                    "title": session.title,
                    "timestamp": time.strftime('%Y/%m/%d %H:%M:%S'),
                    "durationSeconds": duration,
                }
                self._save_callback(session.recording_id, rec_data)
                LOGGER.info(f"💾 [RECORDER] 录制已持久化: {session.recording_id}")
            except Exception as e:
                LOGGER.error(f"❌ [RECORDER] 持久化保存失败: {e}", exc_info=True)
        
        # 状态转换
        self._transition_state(RecordingState.STOPPED)
        
        # 广播录制停止
        if self._step_callback:
            message = {
                "type": "RECORDING_STOPPED",
                "recordingId": session.recording_id,
                "steps": len(session.steps),
                "timestamp": int(time.time() * 1000)
            }
            LOGGER.info(f"📤 [RECORDER] 广播录制停止消息: {message}")
            await self._step_callback(session.recording_id, message)
        
        session.state = RecordingState.STOPPED
        self.current_session = None
        self._transition_state(RecordingState.IDLE)
    
    async def _handle_click(self, event_data: Dict):
        """处理点击事件 - V6 XPath增强版"""
        if not self.current_session or not self.current_session.is_recording:
            return
        
        target = event_data.get('target', {})
        xpath = event_data.get('xpath', '')
        xpath_index = event_data.get('xpathIndex', 0)
        iframes = event_data.get('iframes', [])
        location_type = event_data.get('locationType', '')
        
        # V6: 优先使用 XPath 作为定位器
        has_xpath = bool(xpath)
        
        # 构建选择器列表：XPath 优先，CSS 选择器作为备选
        selectors = []
        selector_details = []
        
        if has_xpath:
            selectors.append(xpath)
            selector_details.append({
                'selector': xpath,
                'type': 'xpath',
                'score': 1.0,
                'stability': 'high',
                'is_unique': True
            })
        
        # V5 兼容：仍生成旧的 CSS 选择器作为 fallback
        css_candidates = self.selector_generator.generate_selectors(target)
        for c in css_candidates[:3]:
            selectors.append(c.selector)
            selector_details.append({
                'selector': c.selector,
                'type': c.type,
                'score': c.score,
                'stability': c.stability,
                'is_unique': c.is_unique
            })
        
        # 生成描述
        tag_name = target.get('tagName', '')
        text_content = target.get('textContent', '')[:30] if target.get('textContent') else ''
        element_id = target.get('id', '')
        alt_text = target.get('alt', '')[:30] if target.get('alt') else ''
        
        if text_content and text_content.strip():
            description = f"Click '{text_content.strip()}'"
        elif alt_text and alt_text.strip():
            description = f"Click '{alt_text.strip()}'"
        elif element_id and element_id != '':
            description = f"Click #{element_id}"
        elif tag_name and tag_name not in ['', 'UNKNOWN', 'unknown']:
            description = f"Click <{tag_name}>"
        elif has_xpath:
            short_xpath = xpath if len(xpath) <= 40 else xpath[:37] + '...'
            description = f"Click [{short_xpath}]"
        else:
            x = event_data.get('clientX', event_data.get('offsetX', 0))
            y = event_data.get('clientY', event_data.get('offsetY', 0))
            description = f"Click at ({x}, {y})"
        
        step = {
            "type": "click",
            "timestamp": event_data.get('timestamp'),
            "description": description,
            "target": target,
            "selectors": selectors,
            "selector_details": selector_details,
            # V6: XPath 定位信息
            "xpath": xpath if has_xpath else None,
            "xpathIndex": xpath_index,
            "iframes": iframes,
            "locationType": location_type if has_xpath else "coordinate",
            # 坐标信息（作为 fallback）
            "offsetX": event_data.get('clientX', 0),
            "offsetY": event_data.get('clientY', 0),
            "clientX": event_data.get('clientX', 0),
            "clientY": event_data.get('clientY', 0),
            "pageX": event_data.get('pageX', event_data.get('clientX', 0)),
            "pageY": event_data.get('pageY', event_data.get('clientY', 0)),
            "button": event_data.get('button', 0),
            "_metadata": {
                "step_number": len(self.current_session.steps) + 1,
                "best_selector": xpath if has_xpath else (css_candidates[0].selector if css_candidates else None),
                "best_selector_type": "xpath" if has_xpath else (css_candidates[0].type if css_candidates else None),
                "selector_score": 1.0 if has_xpath else (css_candidates[0].score if css_candidates else 0),
                "description": description
            }
        }
        
        if event_data.get('_frame_base64'):
            step['_frame_base64'] = event_data['_frame_base64']
        
        # 通过步骤合并器处理（去重）
        async def flush_callback(merged_step):
            self.current_session.steps.append(merged_step)
            await self._broadcast_step(merged_step)
        
        result_step = await self.step_merger.process_step(step, flush_callback)
        
        if result_step:
            self.current_session.steps.append(result_step)
            loc_info = "xpath" if has_xpath else "coordinate"
            LOGGER.info(
                f"📝 步骤 {result_step['_metadata']['step_number']}: click on "
                f"{target.get('tagName', 'unknown')} (locator: {loc_info}, xpath: {xpath[:50] if xpath else 'N/A'})"
            )
            await self._broadcast_step(result_step)
    
    async def _handle_double_click(self, event_data: Dict):
        """处理双击事件 - V6 XPath增强版"""
        if not self.current_session or not self.current_session.is_recording:
            return
        
        target = event_data.get('target', {})
        xpath = event_data.get('xpath', '')
        has_xpath = bool(xpath)
        
        selectors = []
        if has_xpath:
            selectors.append(xpath)
        css_candidates = self.selector_generator.generate_selectors(target)
        for c in css_candidates[:3]:
            selectors.append(c.selector)
        
        tag_name = target.get('tagName', '')
        text_content = target.get('textContent', '')[:30] if target.get('textContent') else ''
        
        if text_content and text_content.strip():
            description = f"Double-click '{text_content.strip()}'"
        elif tag_name and tag_name not in ['', 'UNKNOWN', 'unknown']:
            description = f"Double-click <{tag_name}>"
        elif has_xpath:
            short_xpath = xpath if len(xpath) <= 40 else xpath[:37] + '...'
            description = f"Double-click [{short_xpath}]"
        else:
            x = event_data.get('clientX', event_data.get('offsetX', 0))
            y = event_data.get('clientY', event_data.get('offsetY', 0))
            description = f"Double-click at ({x}, {y})"
        
        step = {
            "type": "doubleClick",
            "timestamp": event_data.get('timestamp'),
            "description": description,
            "target": target,
            "selectors": selectors,
            "xpath": xpath if has_xpath else None,
            "xpathIndex": event_data.get('xpathIndex', 0),
            "iframes": event_data.get('iframes', []),
            "locationType": event_data.get('locationType', '') if has_xpath else "coordinate",
            "offsetX": event_data.get('clientX', 0),
            "offsetY": event_data.get('clientY', 0),
            "clientX": event_data.get('clientX', 0),
            "clientY": event_data.get('clientY', 0),
            "pageX": event_data.get('pageX', event_data.get('clientX', 0)),
            "pageY": event_data.get('pageY', event_data.get('clientY', 0)),
            "_metadata": {
                "step_number": len(self.current_session.steps) + 1,
                "best_selector": xpath if has_xpath else (css_candidates[0].selector if css_candidates else None),
                "best_selector_type": "xpath" if has_xpath else (css_candidates[0].type if css_candidates else None)
            }
        }
        
        self.current_session.steps.append(step)
        
        LOGGER.info(f"📝 步骤 {step['_metadata']['step_number']}: doubleClick")
        
        await self._broadcast_step(step)
    
    async def _handle_input(self, event_data: Dict):
        """处理输入事件 - V5增强版（智能合并）"""
        if not self.current_session or not self.current_session.is_recording:
            return
        
        target = event_data.get('target', {})
        
        # V5: 使用智能选择器生成器
        selector_candidates = self.selector_generator.generate_selectors(target)
        selectors = [c.selector for c in selector_candidates[:5]]
        
        value = event_data.get('value', '')
        tag_name = target.get('tagName', 'input')
        description = f"Type '{value[:30]}' into {tag_name}" if value else f"Clear {tag_name}"
        
        step = {
            "type": "input",
            "timestamp": event_data.get('timestamp'),
            "description": description,  # V5修复：添加描述
            "target": target,
            "selectors": selectors,
            "value": value,
            "_metadata": {
                "step_number": len(self.current_session.steps) + 1,
                "description": description
            }
        }
        
        # V5: 通过步骤合并器处理（自动合并连续输入）
        async def flush_callback(merged_step):
            # 更新步骤编号
            merged_step['_metadata']['step_number'] = len(self.current_session.steps) + 1
            self.current_session.steps.append(merged_step)
            
            merge_count = merged_step['_metadata'].get('merged_count', 1)
            LOGGER.info(
                f"📝 步骤 {merged_step['_metadata']['step_number']}: input value='"
                f"{merged_step['value'][:20]}...' (合并了{merge_count}次)"
            )
            
            await self._broadcast_step(merged_step)
        
        result_step = await self.step_merger.process_step(step, flush_callback)
        
        # 如果立即返回了步骤（不同输入框），记录和广播
        if result_step:
            result_step['_metadata']['step_number'] = len(self.current_session.steps) + 1
            self.current_session.steps.append(result_step)
            LOGGER.info(f"📝 步骤 {result_step['_metadata']['step_number']}: input (切换输入框)")
            await self._broadcast_step(result_step)
    
    async def _handle_scroll(self, event_data: Dict):
        """处理滚动事件 - V5增强版（智能合并）"""
        if not self.current_session or not self.current_session.is_recording:
            return
        
        scrollX = event_data.get('scrollX', 0)
        scrollY = event_data.get('scrollY', 0)
        description = f"Scroll to ({scrollX}, {scrollY})"
        
        step = {
            "type": "scroll",
            "timestamp": event_data.get('timestamp'),
            "description": description,  # V5修复：添加描述
            "scrollX": scrollX,
            "scrollY": scrollY,
            "_metadata": {
                "step_number": len(self.current_session.steps) + 1,
                "description": description
            }
        }
        
        # V5: 通过步骤合并器处理（自动合并连续滚动）
        async def flush_callback(merged_step):
            merged_step['_metadata']['step_number'] = len(self.current_session.steps) + 1
            self.current_session.steps.append(merged_step)
            
            merge_count = merged_step['_metadata'].get('merged_count', 1)
            LOGGER.info(
                f"📝 步骤 {merged_step['_metadata']['step_number']}: scroll to "
                f"({merged_step['scrollX']}, {merged_step['scrollY']}) (合并了{merge_count}次)"
            )
            
            await self._broadcast_step(merged_step)
        
        result_step = await self.step_merger.process_step(step, flush_callback)
        
        if result_step:
            result_step['_metadata']['step_number'] = len(self.current_session.steps) + 1
            self.current_session.steps.append(result_step)
            LOGGER.info(f"📝 步骤 {result_step['_metadata']['step_number']}: scroll (immediate)")
            await self._broadcast_step(result_step)
    
    async def _handle_keydown(self, event_data: Dict):
        """处理按键事件 - V5增强版"""
        if not self.current_session or not self.current_session.is_recording:
            return
        
        # 生成描述
        key = event_data.get('key', '')
        ctrl = event_data.get('ctrlKey', False)
        meta = event_data.get('metaKey', False)
        alt = event_data.get('altKey', False)
        shift = event_data.get('shiftKey', False)
        
        modifiers_str = []
        if ctrl: modifiers_str.append('Ctrl')
        if meta: modifiers_str.append('Cmd')
        if alt: modifiers_str.append('Alt')
        if shift: modifiers_str.append('Shift')
        
        if modifiers_str:
            description = f"Press {'+'.join(modifiers_str)}+{key}"
        else:
            description = f"Press {key}"
        
        step = {
            "type": "keyDown",
            "timestamp": event_data.get('timestamp'),
            "description": description,  # V5修复：添加描述
            "key": key,
            "code": event_data.get('code', ''),
            "modifiers": {
                "ctrl": ctrl,
                "meta": meta,
                "alt": alt,
                "shift": shift
            },
            "_metadata": {
                "step_number": len(self.current_session.steps) + 1,
                "description": description
            }
        }
        
        self.current_session.steps.append(step)
        
        LOGGER.info(f"📝 步骤 {step['_metadata']['step_number']}: keyDown {step['key']}")
        
        await self._broadcast_step(step)
    
    def _generate_selectors(self, target: Dict) -> List[str]:
        """
        生成选择器（兼容旧接口）
        V5: 使用智能选择器生成器
        """
        # 使用新的选择器生成器
        candidates = self.selector_generator.generate_selectors(target)
        
        # 返回选择器字符串列表
        selectors = [c.selector for c in candidates[:5]]
        
        return selectors if selectors else ['unknown']
    
    def _transition_state(self, new_state: RecordingState):
        """
        状态转换（V5: 状态机）
        """
        old_state = self.state
        self.state = new_state
        
        LOGGER.info(f"🔄 录制状态: {old_state.value} → {new_state.value}")
        
        # 通知监听者
        for listener in self._state_listeners:
            try:
                listener(old_state, new_state)
            except Exception as e:
                LOGGER.error(f"状态监听器执行失败: {e}")
    
    async def _broadcast_step(self, step: Dict):
        """广播步骤到控制面板"""
        LOGGER.info(f"📡 [RECORDER] 准备广播步骤: type={step.get('type')}, step_number={step.get('_metadata', {}).get('step_number')}")
        
        if not self._step_callback:
            LOGGER.error(f"❌ [RECORDER] 步骤回调未设置！")
            return
            
        if not self.current_session:
            LOGGER.error(f"❌ [RECORDER] 没有活动会话！")
            return
        
        try:
            LOGGER.info(f"📤 [RECORDER] 调用步骤回调: recording_id={self.current_session.recording_id}")
            await self._step_callback(self.current_session.recording_id, step)
            LOGGER.info(f"✅ [RECORDER] 步骤广播成功")
        except Exception as e:
            LOGGER.error(f"❌ [RECORDER] 广播步骤失败: {e}", exc_info=True)
    
    async def start_recording(self, url: str = "", title: str = "") -> int:
        """外部API：开始录制"""
        recording_id = int(time.time() * 1000)
        
        self.current_session = RecordingSession(
            recording_id=recording_id,
            start_time=time.time(),
            url=url,
            title=title,
            viewport={'width': 1920, 'height': 1080}
        )
        
        LOGGER.info(f"🔴 API: 开始录制会话 {recording_id}")
        return recording_id
    
    async def stop_recording(self) -> Optional[RecordingSession]:
        """外部API：停止录制"""
        if not self.current_session:
            LOGGER.warning("⚠️ 没有活动录制会话")
            return None
        
        session = self.current_session
        session.is_recording = False
        
        LOGGER.info(f"⏹️ API: 停止录制会话 {session.recording_id}, 共 {len(session.steps)} 步")
        
        result = session
        self.current_session = None
        return result
