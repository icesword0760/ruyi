"""
智能选择器生成器 - V5
基于 Playwright 和 Chrome Recorder 的最佳实践

功能：
1. 支持多种选择器类型（ARIA, testid, ID, text, CSS, XPath）
2. 自动验证选择器唯一性
3. 按稳定性评分排序
4. 生成层级选择器
5. 支持fallback策略
"""

import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import re

LOGGER = logging.getLogger(__name__)


@dataclass
class SelectorCandidate:
    """选择器候选"""
    selector: str
    type: str  # aria, testid, id, text, css, xpath
    score: int  # 0-100
    is_unique: bool = False
    stability: str = 'unknown'  # high, medium, low


class SelectorGenerator:
    """
    智能选择器生成器
    
    优先级（从高到低）：
    1. ARIA role + name (95分)
    2. data-testid (90分)
    3. ID (语义化) (85分)
    4. Text content (80分)
    5. CSS class (65分)
    6. XPath (60分)
    """
    
    def __init__(self, cdp_client=None):
        self.cdp_client = cdp_client
        LOGGER.info("✅ 智能选择器生成器已初始化")
    
    def generate_selectors(
        self,
        target: Dict[str, Any],
        validate_uniqueness: bool = False
    ) -> List[SelectorCandidate]:
        """
        生成选择器列表，按优先级排序
        
        Args:
            target: 目标元素信息
            validate_uniqueness: 是否验证唯一性（需要CDP client）
            
        Returns:
            排序后的选择器候选列表
        """
        candidates = []
        
        # 1. ARIA selectors (最高优先级)
        candidates.extend(self._generate_aria_selectors(target))
        
        # 2. Test ID selectors
        candidates.extend(self._generate_testid_selectors(target))
        
        # 3. ID selectors
        candidates.extend(self._generate_id_selectors(target))
        
        # 4. Text selectors
        candidates.extend(self._generate_text_selectors(target))
        
        # 5. CSS class selectors
        candidates.extend(self._generate_css_selectors(target))
        
        # 6. XPath selectors (备选)
        candidates.extend(self._generate_xpath_selectors(target))
        
        # 按分数排序
        candidates.sort(key=lambda x: x.score, reverse=True)
        
        LOGGER.debug(f"生成了 {len(candidates)} 个选择器候选")
        
        return candidates
    
    async def generate_selectors_with_validation(
        self,
        target: Dict[str, Any]
    ) -> List[SelectorCandidate]:
        """
        生成并验证选择器（异步版本）
        """
        candidates = self.generate_selectors(target, validate_uniqueness=False)
        
        # 验证唯一性（如果有CDP client）
        if self.cdp_client:
            await self._validate_selectors(candidates)
        
        # 重新排序（考虑唯一性）
        candidates.sort(key=lambda x: x.score, reverse=True)
        
        return candidates
    
    def _generate_aria_selectors(self, target: Dict) -> List[SelectorCandidate]:
        """生成ARIA选择器（最佳实践）"""
        selectors = []
        
        role = target.get('role')
        aria_label = target.get('ariaLabel')
        tag_name = target.get('tagName', '').lower()
        
        # role + name
        if role and aria_label:
            selectors.append(SelectorCandidate(
                selector=f'role={role}[name="{self._escape_quotes(aria_label)}"]',
                type='aria',
                score=95,
                stability='high'
            ))
        
        # role alone
        if role:
            # 某些role天然唯一
            unique_roles = ['main', 'navigation', 'banner', 'contentinfo', 'search']
            score = 90 if role.lower() in unique_roles else 85
            
            selectors.append(SelectorCandidate(
                selector=f'role={role}',
                type='aria',
                score=score,
                stability='high' if role.lower() in unique_roles else 'medium'
            ))
        
        # aria-label alone
        if aria_label and not role:
            selectors.append(SelectorCandidate(
                selector=f'[aria-label="{self._escape_quotes(aria_label)}"]',
                type='aria',
                score=80,
                stability='medium'
            ))
        
        # 如果是按钮且有文本，也可以用role=button[name=text]
        if tag_name == 'button' and not role:
            text_content = target.get('textContent', '').strip()
            if text_content:
                selectors.append(SelectorCandidate(
                    selector=f'role=button[name="{self._escape_quotes(text_content)}"]',
                    type='aria',
                    score=88,
                    stability='high'
                ))
        
        return selectors
    
    def _generate_testid_selectors(self, target: Dict) -> List[SelectorCandidate]:
        """生成测试ID选择器"""
        selectors = []
        
        dataset = target.get('dataset', {})
        attributes = target.get('attributes', {})
        
        # data-testid
        test_id = dataset.get('testid') or attributes.get('data-testid')
        if test_id:
            selectors.append(SelectorCandidate(
                selector=f'[data-testid="{test_id}"]',
                type='testid',
                score=90,
                stability='high'
            ))
        
        # data-test
        data_test = dataset.get('test') or attributes.get('data-test')
        if data_test:
            selectors.append(SelectorCandidate(
                selector=f'[data-test="{data_test}"]',
                type='testid',
                score=88,
                stability='high'
            ))
        
        # data-cy (Cypress)
        data_cy = dataset.get('cy') or attributes.get('data-cy')
        if data_cy:
            selectors.append(SelectorCandidate(
                selector=f'[data-cy="{data_cy}"]',
                type='testid',
                score=87,
                stability='high'
            ))
        
        return selectors
    
    def _generate_id_selectors(self, target: Dict) -> List[SelectorCandidate]:
        """生成ID选择器"""
        selectors = []
        
        target_id = target.get('id')
        if not target_id:
            return selectors
        
        # 检查ID是否有意义（不是自动生成的）
        if self._is_meaningful_id(target_id):
            selectors.append(SelectorCandidate(
                selector=f'#{target_id}',
                type='id',
                score=85,
                stability='medium'
            ))
        else:
            # 自动生成的ID，分数较低
            selectors.append(SelectorCandidate(
                selector=f'#{target_id}',
                type='id',
                score=50,
                stability='low'
            ))
        
        return selectors
    
    def _generate_text_selectors(self, target: Dict) -> List[SelectorCandidate]:
        """生成文本选择器"""
        selectors = []
        
        text_content = target.get('textContent', '').strip()
        tag_name = target.get('tagName', '').lower()
        
        if not text_content or len(text_content) > 50:
            return selectors
        
        text_escaped = self._escape_quotes(text_content)
        
        # 精确文本匹配
        selectors.append(SelectorCandidate(
            selector=f'{tag_name}:text-is("{text_escaped}")',
            type='text',
            score=78,
            stability='medium'
        ))
        
        # 部分文本匹配
        if len(text_content) > 10:
            short_text = text_content[:20]
            selectors.append(SelectorCandidate(
                selector=f'{tag_name}:text("{self._escape_quotes(short_text)}")',
                type='text',
                score=72,
                stability='medium'
            ))
        
        return selectors
    
    def _generate_css_selectors(self, target: Dict) -> List[SelectorCandidate]:
        """生成CSS选择器"""
        selectors = []
        
        tag_name = target.get('tagName', '').lower()
        class_name = target.get('className', '')
        
        if class_name and isinstance(class_name, str):
            classes = [c for c in class_name.split() if self._is_meaningful_class(c)]
            
            if classes:
                # 使用前2个有意义的class
                css_selector = f"{tag_name}.{'.'.join(classes[:2])}"
                
                # 判断class的稳定性
                has_semantic = any(self._is_semantic_class(c) for c in classes[:2])
                score = 68 if has_semantic else 58
                stability = 'medium' if has_semantic else 'low'
                
                selectors.append(SelectorCandidate(
                    selector=css_selector,
                    type='css',
                    score=score,
                    stability=stability
                ))
        
        # 只有标签名（最后的fallback）
        if tag_name:
            selectors.append(SelectorCandidate(
                selector=tag_name,
                type='css',
                score=40,
                stability='low'
            ))
        
        return selectors
    
    def _generate_xpath_selectors(self, target: Dict) -> List[SelectorCandidate]:
        """生成XPath选择器（备选方案）"""
        selectors = []
        
        # 使用DOM路径生成XPath
        path = target.get('path', [])
        if not path:
            return selectors
        
        # 简单XPath（基于ID）
        tag_name = target.get('tagName', '').lower()
        target_id = target.get('id')
        
        if target_id:
            xpath = f"//{tag_name}[@id='{target_id}']"
            selectors.append(SelectorCandidate(
                selector=xpath,
                type='xpath',
                score=60,
                stability='medium'
            ))
        
        # 位置XPath（从路径生成）
        if len(path) > 1:
            xpath_parts = []
            for i, node in enumerate(path[-3:]):  # 只取最后3层
                part = node.get('tagName', '').lower()
                index = node.get('index', 0) + 1  # XPath索引从1开始
                xpath_parts.append(f"{part}[{index}]")
            
            if xpath_parts:
                xpath = '//' + '/'.join(xpath_parts)
                selectors.append(SelectorCandidate(
                    selector=xpath,
                    type='xpath',
                    score=45,
                    stability='low'
                ))
        
        return selectors
    
    def generate_hierarchical_selector(
        self,
        target: Dict,
        max_depth: int = 5
    ) -> Optional[SelectorCandidate]:
        """
        生成层级选择器（当简单选择器不唯一时使用）
        
        策略：从元素向上遍历，构建层级选择器
        """
        path = target.get('path', [])
        if not path or len(path) < 2:
            return None
        
        parts = []
        
        # 从根向下遍历（最多取max_depth层）
        start_index = max(0, len(path) - max_depth)
        for node in path[start_index:]:
            tag = node.get('tagName', '').lower()
            
            # 优先使用ID
            if node.get('id'):
                parts.append(f"{tag}#{node['id']}")
                break  # ID通常唯一，可以停止
            
            # 使用class
            elif node.get('className'):
                classes = node['className'].split()
                meaningful_classes = [c for c in classes if self._is_meaningful_class(c)]
                if meaningful_classes:
                    parts.append(f"{tag}.{meaningful_classes[0]}")
                else:
                    parts.append(tag)
            
            # 使用testid
            elif node.get('testid'):
                parts.append(f'{tag}[data-testid="{node["testid"]}"]')
                break
            
            # 只使用标签
            else:
                parts.append(tag)
        
        if parts:
            selector = ' > '.join(parts)
            return SelectorCandidate(
                selector=selector,
                type='hierarchical',
                score=70,
                stability='medium'
            )
        
        return None
    
    async def _validate_selectors(self, candidates: List[SelectorCandidate]):
        """验证选择器的唯一性（异步）"""
        for candidate in candidates:
            try:
                is_unique = await self._check_uniqueness(candidate.selector)
                candidate.is_unique = is_unique
                
                # 调整分数
                if not is_unique:
                    candidate.score -= 30  # 严重降分
                    LOGGER.warning(f"选择器不唯一: {candidate.selector}")
                else:
                    candidate.score += 5  # 小幅加分
                
            except Exception as e:
                LOGGER.error(f"验证选择器失败 {candidate.selector}: {e}")
                candidate.is_unique = False
                candidate.score -= 20
    
    async def _check_uniqueness(self, selector: str) -> bool:
        """通过CDP检查选择器是否唯一"""
        if not self.cdp_client:
            return False
        
        try:
            # 转换选择器格式为CSS
            css_selector = self._convert_to_css(selector)
            
            # 执行JavaScript检查
            js_code = f"""
                (() => {{
                    try {{
                        const elements = document.querySelectorAll('{css_selector}');
                        return elements.length;
                    }} catch(e) {{
                        return -1;  // 选择器无效
                    }}
                }})()
            """
            
            result = await self.cdp_client.evaluate(js_code)
            count = result.get('value', -1)
            
            return count == 1
            
        except Exception as e:
            LOGGER.error(f"检查唯一性失败: {e}")
            return False
    
    def _convert_to_css(self, selector: str) -> str:
        """将自定义选择器格式转换为CSS"""
        # role=button → [role="button"]
        if selector.startswith('role='):
            match = re.match(r'role=(\w+)(?:\[name="([^"]+)"\])?', selector)
            if match:
                role = match.group(1)
                name = match.group(2)
                if name:
                    # 无法用纯CSS表示name，返回role
                    return f'[role="{role}"]'
                return f'[role="{role}"]'
        
        # :text-is() → CSS :contains()（注意：CSS没有标准的text匹配）
        # 这里简化处理，实际需要用JS
        if ':text-is(' in selector or ':text(' in selector:
            # 提取标签名
            tag = selector.split(':')[0]
            return tag if tag else '*'
        
        return selector
    
    def _is_meaningful_id(self, id_value: str) -> bool:
        """判断ID是否有意义（不是自动生成的）"""
        if not id_value:
            return False
        
        # 排除自动生成的模式
        meaningless_patterns = [
            r'^id-[0-9a-f]{8}',  # id-a3f2d8e1
            r'^uid-\d+',          # uid-123456
            r'^random-',          # random-xxx
            r'^generated-',       # generated-xxx
            r'^[0-9a-f]{8,}$',   # 纯哈希
            r'^\d+$',             # 纯数字
        ]
        
        for pattern in meaningless_patterns:
            if re.match(pattern, id_value.lower()):
                return False
        
        # 太长且无语义
        if len(id_value) > 30:
            return False
        
        return True
    
    def _is_meaningful_class(self, class_name: str) -> bool:
        """判断class是否有意义"""
        if not class_name:
            return False
        
        # 排除CSS-in-JS生成的class
        meaningless_patterns = [
            r'^css-[0-9a-z]+$',      # css-1a2b3c
            r'^sc-[0-9a-z]+$',       # styled-components
            r'^Mui[A-Z]',            # MUI生成的
            r'^makeStyles-',         # makeStyles
            r'^jss[0-9]+$',          # JSS
            r'^_[0-9a-f]+$',         # _a1b2c3
        ]
        
        for pattern in meaningless_patterns:
            if re.match(pattern, class_name):
                return False
        
        return True
    
    def _is_semantic_class(self, class_name: str) -> bool:
        """判断class是否语义化"""
        semantic_keywords = [
            'button', 'btn', 'link', 'nav', 'menu', 'header', 'footer',
            'content', 'main', 'sidebar', 'container', 'wrapper',
            'form', 'input', 'select', 'checkbox', 'radio',
            'primary', 'secondary', 'submit', 'cancel', 'close'
        ]
        
        class_lower = class_name.lower()
        return any(keyword in class_lower for keyword in semantic_keywords)
    
    def _escape_quotes(self, text: str) -> str:
        """转义引号"""
        return text.replace('"', '\\"').replace("'", "\\'")


# 便捷函数
def generate_selectors_for_target(
    target: Dict,
    cdp_client=None
) -> List[SelectorCandidate]:
    """
    便捷函数：为目标元素生成选择器
    """
    generator = SelectorGenerator(cdp_client)
    return generator.generate_selectors(target)
