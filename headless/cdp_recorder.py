"""
CDP Recorder - 基于CDP协议的录制器
参考Chrome DevTools Recorder和Playwright架构
不依赖页面JavaScript，直接监听CDP事件
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

LOGGER = logging.getLogger(__name__)


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


class CDPRecorder:
    """
    CDP原生录制器
    
    核心思路：
    1. 监听CDP的Input域事件（鼠标、键盘）
    2. 使用CDP的DOM API查询元素
    3. 状态管理在Python侧
    4. 不依赖页面JavaScript
    """
    
    def __init__(self, cdp_client):
        self.cdp_client = cdp_client
        self.current_session: Optional[RecordingSession] = None
        self._element_cache: Dict[str, Any] = {}
        self._last_mouse_position = (0, 0)
        self._pending_click = None
        self._double_click_timeout = 0.5  # 500ms
        
        # Input防抖处理
        self._input_timers: Dict[str, asyncio.Task] = {}
        self._scroll_timer: Optional[asyncio.Task] = None
        
        # 步骤广播回调（由server.py设置）
        self._step_callback = None
        self._enable_in_progress = False
        
    async def enable(self):
        """启用录制器（启用CDP域）"""
        if self._enable_in_progress:
            LOGGER.debug("⏭️ enable() 已在执行中，跳过重复调用")
            return True
        
        self._enable_in_progress = True
        try:
            LOGGER.info("🎬 启用CDP录制器...")
            
            await self.cdp_client.call("DOM.enable")
            await self.cdp_client.call("Runtime.enable")
            await self.cdp_client.call("Page.enable")
            
            await self._inject_input_listener()
            
            LOGGER.info("✅ CDP录制器已启用")
            return True
            
        except Exception as e:
            LOGGER.error(f"❌ CDP录制器启用失败: {e}", exc_info=True)
            return False
        finally:
            self._enable_in_progress = False
    
    async def _inject_input_listener(self):
        """注入轻量级输入监听器"""
        # 这个脚本只负责捕获事件并通过CDP binding发送
        # 不包含任何录制逻辑
        script = """
        (function() {
            // 创建CDP binding
            if (!window._cdpRecorderBound) {
                window._cdpRecorderBound = true;
                
                // 创建按钮切换binding
                window._sendRecorderToggle = function() {
                    if (window._sendRecorderEvent) {
                        window._sendRecorderEvent(JSON.stringify({
                            type: 'toggle_recording',
                            timestamp: Date.now()
                        }));
                    }
                };
                
                // 监听所有输入事件，直接发送到CDP
                ['click', 'dblclick', 'input', 'change', 'keydown', 'scroll'].forEach(type => {
                    document.addEventListener(type, (e) => {
                        var rect = null;
                        try { rect = e.target?.getBoundingClientRect(); } catch(_) {}
                        // 构造事件数据
                        const data = {
                            type: type,
                            timestamp: Date.now(),
                            target: {
                                tagName: e.target?.tagName,
                                id: e.target?.id,
                                className: e.target?.className,
                                type: e.target?.type,
                                name: e.target?.name,
                                value: e.target?.value,
                                checked: e.target?.checked,
                                innerText: e.target?.innerText?.substring(0, 50),
                                textContent: (e.target?.textContent || '').trim().substring(0, 200),
                                boundingBox: rect ? {
                                    x: rect.x, y: rect.y,
                                    width: rect.width, height: rect.height
                                } : null,
                                viewportWidth: window.innerWidth,
                                viewportHeight: window.innerHeight
                            }
                        };
                        
                        // 鼠标事件
                        if (e.clientX !== undefined) {
                            data.clientX = e.clientX;
                            data.clientY = e.clientY;
                            data.button = e.button;
                        }
                        
                        // 键盘事件
                        if (e.key !== undefined) {
                            data.key = e.key;
                            data.code = e.code;
                            data.ctrlKey = e.ctrlKey;
                            data.metaKey = e.metaKey;
                            data.altKey = e.altKey;
                            data.shiftKey = e.shiftKey;
                        }
                        
                        // 滚动事件
                        if (type === 'scroll') {
                            data.scrollX = window.scrollX;
                            data.scrollY = window.scrollY;
                        }
                        
                        // 只在录制中才发送（检查Python侧状态）
                        if (window._isRecording) {
                            window._sendRecorderEvent?.(JSON.stringify(data));
                        }
                    }, true);
                });
                
                console.log('✅ CDP Input Listener已初始化');
            }
        })();
        """
        
        # 1. 添加Runtime binding（关键！）
        try:
            await self.cdp_client.call("Runtime.addBinding", {"name": "_sendRecorderEvent"})
            LOGGER.info("✅ Runtime binding '_sendRecorderEvent' 已创建")
        except Exception as e:
            LOGGER.warning(f"⚠️ 创建binding失败（可能已存在）: {e}")
        
        # 2. 在每个新文档注入
        await self.cdp_client.call("Page.addScriptToEvaluateOnNewDocument", {
            "source": script
        })
        
        # 3. 在当前文档也注入
        try:
            await self.cdp_client.call("Runtime.evaluate", {
                "expression": script,
                "returnByValue": False
            })
        except:
            pass  # 可能页面还没加载
        
        LOGGER.info("✅ 输入监听器已注入")
    
    def set_step_callback(self, callback):
        """设置步骤广播回调函数"""
        self._step_callback = callback
    
    async def _get_current_url(self) -> str:
        """获取当前页面URL"""
        try:
            result = await self.cdp_client.call("Runtime.evaluate", {
                "expression": "window.location.href",
                "returnByValue": True
            })
            return result.get("result", {}).get("value", "")
        except:
            return ""
    
    async def _get_current_title(self) -> str:
        """获取当前页面标题"""
        try:
            result = await self.cdp_client.call("Runtime.evaluate", {
                "expression": "document.title",
                "returnByValue": True
            })
            return result.get("result", {}).get("value", "")
        except:
            return ""
    
    async def start_recording(self, url: str = "", title: str = "") -> int:
        """开始录制"""
        if self.current_session and self.current_session.is_recording:
            LOGGER.warning("⚠️ 已有录制会话，先停止")
            await self.stop_recording()
        
        recording_id = int(time.time() * 1000)
        self.current_session = RecordingSession(
            recording_id=recording_id,
            start_time=time.time(),
            url=url,
            title=title,
            viewport={"width": self.cdp_client.viewport_width, "height": self.cdp_client.viewport_height}
        )
        
        # 设置录制标志（在页面中）
        try:
            await self.cdp_client.call("Runtime.evaluate", {
                "expression": """
                    window._isRecording = true; 
                    console.log('🔴 V4录制状态: 已开启');
                    if (window._updateRecorderUI) {
                        window._updateRecorderUI(true);
                    }
                """,
                "returnByValue": False
            })
        except Exception as e:
            LOGGER.warning(f"⚠️ 设置录制标志失败: {e}")
        
        LOGGER.info(f"🔴 开始录制会话: {recording_id}")
        return recording_id
    
    async def stop_recording(self) -> Optional[RecordingSession]:
        """停止录制"""
        if not self.current_session:
            LOGGER.warning("⚠️ 没有活动的录制会话")
            return None
        
        session = self.current_session
        session.is_recording = False
        
        # 清除录制标志并更新UI
        try:
            await self.cdp_client.call("Runtime.evaluate", {
                "expression": """
                    window._isRecording = false; 
                    console.log('⏹️ V4录制状态: 已停止');
                    if (window._updateRecorderUI) {
                        window._updateRecorderUI(false);
                    }
                """,
                "returnByValue": False
            })
        except Exception as e:
            LOGGER.warning(f"⚠️ 清除录制标志失败: {e}")
        
        LOGGER.info(f"⏹️ 停止录制会话: {session.recording_id}, 共 {len(session.steps)} 步")
        
        result = session
        self.current_session = None
        return result
    
    async def handle_binding_called(self, params: Dict[str, Any]):
        """处理Runtime.bindingCalled事件"""
        binding_name = params.get("name")
        
        LOGGER.info(f"📨 [BINDING] 收到binding调用: name={binding_name}")
        
        if binding_name != "_sendRecorderEvent":
            return
        
        try:
            import json
            payload = params.get("payload", "{}")
            event_data = json.loads(payload)
            event_type = event_data.get('type')
            
            has_session = self.current_session is not None
            is_recording = self.current_session.is_recording if self.current_session else False
            LOGGER.info(f"📥 [BINDING] 事件: type={event_type}, session={has_session}, recording={is_recording}")
            
            if event_type == 'toggle_recording':
                LOGGER.info(f"🎬 收到录制切换请求")
                if self.current_session and self.current_session.is_recording:
                    await self.stop_recording()
                else:
                    LOGGER.info("🔴 从投屏按钮启动录制")
                    url = await self._get_current_url()
                    title = await self._get_current_title()
                    await self.start_recording(url=url, title=title)
                return
            
            if not self.current_session or not self.current_session.is_recording:
                LOGGER.info("⚠️ [BINDING] 收到事件但未在录制中，忽略")
                return
            
            await self._process_event(event_data)
        except Exception as e:
            LOGGER.error(f"❌ 处理事件失败: {e}", exc_info=True)
    
    async def _process_event(self, event: Dict[str, Any]):
        """处理捕获的事件
        
        click/dblclick 由 WebSocketRecorderHandler 统一处理（在 dispatch 前查询元素信息，数据更准确），
        CDPRecorder binding 只处理 input/change/scroll/keydown 等非点击事件。
        """
        event_type = event.get("type")
        
        if event_type in ("click", "dblclick"):
            LOGGER.debug(f"⏭️ 跳过 {event_type}（由 WebSocketRecorderHandler 处理）")
            return
        elif event_type == "input":
            await self._handle_input(event)
        elif event_type == "change":
            await self._handle_change(event)
        elif event_type == "keydown":
            await self._handle_keydown(event)
        elif event_type == "scroll":
            await self._handle_scroll(event)
    
    def _make_step_description(self, action: str, element_info: Dict[str, Any]) -> str:
        """根据元素信息生成自然语言描述"""
        tag = (element_info.get("tagName") or element_info.get("nodeName") or "").upper()
        text = (element_info.get("textContent") or "").strip()[:30]
        eid = element_info.get("id", "")
        if text:
            return f"Click '{text}'" if action == "click" else f"DoubleClick '{text}'"
        if eid:
            return f"Click #{eid}" if action == "click" else f"DoubleClick #{eid}"
        if tag:
            return f"Click <{tag.lower()}>" if action == "click" else f"DoubleClick <{tag.lower()}>"
        return self._get_element_description(element_info)

    def _merge_element_info(self, event_target: Dict, async_info: Dict) -> Dict:
        """合并事件同步捕获的元素信息和异步获取的元素信息，优先使用同步数据"""
        merged = dict(async_info) if async_info else {}
        if not event_target or not isinstance(event_target, dict):
            return merged
        # 同步捕获的 boundingBox 更可靠（点击瞬间获取，不受导航影响）
        if event_target.get("boundingBox"):
            merged["boundingBox"] = event_target["boundingBox"]
        if event_target.get("viewportWidth"):
            merged["viewportWidth"] = event_target["viewportWidth"]
            merged["viewportHeight"] = event_target.get("viewportHeight", 0)
        # 同步捕获的 textContent 更可靠
        if event_target.get("textContent") and not merged.get("textContent"):
            merged["textContent"] = event_target["textContent"]
        # 补充基本属性
        for key in ("tagName", "id", "className"):
            if event_target.get(key) and not merged.get(key):
                merged[key] = event_target[key]
        return merged

    async def _handle_click(self, event: Dict[str, Any]):
        """处理点击事件"""
        x, y = event.get("clientX", 0), event.get("clientY", 0)
        
        now = time.time()
        if (self._pending_click and 
            (now - self._pending_click["time"]) < self._double_click_timeout and
            abs(x - self._pending_click["x"]) < 5 and
            abs(y - self._pending_click["y"]) < 5):
            self._pending_click = None
            return
        
        self._pending_click = {"time": now, "x": x, "y": y}
        
        event_target = event.get("target", {})
        sync_bb = event_target.get("boundingBox") if isinstance(event_target, dict) else None
        sync_tag = event_target.get("tagName", "?") if isinstance(event_target, dict) else "?"
        LOGGER.info(f"🔍 [click] 同步BB: tag={sync_tag}, bb={sync_bb}, vp={event_target.get('viewportWidth','?')}x{event_target.get('viewportHeight','?')}")
        
        async_info = await self._get_element_at_position(x, y)
        async_bb = async_info.get("boundingBox") if async_info else None
        async_tag = async_info.get("tagName", "?") if async_info else "?"
        LOGGER.info(f"🔍 [click] 异步BB: tag={async_tag}, bb={async_bb}, vp={async_info.get('viewportWidth','?')}x{async_info.get('viewportHeight','?')}")
        
        element_info = self._merge_element_info(event_target, async_info)
        final_bb = element_info.get("boundingBox")
        LOGGER.info(f"🔍 [click] 最终BB: bb={final_bb}")
        
        # 查询 XPath（通过注入的 ElementLocator）
        xpath = ""
        xpath_index = 0
        iframes = []
        location_type = "coordinate"
        try:
            xpath_info = await self.cdp_client.get_element_info_at_coordinates(x, y)
            if xpath_info and xpath_info.get("success"):
                xpath = xpath_info.get("value", "")
                xpath_index = xpath_info.get("index", 0)
                iframes = xpath_info.get("iframes", [])
                location_type = xpath_info.get("locationType", "xpath")
                if xpath_info.get("tagName") and not element_info.get("tagName"):
                    element_info["tagName"] = xpath_info["tagName"]
                if xpath_info.get("text") and not element_info.get("textContent"):
                    element_info["textContent"] = xpath_info["text"]
                LOGGER.info(f"🔍 [click] XPath: {xpath[:60]}")
        except Exception as e:
            LOGGER.warning(f"⚠️ [click] 查询XPath失败: {e}")
        
        selectors = await self._generate_selectors(element_info)
        if xpath and xpath not in selectors:
            selectors.insert(0, xpath)
        description = self._make_step_description("click", element_info)
        
        step = {
            "type": "click",
            "target": element_info if element_info else "main",
            "timeout": 5000,
            "selectors": selectors,
            "xpath": xpath if xpath else None,
            "xpathIndex": xpath_index,
            "iframes": iframes,
            "locationType": location_type,
            "offsetX": x,
            "offsetY": y,
            "clientX": x,
            "clientY": y,
            "button": self._get_button_type(event.get("button", 0)),
            "description": description,
            "_metadata": {
                "number": len(self.current_session.steps) + 1,
                "step_number": len(self.current_session.steps) + 1,
                "description": description,
                "timestamp": event.get("timestamp"),
                "url": await self._get_current_url()
            }
        }
        
        self.current_session.steps.append(step)
        LOGGER.info(f"📝 步骤 {step['_metadata']['number']}: {description} at ({x}, {y})")
        
        await self._broadcast_step(step)
    
    async def _handle_double_click(self, event: Dict[str, Any]):
        """处理双击事件"""
        x, y = event.get("clientX", 0), event.get("clientY", 0)
        
        event_target = event.get("target", {})
        async_info = await self._get_element_at_position(x, y)
        element_info = self._merge_element_info(event_target, async_info)
        
        # 查询 XPath
        xpath = ""
        xpath_index = 0
        iframes = []
        location_type = "coordinate"
        try:
            xpath_info = await self.cdp_client.get_element_info_at_coordinates(x, y)
            if xpath_info and xpath_info.get("success"):
                xpath = xpath_info.get("value", "")
                xpath_index = xpath_info.get("index", 0)
                iframes = xpath_info.get("iframes", [])
                location_type = xpath_info.get("locationType", "xpath")
        except Exception as e:
            LOGGER.warning(f"⚠️ [dblclick] 查询XPath失败: {e}")
        
        selectors = await self._generate_selectors(element_info)
        if xpath and xpath not in selectors:
            selectors.insert(0, xpath)
        description = self._make_step_description("doubleClick", element_info)
        
        step = {
            "type": "doubleClick",
            "target": element_info if element_info else "main",
            "timeout": 5000,
            "selectors": selectors,
            "xpath": xpath if xpath else None,
            "xpathIndex": xpath_index,
            "iframes": iframes,
            "locationType": location_type,
            "offsetX": x,
            "offsetY": y,
            "clientX": x,
            "clientY": y,
            "button": self._get_button_type(event.get("button", 0)),
            "description": description,
            "_metadata": {
                "number": len(self.current_session.steps) + 1,
                "step_number": len(self.current_session.steps) + 1,
                "description": description,
                "timestamp": event.get("timestamp"),
                "url": await self._get_current_url()
            }
        }
        
        self.current_session.steps.append(step)
        LOGGER.info(f"📝 步骤 {step['_metadata']['number']}: {description}")
        await self._broadcast_step(step)
    
    async def _handle_input(self, event: Dict[str, Any]):
        """处理输入事件（1秒防抖）"""
        target = event.get("target", {})
        element_id = self._get_element_id_from_target(target)
        
        # 取消之前的定时器
        if element_id in self._input_timers:
            self._input_timers[element_id].cancel()
        
        # 创建新的防抖定时器
        async def record_input():
            await asyncio.sleep(1.0)  # 1秒防抖
            
            if not self.current_session or not self.current_session.is_recording:
                return
            
            value = target.get("value", "")
            if target.get("type") == "password":
                value = ""  # 不记录密码
            
            selectors = await self._generate_selectors_from_target(target)
            
            step = {
                "type": "change",
                "target": "main",
                "timeout": 5000,
                "selectors": selectors,
                "value": value,
                "_metadata": {
                    "number": len(self.current_session.steps) + 1,
                    "description": f"输入: {self._get_element_description(target)}",
                    "timestamp": event.get("timestamp"),
                    "url": await self._get_current_url()
                }
            }
            
            self.current_session.steps.append(step)
            LOGGER.info(f"📝 步骤 {step['_metadata']['number']}: input")
            await self._broadcast_step(step)
            
            # 清理定时器
            if element_id in self._input_timers:
                del self._input_timers[element_id]
        
        # 启动防抖定时器
        self._input_timers[element_id] = asyncio.create_task(record_input())
    
    async def _handle_change(self, event: Dict[str, Any]):
        """处理change事件（select、checkbox、radio）"""
        target = event.get("target", {})
        value = target.get("value", "")
        
        selectors = await self._generate_selectors_from_target(target)
        
        step = {
            "type": "change",
            "target": "main",
            "timeout": 5000,
            "selectors": selectors,
            "value": str(value),
            "_metadata": {
                "number": len(self.current_session.steps) + 1,
                "description": f"选择/切换 {self._get_element_description(target)}",
                "timestamp": event.get("timestamp"),
                "url": await self._get_current_url()
            }
        }
        
        self.current_session.steps.append(step)
        LOGGER.info(f"📝 步骤 {step['_metadata']['number']}: change")
        await self._broadcast_step(step)
    
    async def _handle_keydown(self, event: Dict[str, Any]):
        """处理键盘事件"""
        key = event.get("key", "")
        
        # 只记录特殊键和组合键
        if len(key) == 1 and not event.get("ctrlKey") and not event.get("metaKey") and not event.get("altKey"):
            return
        
        step = {
            "type": "keyDown",
            "target": "main",
            "timeout": 5000,
            "key": key,
            "_metadata": {
                "number": len(self.current_session.steps) + 1,
                "description": f"按键 {self._format_key(event)}",
                "timestamp": event.get("timestamp"),
                "url": await self._get_current_url()
            }
        }
        
        self.current_session.steps.append(step)
        LOGGER.info(f"📝 步骤 {step['_metadata']['number']}: keyDown - {key}")
        await self._broadcast_step(step)
    
    async def _handle_scroll(self, event: Dict[str, Any]):
        """处理滚动事件（500ms防抖）"""
        # 取消之前的定时器
        if self._scroll_timer:
            self._scroll_timer.cancel()
        
        # 创建新的防抖定时器
        async def record_scroll():
            await asyncio.sleep(0.5)  # 500ms防抖
            
            if not self.current_session or not self.current_session.is_recording:
                return
            
            step = {
                "type": "scroll",
                "target": "main",
                "timeout": 5000,
                "x": event.get("scrollX", 0),
                "y": event.get("scrollY", 0),
                "_metadata": {
                    "number": len(self.current_session.steps) + 1,
                    "description": f"滚动到 ({event.get('scrollX', 0)}, {event.get('scrollY', 0)})",
                    "timestamp": event.get("timestamp"),
                    "url": await self._get_current_url()
                }
            }
            
            self.current_session.steps.append(step)
            LOGGER.info(f"📝 步骤 {step['_metadata']['number']}: scroll")
            await self._broadcast_step(step)
            
            self._scroll_timer = None
        
        # 启动防抖定时器
        self._scroll_timer = asyncio.create_task(record_scroll())
    
    async def _get_element_at_position(self, x: int, y: int) -> Dict[str, Any]:
        """从坐标获取元素信息（含 boundingBox、textContent、tagName）"""
        try:
            js = f"""(function() {{
                var el = document.elementFromPoint({x}, {y});
                if (!el) return null;
                var rect = el.getBoundingClientRect();
                var text = (el.textContent || el.innerText || '').trim().substring(0, 200);
                return {{
                    tagName: el.tagName || '',
                    nodeName: el.nodeName || '',
                    textContent: text,
                    id: el.id || '',
                    className: (typeof el.className === 'string') ? el.className : '',
                    boundingBox: {{
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }},
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                }};
            }})()"""

            result = await self.cdp_client.call("Runtime.evaluate", {
                "expression": js,
                "returnByValue": True
            })

            value = result.get("result", {}).get("value")
            if value:
                return value

            LOGGER.warning(f"⚠️ Runtime.evaluate 返回空值，回退 DOM.getNodeForLocation")
            result = await self.cdp_client.call("DOM.getNodeForLocation", {
                "x": x, "y": y, "includeUserAgentShadowDOM": True
            })
            node_id = result.get("nodeId")
            if not node_id:
                return {}
            attrs = await self.cdp_client.call("DOM.getAttributes", {"nodeId": node_id})
            return {"nodeId": node_id, "attributes": attrs.get("attributes", [])}
        except Exception as e:
            LOGGER.warning(f"⚠️ 获取元素失败: {e}")
            return {}
    
    async def _generate_selectors(self, element_info: Dict[str, Any]) -> List[str]:
        """生成选择器（从CDP查询的元素）"""
        if not element_info or not element_info.get("nodeId"):
            return [":root"]
        
        selectors = []
        node_id = element_info.get("nodeId")
        
        try:
            # 通过CDP获取元素的详细信息
            result = await self.cdp_client.call("Runtime.evaluate", {
                "expression": f"""
                (function() {{
                    const node = document.querySelector('[data-cdp-node-id="{node_id}"]');
                    if (!node) return null;
                    
                    const selectors = [];
                    
                    // 1. data-testid
                    const testId = node.getAttribute('data-testid') || 
                                  node.getAttribute('data-test-id') ||
                                  node.getAttribute('data-test');
                    if (testId) selectors.push('[data-testid="' + testId + '"]');
                    
                    // 2. ARIA选择器
                    const ariaLabel = node.getAttribute('aria-label');
                    const role = node.getAttribute('role') || node.tagName.toLowerCase();
                    if (ariaLabel) {{
                        selectors.push('[aria-label="' + ariaLabel + '"]');
                        if (role) selectors.push(role + '[aria-label="' + ariaLabel + '"]');
                    }}
                    
                    // 3. ID选择器
                    if (node.id && /^[a-zA-Z][\\w-]*$/.test(node.id)) {{
                        selectors.push('#' + node.id);
                    }}
                    
                    // 4. Name属性
                    if (node.name) {{
                        selectors.push('[name="' + node.name + '"]');
                    }}
                    
                    // 5. 稳定的CSS类
                    if (node.className && typeof node.className === 'string') {{
                        const classes = node.className.split(/\\s+/)
                            .filter(c => c && !/^(ng-|_|css-|Mui|makeStyles)/.test(c));
                        if (classes.length > 0) {{
                            selectors.push('.' + classes[0]);
                        }}
                    }}
                    
                    // 6. 文本选择器（按钮、链接）
                    if (['BUTTON', 'A'].includes(node.tagName)) {{
                        const text = (node.innerText || node.textContent || '').trim();
                        if (text && text.length < 30) {{
                            selectors.push(node.tagName.toLowerCase() + ':has-text("' + text.substring(0, 30) + '")');
                        }}
                    }}
                    
                    // 7. 基本标签选择器
                    if (selectors.length === 0) {{
                        selectors.push(node.tagName.toLowerCase());
                    }}
                    
                    return selectors;
                }})();
                """,
                "returnByValue": True
            })
            
            generated = result.get("result", {}).get("value")
            if generated and isinstance(generated, list):
                selectors.extend(generated)
        except Exception as e:
            LOGGER.warning(f"⚠️ CDP选择器生成失败: {e}")
        
        # 如果没有生成任何选择器，使用基本选择器
        if not selectors:
            selectors = [":root"]
        
        return selectors
    
    async def _generate_selectors_from_target(self, target: Dict[str, Any]) -> List[str]:
        """从事件target生成选择器（增强版）"""
        selectors = []
        
        # 1. data-testid (最高优先级)
        for attr in ['data-testid', 'data-test-id', 'data-test']:
            if target.get(attr):
                selectors.append(f"[{attr}=\"{target[attr]}\"]")
                break
        
        # 2. ARIA选择器
        if target.get('aria-label'):
            aria_label = target['aria-label']
            selectors.append(f"[aria-label=\"{aria_label}\"]")
            
            # 结合role
            tag_name = target.get('tagName', '').lower()
            if tag_name in ['button', 'a', 'input', 'select', 'textarea']:
                selectors.append(f"{tag_name}[aria-label=\"{aria_label}\"]")
        
        # 3. ID选择器（排除动态ID）
        element_id = target.get("id", "")
        if element_id and not any(x in element_id.lower() for x in ['ember', 'react', 'vue', 'ng-', 'mui-']):
            selectors.append(f"#{element_id}")
        
        # 4. Name属性
        if target.get("name"):
            selectors.append(f"[name=\"{target['name']}\"]")
        
        # 5. 稳定的CSS类
        class_name = target.get("className", "")
        if class_name and isinstance(class_name, str):
            classes = [c for c in class_name.split() 
                      if c and not any(x in c.lower() for x in ['ng-', '_', 'css-', 'mui', 'makestyles'])]
            if classes:
                selectors.append(f".{classes[0]}")
        
        # 6. 文本选择器（按钮、链接）
        tag_name = target.get('tagName', '').lower()
        if tag_name in ['button', 'a']:
            text = target.get('innerText', '').strip()
            if text and len(text) < 30:
                selectors.append(f"{tag_name}:has-text(\"{text[:30]}\")")
        
        # 7. Type属性（input元素）
        if tag_name == 'input' and target.get('type'):
            input_type = target['type']
            selectors.append(f"input[type=\"{input_type}\"]")
        
        # 8. 基本标签选择器（兜底）
        if not selectors:
            selectors.append(tag_name or "div")
        
        return selectors
    
    def _get_element_description(self, element_info: Dict[str, Any]) -> str:
        """获取元素描述"""
        if isinstance(element_info, dict):
            if element_info.get("id"):
                return f"#{element_info['id']}"
            if element_info.get("innerText"):
                return f'"{element_info["innerText"][:30]}"'
            if element_info.get("tagName"):
                return f"<{element_info['tagName'].lower()}>"
        return "element"
    
    def _get_button_type(self, button: int) -> str:
        """获取鼠标按钮类型"""
        types = ["primary", "auxiliary", "secondary", "back", "forward"]
        return types[button] if button < len(types) else "primary"
    
    def _format_key(self, event: Dict[str, Any]) -> str:
        """格式化键盘描述"""
        modifiers = []
        if event.get("ctrlKey"):
            modifiers.append("Ctrl")
        if event.get("metaKey"):
            modifiers.append("Cmd")
        if event.get("altKey"):
            modifiers.append("Alt")
        if event.get("shiftKey"):
            modifiers.append("Shift")
        
        key = event.get("key", "")
        return f"{'+'.join(modifiers)}+{key}" if modifiers else key
    
    async def _get_current_url(self) -> str:
        """获取当前URL"""
        try:
            result = await self.cdp_client.call("Runtime.evaluate", {
                "expression": "window.location.href",
                "returnByValue": True
            })
            return result.get("result", {}).get("value", "")
        except:
            return ""
    
    def _get_element_id_from_target(self, target: Dict[str, Any]) -> str:
        """从target生成唯一ID（用于防抖）"""
        if target.get("id"):
            return f"id-{target['id']}"
        elif target.get("name"):
            return f"name-{target['name']}"
        else:
            return f"tag-{target.get('tagName', 'unknown')}-{hash(str(target))}"
    
    async def _broadcast_step(self, step: Dict[str, Any]):
        """广播步骤到前端"""
        if self._step_callback and self.current_session:
            try:
                # 附加当前帧快照（用于前端 enrichment 裁剪元素图像）
                if '_frame_base64' not in step and self.cdp_client and getattr(self.cdp_client, '_latest_frame_jpeg', None):
                    import base64
                    step['_frame_base64'] = base64.b64encode(
                        self.cdp_client._latest_frame_jpeg
                    ).decode('ascii')
                
                result = self._step_callback(self.current_session.recording_id, step)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                LOGGER.error(f"❌ 广播步骤失败: {e}", exc_info=True)
