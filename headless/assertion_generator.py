"""
断言生成器 - V5

功能：
1. 在操作后自动检测DOM变化
2. 生成验证步骤
3. 支持可见性、文本内容、元素存在等断言
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

LOGGER = logging.getLogger(__name__)


@dataclass
class Assertion:
    """断言"""
    type: str  # 'visible', 'text', 'exists', 'value'
    selector: str
    expected: Any
    score: int = 50  # 断言的重要性分数


class AssertionGenerator:
    """
    断言生成器
    
    在用户操作后自动生成验证断言
    """
    
    def __init__(self, cdp_client=None):
        self.cdp_client = cdp_client
        self._last_dom_snapshot = None
        LOGGER.info("✅ 断言生成器已初始化")
    
    async def generate_assertions_after_action(
        self,
        action_step: Dict,
        delay: float = 1.0
    ) -> List[Assertion]:
        """
        在操作后生成断言
        
        Args:
            action_step: 刚执行的操作步骤
            delay: 等待多久后捕获变化（秒）
            
        Returns:
            生成的断言列表
        """
        # 等待DOM稳定
        await asyncio.sleep(delay)
        
        assertions = []
        action_type = action_step.get('type')
        
        try:
            # 根据操作类型生成不同的断言
            if action_type == 'click':
                assertions.extend(await self._generate_click_assertions(action_step))
            
            elif action_type == 'input':
                assertions.extend(await self._generate_input_assertions(action_step))
            
            elif action_type == 'navigate':
                assertions.extend(await self._generate_navigation_assertions(action_step))
            
            LOGGER.info(f"为{action_type}生成了{len(assertions)}个断言")
            
        except Exception as e:
            LOGGER.error(f"生成断言失败: {e}")
        
        return assertions
    
    async def _generate_click_assertions(self, click_step: Dict) -> List[Assertion]:
        """为点击操作生成断言"""
        assertions = []
        
        if not self.cdp_client:
            return assertions
        
        try:
            # 检测新出现的元素（如模态框、提示信息等）
            new_elements = await self._detect_new_elements()
            
            for element in new_elements[:3]:  # 最多3个
                assertions.append(Assertion(
                    type='visible',
                    selector=element['selector'],
                    expected=True,
                    score=70
                ))
            
            # 检测URL变化（如果是链接点击）
            target = click_step.get('target', {})
            if target.get('tagName') == 'A':
                assertions.append(Assertion(
                    type='url_changed',
                    selector='window.location.href',
                    expected='changed',
                    score=80
                ))
            
        except Exception as e:
            LOGGER.error(f"生成点击断言失败: {e}")
        
        return assertions
    
    async def _generate_input_assertions(self, input_step: Dict) -> List[Assertion]:
        """为输入操作生成断言"""
        assertions = []
        
        # 验证输入值
        selectors = input_step.get('selectors', [])
        value = input_step.get('value', '')
        
        if selectors and value:
            assertions.append(Assertion(
                type='value',
                selector=selectors[0],
                expected=value,
                score=90
            ))
        
        return assertions
    
    async def _generate_navigation_assertions(self, nav_step: Dict) -> List[Assertion]:
        """为导航操作生成断言"""
        assertions = []
        
        # 验证URL
        target_url = nav_step.get('url')
        if target_url:
            assertions.append(Assertion(
                type='url',
                selector='window.location.href',
                expected=target_url,
                score=95
            ))
        
        return assertions
    
    async def _detect_new_elements(self) -> List[Dict]:
        """检测新出现的元素"""
        if not self.cdp_client:
            return []
        
        try:
            # 获取当前可见的模态框、对话框、toast等
            js_code = """
                (() => {
                    const newElements = [];
                    
                    // 检测模态框
                    const modals = document.querySelectorAll('[role="dialog"], .modal, .popup, .toast');
                    modals.forEach(el => {
                        if (el.offsetParent !== null) {  // 可见
                            newElements.push({
                                selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : 'unknown',
                                type: 'modal',
                                visible: true
                            });
                        }
                    });
                    
                    // 检测新增的可见元素（简化版）
                    const alerts = document.querySelectorAll('[role="alert"], .alert, .notification');
                    alerts.forEach(el => {
                        if (el.offsetParent !== null) {
                            newElements.push({
                                selector: el.id ? `#${el.id}` : `.${el.className.split(' ')[0]}`,
                                type: 'alert',
                                visible: true
                            });
                        }
                    });
                    
                    return newElements;
                })()
            """
            
            result = await self.cdp_client.send_message(
                "Runtime.evaluate",
                {
                    "expression": js_code,
                    "returnByValue": True
                }
            )
            
            new_elements = result.get('result', {}).get('value', [])
            return new_elements
            
        except Exception as e:
            LOGGER.error(f"检测新元素失败: {e}")
            return []
    
    def convert_to_step(self, assertion: Assertion, step_number: int) -> Dict:
        """将断言转换为录制步骤格式"""
        return {
            "type": "assertElement",
            "assertionType": assertion.type,
            "selectors": [assertion.selector],
            "expected": assertion.expected,
            "timestamp": int(time.time() * 1000),
            "_metadata": {
                "step_number": step_number,
                "auto_generated": True,
                "assertion_score": assertion.score
            }
        }


# 导入time
import time
