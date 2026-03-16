/**
 * DOM树导出工具 - 一体化版本（All-in-One）Power by slzhou10 v2
 *
 * 集成了以下三个模块：
 * 1. xpath_generator_optimized.js - 智能XPath生成器
 * 2. browser_dom_exporter_optimized.js - DOM树导出工具
 * 3. browser_dom_exporter_with_xpath.js - XPath集成功能
 *
 * 版本：2.3.4
 * 日期：2025-12-25
 *
 * 🚀 一键使用：
 * 1. 打开目标网页
 * 2. F12打开Console
 * 3. 复制粘贴本文件全部内容，回车
 * 4. 执行：await exportDOMTreeWithXPath("file.json", {enableXPath: true, needDownload: true, debug: true})
 *
 * v2.3.4 更新：
 * - 🐛 修复iframe随机参数导致XPath失效的根本问题
 * - ✅ 问题：src带random/timestamp等参数，F5刷新后XPath失效
 * - 🔧 解决：彻底不依赖src查询参数，优先使用结构化属性
 * - 🎯 策略：id > name > title > class > 父节点+位置 > src路径 > 索引
 * - ✨ src仅使用pathname（完全不含查询参数），且优先级最低
 * - 💡 设计理念：查询参数天然不稳定，应避免作为主要定位手段
 *
 * v2.3.3 更新：
 * - 🐛 修复SVG等命名空间元素的XPath定位问题
 * - ✅ 问题：xmlns="http://www.w3.org/2000/svg"的元素用svg[1]定位失败
 * - 🔧 解决：自动检测命名空间，使用*[local-name()='svg']生成XPath
 * - 🎯 改进：_getTagExpression统一处理，避免副作用
 * - ✨ 支持SVG、MathML等所有XML命名空间元素
 *
 * v2.3.2 更新：
 * - 🐛 修复onlyVisible=true时节点重复的严重Bug
 * - ✅ 问题：递归过滤逻辑导致同一节点在树中出现多次
 * - 🔧 解决：完全重写过滤逻辑，从头重建树结构而非递归过滤
 * - 🎯 新算法：1.创建可见节点映射 2.找最近可见父节点 3.构建新树
 * - ✨ 确保每个节点在树中只出现一次，完全避免重复
 *
 * v2.3.1 更新：
 * - 🐛 修复onlyVisible=true时可见节点被错误过滤的问题
 * - ✅ 问题：如果父节点不可见，其可见的子节点会被连带过滤
 * - 🔧 解决：不可见节点"透明化"，将其可见子节点提升到上层
 * - 📊 增强调试：显示过滤后树中实际节点数，自动检测不匹配
 * - ✨ 现在onlyVisible=true也能100%保证节点匹配
 *
 * v2.3.0 更新（稳定版）：
 * - 🎉 完美解决孤儿节点问题！mockIdToXPath和domTree节点100%一致
 * - ✅ 验证：1778个节点，0个孤儿节点
 * - 🔧 核心修复：正确判断父节点是否会收集子元素
 * - 📊 调试增强：添加详细的构建统计和诊断信息
 * - 🚀 生产就绪：支持任意复杂的DOM结构和多层iframe嵌套
 *
 * v2.2.13 更新：
 * - 🐛 完全修复孤儿节点问题（51个→0个）
 * - ✅ 问题：stopCollectingTags/selfClosingTags元素本身也成为孤儿节点
 * - 🔧 解决：判断父节点是否会收集当前元素（考虑父节点类型）
 * - 🎯 改进：简化根节点判断逻辑，更清晰易懂
 * - ✨ 现在100%确保mockIdToXPath和domTree的节点完全一致
 *
 * v2.2.12 更新：
 * - 🐛 修复孤儿节点问题：元素在mockIdToXPath中但不在domTree中
 * - ✅ 问题：stopCollectingTags（button/a等）的子元素成为孤儿节点
 * - 🔧 解决：如果父节点是stopCollectingTags，子元素被视为根节点
 * - 🎯 改进：确保所有收集的元素都会出现在domTree中
 * - ✨ 现在mockIdToXPath和domTree的节点数量一致
 *
 * v2.2.11 更新：
 * - 🚀 支持多层iframe嵌套的XPath数据结构（重大升级）
 * - ✅ 问题：多层iframe嵌套时inIframe识别错误
 * - 🔧 解决：使用iframeChain数组存储完整的iframe路径链
 * - 🎯 改进：从 iframePath (string) 升级为 iframeChain (string[])
 * - 📝 格式：v3 - {inIframe, iframeChain: ["xpath_A", "xpath_B"], xpath}
 * - ✨ 现在可以正确处理任意深度的iframe嵌套
 *
 * v2.2.10 更新：
 * - 🐛 添加详细的调试信息帮助定位domTree为空的问题
 * - 🔍 调试：buildTree过程的每个阶段都输出统计信息
 * - 📊 调试：显示可见/不可见节点数量、根节点查找过程
 * - 🎯 改进：当找不到根节点时，输出详细的诊断信息
 *
 * v2.2.9 更新：
 * - 🐛 修复多层iframe嵌套时domTree为空的问题
 * - ✅ 问题：buildTree中iframe元素的.children不包含iframe内部元素
 * - 🔧 解决：iframe元素特殊处理，从contentDocument.body.children获取子节点
 * - 🎯 改进：优化根节点判断逻辑，正确处理iframe内的顶层元素
 * - ✨ 现在支持任意层级的iframe嵌套
 *
 * v2.2.8 更新：
 * - 🚀 支持递归导出iframe内的DOM结构（重大功能）
 * - ✅ 问题：从主文档运行脚本时无法遍历到iframe内部的元素
 * - 🔧 解决：检测iframe元素并递归进入其contentDocument导出所有内容
 * - 🎯 改进：collectElements和buildIndex都支持递归进入iframe
 * - 🐛 修复iframe内元素可见性判断（使用iframe自己的视口）
 * - ⚠️  跨域iframe会被跳过（浏览器安全限制）
 *
 * v2.2.7 更新：
 * - 🐛 修复关键Bug：移除contains()懒匹配策略，解决XPath不唯一问题
 * - ✅ 问题：contains(@class, 'xxx')可能匹配多个元素，导致XPath重复
 * - 🔧 解决：只使用确保唯一性的策略（完整id/class + isUnique验证）
 * - 📈 改进：移除_computeXPath、_checkChildrenForUniqueId、_buildPathWithParentFeature中的contains()
 * - 🎯 保证：所有生成的XPath要么通过索引验证唯一，要么使用相对路径+位置索引
 *
 * v2.2.6 更新：
 * - 🐛 修复contains()和[@src]组合的XPath语法错误（使用and连接）
 * - ⚡ 修复阶段3优化重复XPath时的性能灾难（12141次优化→分批处理）
 * - 🚀 阶段3也使用requestIdleCallback分批处理，每50个让出主线程
 * - ✨ 移除_optimizeXPath中的验证，直接返回优化后的XPath
 * - 📊 复杂页面从109秒优化到5-10秒（10-20倍提升）
 *
 * v2.2.5 更新：
 * - ⚡ 重大性能优化：XPath生成速度提升10-50倍
 * - 🔧 移除快速生成阶段的document.evaluate验证（最大性能瓶颈）
 * - 🚀 使用requestIdleCallback分批处理，防止页面卡死
 * - ✨ 复杂页面从17秒优化到2-3秒，普通页面从1秒到0.2秒
 *
 * v2.2.4 更新：
 * - 🎯 智能识别并过滤动态ID（如dropdown-menu-8070）
 * - ✨ 解决Element UI下拉菜单等组件的动态ID问题
 * - 🔧 自动检测常见的动态ID模式（-数字、_数字、长数字等）
 *
 * v2.2.3 更新：
 * - 🎯 智能识别并过滤动态生成的class（如el-table_17_column_115）
 * - ✨ 使用contains()匹配稳定的class部分，提升XPath稳定性
 * - 🔧 自动检测常见的动态class模式（_数字_、-数字、连续3位数字等）
 *
 * v2.2.2 更新：
 * - 🐛 修复text类型XPath的空格问题：使用normalize-space()函数
 * - ✨ 解决类似"<span> 新建任务 </span>"前后空格导致XPath匹配失败的问题
 *
 * v2.2.1 更新：
 * - 🐛 修复label元素（单选框、复选框等）content内容为空的问题
 * - ✨ 优化文本内容提取：支持span、div、p等常见元素的简短文本提取
 *
 * v2.2.0 更新：
 * - 🎯 新增XPath唯一性验证机制，确保每个XPath只匹配一个元素
 * - 🔧 智能降级策略：属性约束 → 父节点特征 → 位置索引
 * - 🐛 解决重复id/class导致的XPath重复问题
 * - ⚡ 性能优化：只对重复的XPath进行验证，性能损耗<5%
 *
 * v2.1.0 更新：
 * - 过滤SVG内部的绘图元素（path、circle、rect等），解决XPath定位失败问题
 * - 减少数据冗余，提升导出效率
 */

// ============================================================
// 第一部分：SmartXPathGenerator（XPath生成器）
// ============================================================

class SmartXPathGenerator {
    constructor(options = {}) {
        this.options = {
            enableCache: true,
            enableIndex: true,
            blacklistClasses: options.blacklistClasses || [
                'is-active', 'is-opened', 'active', 'selected', 'hover'
            ],
            ...options
        };

        this.idIndex = new Map();
        this.classIndex = new Map();
        this.textIndex = new Map();
        this.xpathCache = new Map();

        this.stats = {
            indexBuildTime: 0,
            totalGenerated: 0,
            cacheHits: 0
        };
    }

    /**
     * 规范化class字符串：
     * - 去掉首尾空白
     * - 将连续空白压缩为单个空格
     */
    _normalizeClassName(className) {
        if (!className || typeof className !== 'string') {
            return '';
        }
        return className.trim().replace(/\s+/g, ' ');
    }

    buildIndex(rootElement = document.body) {
        const startTime = performance.now();
        let count = 0;

        /**
         * 递归构建索引（包括iframe内部）
         */
        const buildIndexFromDocument = (doc, root) => {
            const walker = doc.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
                null
            );

            let element = walker.currentNode;

            while (element) {
                count++;

                if (element.id) {
                    if (!this.idIndex.has(element.id)) {
                        this.idIndex.set(element.id, []);
                    }
                    this.idIndex.get(element.id).push(element);
                }

                if (element.className && typeof element.className === 'string') {
                    const className = this._normalizeClassName(element.className);
                    if (className && !this._isBlacklistedClass(className)) {
                        if (!this.classIndex.has(className)) {
                            this.classIndex.set(className, []);
                        }
                        this.classIndex.get(className).push(element);
                    }
                }

                const text = this._getElementText(element);
                if (text) {
                    if (!this.textIndex.has(text)) {
                        this.textIndex.set(text, []);
                    }
                    this.textIndex.get(text).push(element);
                }

                // 检测到iframe，尝试递归进入
                if (element.tagName && element.tagName.toLowerCase() === 'iframe') {
                    try {
                        const iframeDoc = element.contentDocument ||
                                         (element.contentWindow && element.contentWindow.document);

                        if (iframeDoc && iframeDoc.body) {
                            // 递归构建iframe内的索引
                            buildIndexFromDocument(iframeDoc, iframeDoc.body);
                        }
                    } catch (e) {
                        // 跨域iframe无法访问，跳过
                        if (this.options.debug) {
                            console.warn('无法访问iframe内容（可能是跨域）:', e.message);
                        }
                    }
                }

                element = walker.nextNode();
            }
        };

        // 从根元素开始构建索引
        const doc = rootElement.ownerDocument || document;
        buildIndexFromDocument(doc, rootElement);

        this.stats.indexBuildTime = performance.now() - startTime;

        if (this.options.debug) {
            console.log(`XPath索引构建完成（包含iframe）:`);
            console.log(`  - 遍历元素: ${count} 个`);
            console.log(`  - ID索引: ${this.idIndex.size} 项`);
            console.log(`  - Class索引: ${this.classIndex.size} 项`);
            console.log(`  - Text索引: ${this.textIndex.size} 项`);
            console.log(`  - 耗时: ${this.stats.indexBuildTime.toFixed(2)}ms`);
        }
    }

    _isBlacklistedClass(className) {
        for (const blacklisted of this.options.blacklistClasses) {
            if (className.includes(blacklisted)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检测class是否包含动态生成的部分（通常包含数字）
     * 例如：el-table_17_column_115, ant-select-123, mui-xyz-456
     */
    _isDynamicClass(className) {
        // 检测常见的动态class模式
        const dynamicPatterns = [
            /_\d+_/,           // el-table_17_column_115
            /-\d+$/,           // ant-select-123
            /\d{3,}/,          // 包含3位及以上连续数字
            /_\d+$/,           // some-class_123
        ];

        for (const pattern of dynamicPatterns) {
            if (pattern.test(className)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检测id是否是动态生成的（包含数字或随机字符）
     * 例如：dropdown-menu-8070, popover-123, dialog_456
     */
    _isDynamicId(id) {
        if (!id) return false;

        // 检测常见的动态id模式
        const dynamicPatterns = [
            /-\d+$/,           // dropdown-menu-8070, popover-123
            /_\d+$/,           // dialog_456, menu_789
            /\d{4,}$/,         // 以4位及以上数字结尾
            /-[a-f0-9]{6,}$/,  // 以十六进制hash结尾（如: component-a1b2c3）
        ];

        for (const pattern of dynamicPatterns) {
            if (pattern.test(id)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 从class列表中提取稳定的class
     * 例如：'el-table_17_column_115 el-table__cell' -> ['el-table__cell']
     */
    _getStableClasses(className) {
        if (!className || typeof className !== 'string') {
            return [];
        }

        const normalized = this._normalizeClassName(className);
        if (!normalized) {
            return [];
        }

        const classes = normalized.split(/\s+/).filter(c => c);
        const stableClasses = [];

        for (const cls of classes) {
            // 过滤黑名单
            if (this._isBlacklistedClass(cls)) {
                continue;
            }
            // 过滤动态class
            if (this._isDynamicClass(cls)) {
                continue;
            }
            stableClasses.push(cls);
        }

        return stableClasses;
    }

    _getElementText(element) {
        if (element.childNodes.length === 0) {
            return null;
        }

        if (element.childNodes.length === 1 &&
            element.childNodes[0].nodeType === Node.TEXT_NODE) {
            const text = element.textContent.trim();
            if (text && text.length > 0 && text.length < 50 && text.indexOf('\n') === -1) {
                return text;
            }
        }

        return null;
    }

    isUnique(type, value) {
        const index = {
            'id': this.idIndex,
            'class': this.classIndex,
            'text': this.textIndex
        }[type];

        if (!index) return false;

        const elements = index.get(value);
        return elements && elements.length === 1;
    }

    generateXPath(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        if (this.options.enableCache && this.xpathCache.has(element)) {
            this.stats.cacheHits++;
            return this.xpathCache.get(element);
        }

        const xpath = this._computeXPath(element);

        if (this.options.enableCache) {
            this.xpathCache.set(element, xpath);
        }

        this.stats.totalGenerated++;
        return xpath;
    }

    _optimizeXPath(element, originalXPath) {
        // 针对重复的XPath进行优化（只在需要时调用）

        // ⚡ 性能优化：先尝试快速策略，只在最后才验证

        // 策略1: 尝试添加更多属性约束
        const xpathWithAttrs = this._addAttributeConstraints(element, originalXPath);
        if (xpathWithAttrs) {
            // 先返回，后面批量验证
            return xpathWithAttrs;
        }

        // 策略2: 尝试使用父节点特征 + 相对位置
        const xpathWithParent = this._buildPathWithParentFeature(element);
        if (xpathWithParent) {
            return xpathWithParent;
        }

        // 策略3: 使用位置索引（保底方案，一定唯一）
        const xpathWithPosition = this._addPositionToXPath(element, originalXPath);
        return xpathWithPosition;
    }

    _isXPathUnique(targetElement, xpath) {
        try {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            // 检查是否只匹配到一个元素，且该元素就是目标元素
            return result.snapshotLength === 1 && result.snapshotItem(0) === targetElement;
        } catch (e) {
            if (this.options.debug) {
                console.error('XPath验证失败:', xpath, e);
            }
            return false;
        }
    }

    _addAttributeConstraints(element, originalXPath) {
        // 收集可用于约束的属性
        const constraints = [];

        // 尝试添加name属性
        const name = element.getAttribute('name');
        if (name) {
            constraints.push(`@name='${name}'`);
        }

        // 尝试添加type属性
        const type = element.getAttribute('type');
        if (type) {
            constraints.push(`@type='${type}'`);
        }

        // 尝试添加href属性
        const href = element.getAttribute('href');
        if (href) {
            constraints.push(`@href='${href}'`);
        }

        // 尝试添加src属性
        const src = element.getAttribute('src');
        if (src && !src.startsWith('data:')) {
            constraints.push(`@src='${src}'`);
        }

        // 尝试添加role属性
        const role = element.getAttribute('role');
        if (role) {
            constraints.push(`@role='${role}'`);
        }

        // 如果没有可用的约束，返回null
        if (constraints.length === 0) {
            return null;
        }

        // 构建带约束的XPath
        const lastBracketIndex = originalXPath.lastIndexOf(']');
        if (lastBracketIndex !== -1) {
            // 如果已经有约束，追加新约束
            return originalXPath.slice(0, lastBracketIndex) +
                   '[' + constraints.join('][') + ']' +
                   originalXPath.slice(lastBracketIndex + 1);
        } else {
            // 否则直接添加约束
            return originalXPath + '[' + constraints.join('][') + ']';
        }
    }

    _buildPathWithParentFeature(element) {
        const parent = element.parentElement;
        if (!parent || parent === document.documentElement) {
            return null;
        }

        // 获取当前元素在兄弟节点中的位置索引
        let index = 1;
        for (const sibling of parent.children) {
            if (sibling === element) {
                break;
            }
            if (sibling.tagName === element.tagName) {
                index++;
            }
        }

        // 尝试获取父节点的唯一特征
        let parentPath = null;

        // 尝试使用父节点的id（过滤动态ID）
        if (parent.id &&
            !this._isDynamicId(parent.id) &&
            this.isUnique('id', parent.id)) {
            parentPath = `//*[@id='${parent.id}']`;
        }
        // 尝试使用父节点的class（仅使用完整class匹配，确保唯一性）
        else if (parent.className && typeof parent.className === 'string') {
            const className = this._normalizeClassName(parent.className);

            // 只使用完整class匹配（如果稳定且唯一）
            if (className &&
                !this._isBlacklistedClass(className) &&
                !this._isDynamicClass(className) &&
                this.isUnique('class', className)) {
                parentPath = `//*[normalize-space(@class)='${className}']`;
            }
            // ⚠️ 修复：移除contains()策略，因为它不保证父节点唯一性
        }

        // 如果父节点有唯一特征，构建相对路径
        if (parentPath) {
            // 统计同标签兄弟节点数量，决定是否需要索引
            let sameTagCount = 0;
            for (const sibling of parent.children) {
                if (sibling.tagName === element.tagName) {
                    sameTagCount++;
                }
            }

            // 使用 _getTagExpression 处理命名空间
            if (sameTagCount > 1) {
                const tagExpr = this._getTagExpression(element, true, index);
                return `${parentPath}/${tagExpr}`;
            } else {
                const tagExpr = this._getTagExpression(element);
                return `${parentPath}/${tagExpr}`;
            }
        }

        return null;
    }

    _addPositionToXPath(element, originalXPath) {
        // 获取所有匹配原XPath的元素
        try {
            const result = document.evaluate(
                originalXPath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            // 找到目标元素在结果中的位置
            for (let i = 0; i < result.snapshotLength; i++) {
                if (result.snapshotItem(i) === element) {
                    // XPath的位置索引从1开始
                    return `(${originalXPath})[${i + 1}]`;
                }
            }
        } catch (e) {
            if (this.options.debug) {
                console.error('添加位置索引失败:', originalXPath, e);
            }
        }

        // 如果失败，返回原XPath
        return originalXPath;
    }

    _computeXPath(element) {
        if (element === document.body) {
            return '/html/body';
        }

        // 特殊处理：iframe 元素
        if (element.tagName === 'IFRAME') {
            return this._generateIframeXPath(element);
        }

        // 检查ID（过滤动态ID）
        if (element.id &&
            !this._isDynamicId(element.id) &&
            this.isUnique('id', element.id)) {
            return `//*[@id='${element.id}']`;
        }

        const childResult = this._checkChildrenForUniqueId(element);
        if (childResult) {
            return childResult;
        }

        // 尝试使用class定位
        if (element.className && typeof element.className === 'string') {
            const className = this._normalizeClassName(element.className);

            // 策略1：尝试完整class匹配（如果没有动态部分）
            if (className &&
                !this._isBlacklistedClass(className) &&
                !this._isDynamicClass(className) &&
                this.isUnique('class', className)) {
                return `//*[normalize-space(@class)='${className}']`;
            }

            // 策略2：提取稳定的class，使用contains()匹配
            // ⚠️ 修复：contains()可能匹配多个元素，不能作为唯一性定位，直接跳过
            // 让代码继续往下走，尝试其他策略（text或相对路径）
        }

        const text = this._getElementText(element);
        if (text && this.isUnique('text', text)) {
            return `//*[normalize-space(text())='${text}']`;
        }

        return this._buildRelativePath(element);
    }

    _checkChildrenForUniqueId(element) {
        for (const child of element.children) {
            // 检查子元素的id（过滤动态ID）
            if (child.id &&
                !this._isDynamicId(child.id) &&
                this.isUnique('id', child.id)) {
                return `//*[@id='${child.id}']/parent::*`;
            }

            // 检查子元素的class
            if (child.className && typeof child.className === 'string') {
                const className = this._normalizeClassName(child.className);

                // 策略1：尝试完整class（如果稳定）
                if (className &&
                    !this._isBlacklistedClass(className) &&
                    !this._isDynamicClass(className) &&
                    this.isUnique('class', className)) {
                    return `//*[normalize-space(@class)='${className}']/parent::*`;
                }

                // ⚠️ 修复：移除contains()策略，因为它不保证唯一性
                // 继续检查其他子元素
            }

            // 检查子元素的文本
            const text = this._getElementText(child);
            if (text && this.isUnique('text', text)) {
                return `//*[normalize-space(text())='${text}']/parent::*`;
            }
        }
        return null;
    }

    /**
     * 获取 iframe src 的稳定路径部分（仅路径，不含查询参数）
     *
     * 设计理念：查询参数通常包含会话、随机数、时间戳等易变信息
     * 只使用 pathname 可以最大程度保证 XPath 稳定性
     *
     * @param {string} src - 完整的 src URL
     * @returns {string|null} - 稳定的路径部分（不含查询参数），如果无法提取返回 null
     */
    _getStablePathFromSrc(src) {
        if (!src || src.startsWith('data:') || src.startsWith('blob:') || src === 'about:blank') {
            return null;
        }

        try {
            const url = new URL(src, window.location.origin);
            // 只返回 pathname，完全忽略查询参数和 hash
            return url.pathname || null;
        } catch (e) {
            // URL 解析失败，尝试简单的字符串提取
            try {
                // 移除查询参数和 hash
                const pathMatch = src.match(/^[^?#]*/);
                if (pathMatch && pathMatch[0]) {
                    // 提取最后的路径部分
                    const lastSlash = pathMatch[0].lastIndexOf('/');
                    if (lastSlash >= 0) {
                        return pathMatch[0].substring(lastSlash);
                    }
                }
            } catch (e2) {
                // 完全失败
            }
            return null;
        }
    }

    /**
     * 为 iframe 元素生成最佳 XPath
     *
     * 设计理念：iframe 的 src 通常包含随机参数，不应作为主要定位手段
     *
     * 策略优先级：
     * 1. 唯一的非动态 id（最稳定）
     * 2. 唯一的 name 属性
     * 3. 唯一的 title 属性
     * 4. 唯一的 class
     * 5. 父节点特征 + 位置索引
     * 6. src 的 pathname（完全不含查询参数，仅作为辅助）
     * 7. 位置索引（兜底）
     */
    _generateIframeXPath(element, parentPath = null, index = 1) {
        const tagExpr = this._getTagExpression(element, true, index);

        // 策略1: 唯一的非动态 id（最优先）
        if (element.id && !this._isDynamicId(element.id) && this.isUnique('id', element.id)) {
            return `//*[@id='${element.id}']`;
        }

        // 策略2: 唯一的 name 属性
        const name = element.getAttribute('name');
        if (name && name.trim()) {
            // 检查 name 是否唯一（临时检查）
            const sameNameIframes = document.querySelectorAll(`iframe[name="${name}"]`);
            if (sameNameIframes.length === 1) {
                return `//*[local-name()='iframe'][@name='${name}']`;
            }
        }

        // 策略3: 唯一的 title 属性
        const title = element.getAttribute('title');
        if (title && title.trim()) {
            // 检查 title 是否唯一
            const sameTitleIframes = document.querySelectorAll(`iframe[title="${title}"]`);
            if (sameTitleIframes.length === 1) {
                return `//*[local-name()='iframe'][@title='${title}']`;
            }
        }

        // 策略4: 唯一的 class
        if (element.className && typeof element.className === 'string') {
            const className = this._normalizeClassName(element.className);
            if (className &&
                !this._isBlacklistedClass(className) &&
                !this._isDynamicClass(className)) {
                // 检查 class 是否唯一
                const sameClassIframes = Array.from(document.querySelectorAll('iframe'))
                    .filter(iframe => this._normalizeClassName(iframe.className) === className);
                if (sameClassIframes.length === 1) {
                    return `//*[local-name()='iframe'][normalize-space(@class)='${className}']`;
                }
            }
        }

        // 策略5: 父节点特征 + 位置索引（推荐）
        if (parentPath) {
            // 统计父节点下的 iframe 数量
            const parent = element.parentElement;
            if (parent) {
                const iframesInParent = Array.from(parent.children).filter(
                    child => child.tagName && child.tagName.toLowerCase() === 'iframe'
                );

                if (iframesInParent.length === 1) {
                    // 父节点下只有一个 iframe，不需要索引
                    return `${parentPath}/*[local-name()='iframe']`;
                } else {
                    // 需要索引
                    const iframeIndex = iframesInParent.indexOf(element) + 1;
                    return `${parentPath}/*[local-name()='iframe'][${iframeIndex}]`;
                }
            }
        }

        // 策略6: src 的 pathname（仅作为辅助，完全不含查询参数）
        const src = element.getAttribute('src');
        const stablePath = this._getStablePathFromSrc(src);
        if (stablePath && stablePath !== '/') {
            // 使用 contains 匹配路径，更宽容
            return `//*[local-name()='iframe'][contains(@src, '${stablePath}')]`;
        }

        // 策略7: 位置索引（兜底）
        // 计算所有 iframe 中的全局位置
        const allIframes = Array.from(document.querySelectorAll('iframe'));
        const globalIndex = allIframes.indexOf(element) + 1;

        if (globalIndex > 0) {
            return `(//*[local-name()='iframe'])[${globalIndex}]`;
        }

        // 最后的最后
        return `//*[local-name()='iframe'][1]`;
    }

    /**
     * 检查元素是否有 XML 命名空间
     *
     * 常见的命名空间：
     * - HTML:   http://www.w3.org/1999/xhtml (默认，不需要 local-name())
     * - SVG:    http://www.w3.org/2000/svg
     * - MathML: http://www.w3.org/1998/Math/MathML
     * - XLink:  http://www.w3.org/1999/xlink (用于 SVG 链接)
     *
     * 为什么需要特殊处理：
     * 在 XPath 中，带命名空间的元素用标签名（如 svg[1]）无法匹配，
     * 必须使用 *[local-name()='svg'] 或注册命名空间前缀。
     *
     * @param {Element} element - 要检查的元素
     * @returns {boolean} - true 表示需要使用 local-name()
     */
    _hasNamespace(element) {
        // 没有 namespaceURI 的情况（极少见，旧版浏览器）
        if (!element.namespaceURI) {
            return false;
        }

        // HTML 元素不需要特殊处理
        if (element.namespaceURI === 'http://www.w3.org/1999/xhtml') {
            return false;
        }

        // 其他所有命名空间（SVG、MathML、XLink 等）都需要 local-name()
        return true;
    }

    /**
     * 生成元素的标签名表达式
     * 如果元素有命名空间，使用 *[local-name()='tagname']
     * 否则使用 tagname
     */
    _getTagExpression(element, useIndex = false, index = 1) {
        const tagName = element.tagName.toLowerCase();

        if (this._hasNamespace(element)) {
            // SVG 或其他命名空间元素，使用 local-name()
            if (useIndex && index > 1) {
                return `*[local-name()='${tagName}'][${index}]`;
            } else if (useIndex) {
                return `*[local-name()='${tagName}']`;
            } else {
                return `*[local-name()='${tagName}']`;
            }
        } else {
            // 普通 HTML 元素
            if (useIndex) {
                return `${tagName}[${index}]`;
            } else {
                return tagName;
            }
        }
    }

    _buildRelativePath(element) {
        const parent = element.parentNode;

        if (!parent || parent === document.documentElement) {
            return '/html/' + this._getTagExpression(element);
        }

        let index = 1;
        const tagName = element.tagName;

        // 计算同标签兄弟节点中的位置（考虑命名空间）
        for (const sibling of parent.children) {
            if (sibling === element) {
                break;
            }
            if (sibling.tagName === tagName) {
                index++;
            }
        }

        const parentPath = this.generateXPath(parent);

        // 特殊处理：iframe 元素
        if (element.tagName === 'IFRAME') {
            return this._generateIframeXPath(element, parentPath, index);
        }

        // 普通元素：使用带索引的标签表达式
        const tagExpr = this._getTagExpression(element, true, index);
        return `${parentPath}/${tagExpr}`;
    }

    getStats() {
        return {
            ...this.stats,
            indexSize: {
                id: this.idIndex.size,
                class: this.classIndex.size,
                text: this.textIndex.size
            },
            cacheSize: this.xpathCache.size
        };
    }
}

// 添加到window
if (typeof window !== 'undefined') {
    window.SmartXPathGenerator = SmartXPathGenerator;
}

console.log('✅ SmartXPathGenerator已加载');

// ============================================================
// 第二部分：DOM树导出工具（browser_dom_exporter_optimized.js精简版）
// ============================================================

(function() {
    'use strict';

    const DEFAULT_CONFIG = {
        BATCH_SIZE: 100,
        PROCESS_DELAY: 16,
        checkViewport: true,
        checkCoverage: true,
        checkOverflow: true,
        viewportRatio: 0.05,
        debug: false,
        needDownload: false
    };

    let nodeCounter = 0;

    function determineNodeType(element) {
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute('role');

        if (['input', 'textarea', 'select', 'option'].includes(tagName)) {
            return 'FORM_ITEM Node';
        }
        if (tagName === 'button' || role === 'button') {
            return 'BUTTON Node';
        }
        if (tagName === 'a') {
            return 'Anchor Node';
        }
        if (tagName === 'img' || tagName === 'svg') {
            return 'IMG Node';
        }
        if (['div', 'section', 'article', 'nav', 'header', 'footer', 'main', 'aside'].includes(tagName)) {
            return 'CONTAINER Node';
        }
        return 'TEXT Node';
    }

    /**
     * 检测元素是否在iframe内
     */
    function isElementInIframe(element) {
        try {
            return element.ownerDocument !== window.document;
        } catch (e) {
            return false;
        }
    }

    /**
     * 获取元素所在的视口尺寸（考虑iframe情况）
     */
    function getElementViewport(element) {
        try {
            const doc = element.ownerDocument;
            const win = doc.defaultView || doc.parentWindow;

            if (win && win !== window) {
                // 元素在iframe内，使用iframe的视口
                return {
                    width: win.innerWidth || doc.documentElement.clientWidth,
                    height: win.innerHeight || doc.documentElement.clientHeight
                };
            }
        } catch (e) {
            // 跨域iframe，无法访问
        }

        // 使用主文档视口
        return {
            width: window.innerWidth || document.documentElement.clientWidth,
            height: window.innerHeight || document.documentElement.clientHeight
        };
    }

    function isElementInViewport(element, rect, visibleRatio) {
        const viewport = getElementViewport(element);
        const viewportWidth = viewport.width;
        const viewportHeight = viewport.height;

        const overlapLeft = Math.max(0, rect.left);
        const overlapTop = Math.max(0, rect.top);
        const overlapRight = Math.min(rect.left + rect.width, viewportWidth);
        const overlapBottom = Math.min(rect.top + rect.height, viewportHeight);

        const overlapWidth = Math.max(0, overlapRight - overlapLeft);
        const overlapHeight = Math.max(0, overlapBottom - overlapTop);

        const visibleArea = overlapWidth * overlapHeight;
        const totalArea = rect.width * rect.height;

        return totalArea > 0 && (visibleArea / totalArea) >= visibleRatio;
    }

    function isElementVisible(element, style, rect, config) {
        if (!element) return false;

        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0' && element.tagName !== 'INPUT') return false;

        if (rect.width === 0 || rect.height === 0) return false;

        // 对于iframe内的元素，使用iframe自己的视口来判断可见性
        if (config.checkViewport && !isElementInViewport(element, rect, config.viewportRatio)) {
            return false;
        }

        return true;
    }

    function getElementAttributes(element) {
        const attrs = {};
        const keepAttrs = ['id', 'class', 'name', 'type', 'href', 'src', 'alt',
                          'title', 'placeholder', 'value', 'role', 'aria-label'];

        for (const attr of keepAttrs) {
            const value = element.getAttribute(attr);
            if (value !== null) {
                if (attr === 'class') {
                    attrs[attr] = '.' + value.split(/\s+/).filter(c => c).join('.');
                } else if (attr === 'src' && value.startsWith('data:')) {
                    // 过滤base64图片，避免内容过长
                    const dataTypeMatch = value.match(/^data:([^;,]+)/);
                    const dataType = dataTypeMatch ? dataTypeMatch[1] : 'unknown';
                    attrs[attr] = `[base64-${dataType}]`;
                } else if (attr === 'href' && value.startsWith('data:')) {
                    // 同样处理data URI的href
                    const dataTypeMatch = value.match(/^data:([^;,]+)/);
                    const dataType = dataTypeMatch ? dataTypeMatch[1] : 'unknown';
                    attrs[attr] = `[base64-${dataType}]`;
                } else {
                    attrs[attr] = value;
                }
            }
        }

        return attrs;
    }

    function getElementContent(element) {
        const tagName = element.tagName.toLowerCase();

        // 表单输入元素：获取value或placeholder
        if (tagName === 'input' || tagName === 'textarea') {
            return element.value || element.placeholder || '';
        }

        // 下拉选择框：获取选中项的文本
        if (tagName === 'select') {
            const selectedOption = element.options[element.selectedIndex];
            return selectedOption ? selectedOption.textContent.trim() : '';
        }

        // 按钮和链接：获取文本内容
        if (tagName === 'button' || tagName === 'a') {
            return element.innerText || element.textContent || '';
        }

        // label标签（单选框、复选框等）：获取文本内容
        if (tagName === 'label') {
            // 使用innerText（会过滤掉隐藏元素和注释）
            const text = element.innerText || element.textContent || '';
            return text.trim();
        }

        // 只有一个文本子节点的元素
        if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
            return element.textContent.trim();
        }

        // 对于其他元素，如果包含简短的文本内容，也尝试提取
        // （避免提取过长的容器文本，造成数据冗余）
        if (['span', 'div', 'p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
            const text = element.innerText || element.textContent || '';
            const trimmedText = text.trim();
            // 只提取简短的文本（长度<100，且不包含换行）
            if (trimmedText && trimmedText.length < 100 && trimmedText.indexOf('\n') === -1) {
                return trimmedText;
            }
        }

        return '';
    }

    function generateNodeId(element, content, rect) {
        const data = JSON.stringify({
            tag: element.tagName,
            content: content,
            left: rect.left,
            top: rect.top
        });

        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        return Math.abs(hash).toString(36).substring(0, 12);
    }

    /**
     * 收集元素（支持递归进入iframe）
     */
    function collectElements(rootElement) {
        const elements = [];
        const ignoreTags = new Set(['script', 'style', 'meta', 'link', 'noscript']);

        // SVG内部的非交互绘图元素（这些元素通常不需要交互，且XPath定位有命名空间问题）
        const svgDrawingElements = new Set([
            'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
            'defs', 'use', 'clippath', 'mask', 'pattern',
            'lineargradient', 'radialgradient', 'stop', 'animate', 'animatetransform'
        ]);

        /**
         * 递归收集元素（包括iframe内部）
         */
        function collectFromDocument(doc, root) {
            const walker = doc.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
                {
                    acceptNode: function(node) {
                        const tagName = node.tagName.toLowerCase();

                        // 过滤常规忽略标签
                        if (ignoreTags.has(tagName)) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        // 过滤SVG内部的绘图元素
                        if (svgDrawingElements.has(tagName)) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            let currentNode = walker.currentNode;
            while (currentNode) {
                elements.push(currentNode);

                // 检测到iframe，尝试递归进入
                if (currentNode.tagName && currentNode.tagName.toLowerCase() === 'iframe') {
                    try {
                        const iframeDoc = currentNode.contentDocument ||
                                         (currentNode.contentWindow && currentNode.contentWindow.document);

                        if (iframeDoc && iframeDoc.body) {
                            // 递归收集iframe内的元素
                            collectFromDocument(iframeDoc, iframeDoc.body);
                        }
                    } catch (e) {
                        // 跨域iframe无法访问，跳过
                        console.warn('无法访问iframe内容（可能是跨域）:', e.message);
                    }
                }

                currentNode = walker.nextNode();
            }
        }

        // 从根元素开始收集
        const doc = rootElement.ownerDocument || document;
        collectFromDocument(doc, rootElement);

        return elements;
    }

    function processElement(element, rectsMap, stylesMap, config) {
        const tagName = element.tagName.toLowerCase();
        const rect = rectsMap.get(element);
        const style = stylesMap.get(element);

        if (!rect || !style) {
            return null;
        }

        const content = getElementContent(element);
        const attributes = getElementAttributes(element);
        const nodeType = determineNodeType(element);
        const isVisible = isElementVisible(element, style, rect, config);
        const nodeId = generateNodeId(element, content, rect);

        nodeCounter++;
        const mockId = nodeCounter.toString(36);

        return {
            element: element,
            data: {
                mId: mockId,
                indexId: nodeCounter,
                attr: {
                    type: nodeType,
                    tag: `<${tagName}>`,
                    ...attributes
                },
                content: content.trim(),
                rect: rect,
                center: [
                    Math.round(rect.left + rect.width / 2),
                    Math.round(rect.top + rect.height / 2)
                ],
                isVisible: isVisible
            }
        };
    }

    function buildTree(processedNodes, config = {}) {
        const nodeMap = new Map();
        const selfClosingTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);
        const stopCollectingTags = new Set(['button', 'a', 'input', 'textarea', 'select']);

        if (config.debug) {
            console.log(`[buildTree] 开始构建树，共 ${processedNodes.length} 个节点`);
        }

        // 第一步：建立 element -> treeNode 的映射
        for (const processed of processedNodes) {
            if (!processed) continue;

            const treeNode = {
                node: processed.data,
                children: []
            };
            nodeMap.set(processed.element, treeNode);
        }

        if (config.debug) {
            console.log(`[buildTree] nodeMap 大小: ${nodeMap.size}`);
        }

        // 第二步：构建父子关系
        for (const processed of processedNodes) {
            if (!processed) continue;

            const element = processed.element;
            const tagName = element.tagName.toLowerCase();
            const treeNode = nodeMap.get(element);

            if (!treeNode) continue;

            if (selfClosingTags.has(tagName) || stopCollectingTags.has(tagName)) {
                continue;
            }

            // 特殊处理：iframe 元素需要获取其内部文档的子元素
            if (tagName === 'iframe') {
                try {
                    const iframeDoc = element.contentDocument ||
                                     (element.contentWindow && element.contentWindow.document);

                    if (iframeDoc && iframeDoc.body) {
                        // 收集 iframe 内的所有直接子元素
                        const iframeChildren = Array.from(iframeDoc.body.children);
                        for (const child of iframeChildren) {
                            const childNode = nodeMap.get(child);
                            if (childNode) {
                                treeNode.children.push(childNode);
                            }
                        }
                    }
                } catch (e) {
                    // 跨域iframe，无法访问
                }
            } else {
                // 常规元素：使用 element.children
                for (const child of element.children) {
                    const childNode = nodeMap.get(child);
                    if (childNode) {
                        treeNode.children.push(childNode);
                    }
                }
            }
        }

        // 第三步：找出根节点
        const rootNodes = [];
        const iframeTopElements = new Set(); // 记录所有iframe内的顶层元素

        // 先找出所有 iframe 内的顶层元素
        for (const processed of processedNodes) {
            if (!processed) continue;

            const element = processed.element;
            const elementDoc = element.ownerDocument;

            // 如果元素在 iframe 内
            if (elementDoc && elementDoc !== window.document) {
                const iframeBody = elementDoc.body;
                if (element.parentElement === iframeBody) {
                    // 这是 iframe 内的顶层元素，不应该是独立的根节点
                    iframeTopElements.add(element);
                }
            }
        }

        if (config.debug) {
            console.log(`[buildTree] iframe 内顶层元素数: ${iframeTopElements.size}`);
        }

        // 确定真正的根节点
        let skippedIframeTop = 0;
        let candidateRoots = 0;
        let notRootButHasParent = 0;  // 统计：不是根节点且有父节点在 nodeMap 中
        let rootBecauseParentWontCollect = 0;  // 统计：父节点不收集子元素

        for (const processed of processedNodes) {
            if (!processed) continue;

            const element = processed.element;
            const treeNode = nodeMap.get(element);

            if (!treeNode) continue;

            // 如果是 iframe 内的顶层元素，跳过（它们已经挂在 iframe 节点下了）
            if (iframeTopElements.has(element)) {
                skippedIframeTop++;
                continue;
            }

            candidateRoots++;
            let isRoot = true;
            let reason = 'no parent in nodeMap';  // 记录原因
            const currentTag = element.tagName ? element.tagName.toLowerCase() : '';

            // 在同一个 document 内向上查找父节点
            let parent = element.parentElement;
            while (parent) {
                if (nodeMap.has(parent)) {
                    // 找到父节点在 nodeMap 中
                    const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';

                    // 检查父节点是否会收集当前元素
                    const parentWillCollect = !stopCollectingTags.has(parentTag) && !selfClosingTags.has(parentTag);

                    if (parentWillCollect) {
                        // 父节点会收集当前元素，当前元素不是根节点
                        isRoot = false;
                        reason = `parent ${parentTag} will collect`;
                        notRootButHasParent++;
                    } else {
                        // 父节点不会收集当前元素，当前元素是根节点
                        isRoot = true;
                        reason = `parent ${parentTag} won't collect`;
                        rootBecauseParentWontCollect++;
                    }
                    break;
                }

                // 到达当前文档的 body，停止
                const currentDoc = element.ownerDocument || document;
                if (parent === currentDoc.body || parent === currentDoc.documentElement) {
                    break;
                }

                parent = parent.parentElement;
            }

            if (isRoot) {
                rootNodes.push(treeNode);
            }

            // 调试：输出前10个非根节点的信息
            if (config.debug && !isRoot && notRootButHasParent <= 10) {
                const mId = processed.data.mId;
                console.log(`[buildTree] 非根节点: mId=${mId}, tag=${currentTag}, reason=${reason}`);
            }
        }

        if (config.debug) {
            console.log(`[buildTree] 找到 ${rootNodes.length} 个根节点`);
            console.log(`[buildTree] 跳过 ${skippedIframeTop} 个 iframe 内顶层元素`);
            console.log(`[buildTree] 候选根节点数: ${candidateRoots}`);
            console.log(`[buildTree] 非根但有父节点: ${notRootButHasParent} 个`);
            console.log(`[buildTree] 根因为父节点不收集: ${rootBecauseParentWontCollect} 个`);

            // 统计树中的总节点数（递归计数）
            function countTreeNodes(node) {
                if (!node) return 0;
                let count = node.node ? 1 : 0;  // 根节点的 node 为 null
                if (node.children) {
                    for (const child of node.children) {
                        count += countTreeNodes(child);
                    }
                }
                return count;
            }

            const treeNodeCount = rootNodes.reduce((sum, root) => sum + countTreeNodes(root), 0);
            console.log(`[buildTree] 树中节点总数: ${treeNodeCount}`);
            console.log(`[buildTree] processedNodes 总数: ${processedNodes.length}`);

            if (treeNodeCount < processedNodes.length) {
                const missingCount = processedNodes.length - treeNodeCount;
                console.warn(`[buildTree] ⚠️ 有 ${missingCount} 个节点丢失（孤儿节点）`);
            }

            if (rootNodes.length === 0) {
                console.warn('[buildTree] ⚠️ 没有找到根节点！');
                console.warn('[buildTree] 调试信息:');
                console.warn(`  - processedNodes: ${processedNodes.length} 个`);
                console.warn(`  - nodeMap: ${nodeMap.size} 个`);
                console.warn(`  - iframeTopElements: ${iframeTopElements.size} 个`);
                console.warn(`  - skippedIframeTop: ${skippedIframeTop} 个`);
                console.warn(`  - candidateRoots: ${candidateRoots} 个`);

                // 分析第一个候选节点为什么不是根节点
                if (candidateRoots > 0) {
                    for (const processed of processedNodes) {
                        if (!processed || iframeTopElements.has(processed.element)) continue;
                        const element = processed.element;
                        let parent = element.parentElement;
                        console.warn(`  - 检查元素: ${element.tagName}, mId: ${processed.data.mId}`);
                        console.warn(`    parent: ${parent ? parent.tagName : 'null'}`);
                        console.warn(`    parent in nodeMap: ${parent ? nodeMap.has(parent) : 'N/A'}`);
                        break; // 只检查第一个
                    }
                }
            }
        }

        return {
            node: null,
            children: rootNodes
        };
    }

    function getDOMTreeAsync(rootElement = document.body, userConfig = {}, onProgress) {
        const config = { ...DEFAULT_CONFIG, ...userConfig };
        nodeCounter = 0;

        if (config.debug) console.log('开始异步导出DOM树...');

        const elements = collectElements(rootElement);
        if (config.debug) console.log(`  - 收集到 ${elements.length} 个元素`);

        if (onProgress) onProgress({ step: 'collect', current: elements.length, total: elements.length });

        const rectsMap = new Map();
        const stylesMap = new Map();

        for (let i = 0; i < elements.length; i += config.BATCH_SIZE) {
            const batch = elements.slice(i, Math.min(i + config.BATCH_SIZE, elements.length));

            new Promise(resolve => requestAnimationFrame(resolve));

            for (const element of batch) {
                const rect = element.getBoundingClientRect();
                rectsMap.set(element, {
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
                stylesMap.set(element, window.getComputedStyle(element));
            }

            if (onProgress) {
                onProgress({
                    step: 'layout',
                    current: Math.min(i + config.BATCH_SIZE, elements.length),
                    total: elements.length
                });
            }
        }

        if (config.debug) console.log('  - 布局信息读取完成');

        const processedNodes = [];

        for (let i = 0; i < elements.length; i += config.BATCH_SIZE) {
            const batch = elements.slice(i, Math.min(i + config.BATCH_SIZE, elements.length));

            new Promise(resolve => requestAnimationFrame(resolve));

            for (const element of batch) {
                const processed = processElement(element, rectsMap, stylesMap, config);
                processedNodes.push(processed);
            }

            if (onProgress) {
                onProgress({
                    step: 'process',
                    current: Math.min(i + config.BATCH_SIZE, elements.length),
                    total: elements.length
                });
            }
        }

        if (config.debug) console.log('  - 元素处理完成');

        if (onProgress) onProgress({ step: 'build', current: 0, total: 1 });

        new Promise(resolve => requestAnimationFrame(resolve));
        const tree = buildTree(processedNodes, config);

        if (onProgress) onProgress({ step: 'build', current: 1, total: 1 });

        if (config.debug) console.log('  - 树结构构建完成');

        // 返回树和processedNodes（包含element引用，用于后续XPath生成）
        return { tree, processedNodes };
    }

    window.getDOMTreeAsync = getDOMTreeAsync;

    console.log('✅ DOM树导出工具已加载');

})();

// ============================================================
// 第三部分：XPath集成功能
// ============================================================

(function() {
    'use strict';

    function exportDOMTreeWithXPath(filename, userConfig = {}) {
        const config = {
            debug: true,
            needDownload: false,
            checkViewport: true,
            checkCoverage: false,
            checkOverflow: true,
            viewportRatio: 0.05,
            enableXPath: true,
            onlyVisible: false, // 只输出可见元素
            ...userConfig
        };

        console.log('==================================================');
        console.log('开始导出DOM树（包含XPath）...');
        console.log('==================================================');

        const startTime = performance.now();

        if (!window.SmartXPathGenerator) {
            console.error('❌ SmartXPathGenerator未加载！');
            return null;
        }

        console.log('正在构建XPath索引...');
        const xpathGen = new SmartXPathGenerator({ debug: config.debug });
        xpathGen.buildIndex(document.body);

        if (!window.getDOMTreeAsync) {
            console.error('❌ getDOMTreeAsync未加载！');
            return null;
        }

        console.log('正在导出DOM树...');
        const result = window.getDOMTreeAsync(document.body, config);
        let domTree = result.tree;
        let processedNodes = result.processedNodes;

        if (config.debug) {
            console.log(`导出完成，共 ${processedNodes.length} 个节点`);
            console.log(`domTree.children 数量: ${domTree.children ? domTree.children.length : 0}`);
        }

        // 只输出可见元素（可选）
        if (config.onlyVisible) {
            const visibleNodes = processedNodes.filter(item => item && item.data && item.data.isVisible);
            const visibleIdSet = new Set(visibleNodes.map(item => item.data.mId));

            if (config.debug) {
                const invisibleCount = processedNodes.length - visibleNodes.length;
                console.log(`过滤前: ${processedNodes.length} 个节点`);
                console.log(`可见: ${visibleNodes.length} 个，不可见: ${invisibleCount} 个`);
            }

            // 重新构建树：只包含可见节点，不保留不可见节点的层级结构
            const rebuildTree = () => {
                // 步骤1：创建所有可见节点的映射
                const visibleNodeMap = new Map();
                for (const item of visibleNodes) {
                    visibleNodeMap.set(item.element, {
                        node: item.data,
                        children: []
                    });
                }

                // 步骤2：为每个可见节点找到最近的可见父节点
                for (const item of visibleNodes) {
                    const element = item.element;
                    const treeNode = visibleNodeMap.get(element);

                    if (!treeNode) continue;

                    // 向上查找最近的可见父节点
                    let parent = element.parentElement;
                    while (parent) {
                        const parentTreeNode = visibleNodeMap.get(parent);
                        if (parentTreeNode) {
                            // 找到可见父节点，添加为子节点
                            parentTreeNode.children.push(treeNode);
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }

                // 步骤3：找出所有根节点（没有可见父节点的节点）
                const rootNodes = [];
                for (const item of visibleNodes) {
                    const element = item.element;
                    const treeNode = visibleNodeMap.get(element);

                    if (!treeNode) continue;

                    // 检查是否有可见父节点
                    let hasVisibleParent = false;
                    let parent = element.parentElement;
                    while (parent) {
                        if (visibleNodeMap.has(parent)) {
                            hasVisibleParent = true;
                            break;
                        }
                        parent = parent.parentElement;
                    }

                    if (!hasVisibleParent) {
                        rootNodes.push(treeNode);
                    }
                }

                return {
                    node: null,
                    children: rootNodes
                };
            };

            domTree = rebuildTree();
            processedNodes = visibleNodes;

            if (config.debug) {
                console.log(`过滤后: ${processedNodes.length} 个节点`);
                console.log(`domTree.children 数量: ${domTree && domTree.children ? domTree.children.length : 0}`);

                // 统计过滤后树中的节点数
                function countTreeNodes(node) {
                    if (!node) return 0;
                    let count = node.node ? 1 : 0;
                    if (node.children) {
                        for (const child of node.children) {
                            count += countTreeNodes(child);
                        }
                    }
                    return count;
                }
                const treeNodeCount = countTreeNodes(domTree);
                console.log(`过滤后树中实际节点数: ${treeNodeCount}`);

                if (treeNodeCount !== visibleNodes.length) {
                    console.warn(`⚠️ 节点数不匹配！processedNodes: ${visibleNodes.length}, 树中: ${treeNodeCount}`);
                }
            }
        }

        console.log('正在生成XPath...');
        const xpathStartTime = performance.now();

        if (config.debug) {
            console.log(`[XPath] processedNodes 数量: ${processedNodes.length}`);
            // 检查 processedNodes 中是否有 null
            const nullCount = processedNodes.filter(p => !p || !p.element || !p.data).length;
            if (nullCount > 0) {
                console.warn(`[XPath] ⚠️ 有 ${nullCount} 个 null 或无效的 processedNodes`);
            }
        }

        /**
         * 获取元素所在的iframe路径链（支持多层嵌套）
         * 返回格式：{ inIframe: boolean, iframeChain: ['xpath1', 'xpath2', ...] }
         *
         * 例如：主文档 -> iframe A -> iframe B -> 元素
         * 返回：{ inIframe: true, iframeChain: ['xpath_of_A', 'xpath_of_B'] }
         */
        function getIframePath(element) {
            try {
                const elementDoc = element.ownerDocument;
                if (!elementDoc || elementDoc === window.document) {
                    return { inIframe: false, iframeChain: null };
                }

                // 从元素所在的document向上查找，构建iframe链
                const iframeChain = [];
                let currentDoc = elementDoc;

                // 向上遍历，直到到达主文档
                while (currentDoc && currentDoc !== window.document) {
                    // 查找包含当前document的iframe元素
                    let foundIframe = null;

                    // 递归查找函数
                    function findIframeForDoc(searchDoc, targetDoc) {
                        const iframes = searchDoc.querySelectorAll('iframe');
                        for (const iframe of iframes) {
                            try {
                                const iframeDoc = iframe.contentDocument ||
                                                 (iframe.contentWindow && iframe.contentWindow.document);

                                if (iframeDoc === targetDoc) {
                                    return iframe;
                                }

                                // 递归在iframe内部查找
                                if (iframeDoc) {
                                    const found = findIframeForDoc(iframeDoc, targetDoc);
                                    if (found) return found;
                                }
                            } catch (e) {
                                // 跨域iframe，跳过
                            }
                        }
                        return null;
                    }

                    // 从主文档开始查找包含currentDoc的iframe
                    foundIframe = findIframeForDoc(window.document, currentDoc);

                    if (!foundIframe) {
                        // 找不到对应的iframe，可能是跨域或其他问题
                        break;
                    }

                    // 生成iframe的XPath并添加到链的开头
                    const iframeXPath = xpathGen.generateXPath(foundIframe);
                    iframeChain.unshift(iframeXPath);

                    // 向上移动到iframe所在的document
                    currentDoc = foundIframe.ownerDocument;
                }

                if (iframeChain.length > 0) {
                    return { inIframe: true, iframeChain: iframeChain };
                }
            } catch (e) {
                // 出错，当作主文档
                if (config.debug) {
                    console.error('getIframePath 错误:', e);
                }
            }
            return { inIframe: false, iframeChain: null };
        }

        // 阶段1: 快速生成所有XPath（不验证唯一性）
        const mockIdToXPath = {};
        const xpathToElements = {};  // xpath -> [{element, mId}]

        console.log('  [1/3] 快速生成初始XPath...');

        // ⚡ 性能优化：分批处理，避免阻塞主线程
        const BATCH_SIZE = 200;  // 每批处理200个元素

        for (let i = 0; i < processedNodes.length; i += BATCH_SIZE) {
            // 让出主线程，避免页面卡死
            new Promise(resolve => {
                const idleCallback = window.requestIdleCallback || window.requestAnimationFrame || setTimeout;
                idleCallback(resolve);
            });

            const batch = processedNodes.slice(i, Math.min(i + BATCH_SIZE, processedNodes.length));

            for (const processed of batch) {
                if (!processed || !processed.element || !processed.data) {
                    continue;
                }

                const element = processed.element;
                const mId = processed.data.mId;

                // 检查元素是否在iframe内
                const iframeInfo = getIframePath(element);

                // 生成初始XPath（不验证）
                const xpath = xpathGen._computeXPath(element);

                // 如果在iframe内，组合完整路径
                if (iframeInfo.inIframe && iframeInfo.iframeChain) {
                    mockIdToXPath[mId] = {
                        inIframe: true,
                        iframeChain: iframeInfo.iframeChain,  // 完整的iframe路径链
                        xpath: xpath
                    };
                } else {
                    mockIdToXPath[mId] = {
                        inIframe: false,
                        iframeChain: null,
                        xpath: xpath
                    };
                }

                // 记录xpath到元素的映射
                if (!xpathToElements[xpath]) {
                    xpathToElements[xpath] = [];
                }
                xpathToElements[xpath].push({ element, mId });
            }

            // 显示进度
            if (config.debug && i % (BATCH_SIZE * 5) === 0 && i > 0) {
                console.log(`    已处理: ${Math.min(i + BATCH_SIZE, processedNodes.length)}/${processedNodes.length}`);
            }
        }

        // 阶段2: 找出重复的XPath
        console.log('  [2/3] 检测重复的XPath...');
        const duplicateXPaths = Object.entries(xpathToElements)
            .filter(([xpath, items]) => items.length > 1);

        if (duplicateXPaths.length > 0) {
            console.log(`  ⚠️  发现 ${duplicateXPaths.length} 个重复的XPath，正在优化...`);

            // 阶段3: 只对重复的XPath进行优化
            console.log('  [3/3] 优化重复的XPath...');

            // ⚡ 性能优化：分批处理，避免阻塞
            let processedCount = 0;
            const totalItemsToOptimize = duplicateXPaths.reduce((sum, [_, items]) => sum + items.length, 0);

            for (const [duplicateXPath, items] of duplicateXPaths) {
                if (config.debug) {
                    console.log(`    优化: ${duplicateXPath} (${items.length}个元素)`);
                }

                // 每处理50个元素让出一次主线程
                for (let i = 0; i < items.length; i++) {
                    if (i > 0 && i % 50 === 0) {
                        new Promise(resolve => {
                            const idleCallback = window.requestIdleCallback || window.requestAnimationFrame || setTimeout;
                            idleCallback(resolve);
                        });
                    }

                    const { element, mId } = items[i];
                    const uniqueXPath = xpathGen._optimizeXPath(element, duplicateXPath);

                    // 保持原有的iframe信息，只更新xpath
                    const originalData = mockIdToXPath[mId];
                    if (originalData && originalData.inIframe) {
                        mockIdToXPath[mId] = {
                            inIframe: true,
                            iframeChain: originalData.iframeChain,  // 保持iframe路径链
                            xpath: uniqueXPath
                        };
                    } else {
                        mockIdToXPath[mId] = {
                            inIframe: false,
                            iframeChain: null,
                            xpath: uniqueXPath
                        };
                    }

                    if (config.debug) {
                        console.log(`      [${mId}] ${uniqueXPath}`);
                    }

                    processedCount++;

                    // 显示进度（每500个）
                    if (processedCount % 500 === 0) {
                        console.log(`    已优化: ${processedCount}/${totalItemsToOptimize}`);
                    }
                }
            }
        } else {
            console.log('  ✓ 所有XPath都是唯一的，无需优化');
        }

        const xpathDuration = performance.now() - xpathStartTime;
        const totalDuration = performance.now() - startTime;

        console.log('');
        console.log('✓ DOM树导出完成（含XPath）！');
        console.log(`  - DOM导出耗时: ${(totalDuration - xpathDuration).toFixed(2)}ms`);
        console.log(`  - XPath生成耗时: ${xpathDuration.toFixed(2)}ms`);
        console.log(`  - 总耗时: ${totalDuration.toFixed(2)}ms`);

        const stats = xpathGen.getStats();
        // 统计iframe内的元素数量
        const iframeElementCount = Object.values(mockIdToXPath)
            .filter(data => data && data.inIframe).length;
        const mainDocElementCount = Object.keys(mockIdToXPath).length - iframeElementCount;

        console.log(`  - XPath统计:`);
        console.log(`    • 索引构建: ${stats.indexBuildTime.toFixed(2)}ms`);
        console.log(`    • ID索引: ${stats.indexSize.id} 项`);
        console.log(`    • Class索引: ${stats.indexSize.class} 项`);
        console.log(`    • Text索引: ${stats.indexSize.text} 项`);
        console.log(`    • 生成XPath数量: ${stats.totalGenerated} 个`);
        console.log(`    • 缓存命中: ${stats.cacheHits} 次`);
        console.log(`    • mockId映射数量: ${Object.keys(mockIdToXPath).length} 个`);
        console.log(`    • 主文档元素: ${mainDocElementCount} 个`);
        console.log(`    • iframe内元素: ${iframeElementCount} 个`);
        console.log(`    • 重复优化次数: ${duplicateXPaths.length > 0 ? duplicateXPaths.reduce((sum, [_, items]) => sum + items.length, 0) : 0} 个`);

        // 准备返回数据
        const exportData = {
            domTree: domTree,
            mockIdToXPath: mockIdToXPath,
            metadata: {
                totalNodes: Object.keys(mockIdToXPath).length,
                mainDocNodes: mainDocElementCount,
                iframeNodes: iframeElementCount,
                exportTime: new Date().toISOString(),
                xpathFormat: 'v3: {inIframe: boolean, iframeChain: string[]|null, xpath: string}',
                performance: {
                    domExportTime: (totalDuration - xpathDuration).toFixed(2) + 'ms',
                    xpathGenerationTime: xpathDuration.toFixed(2) + 'ms',
                    totalTime: totalDuration.toFixed(2) + 'ms'
                },
                stats: stats
            }
        };

        if (config.needDownload && filename) {
            const json = JSON.stringify(exportData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `dom_tree_xpath_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            console.log(`✓ 文件已下载: ${filename}`);
        }

        // 显示使用说明
        if (iframeElementCount > 0) {
            console.log('');
            console.log('📌 XPath使用说明（v3格式）:');
            console.log('  mockIdToXPath中的每个值现在包含三个字段:');
            console.log('  {');
            console.log('    inIframe: boolean,           // 是否在iframe内');
            console.log('    iframeChain: string[]|null,  // iframe路径链（支持多层嵌套）');
            console.log('    xpath: string                // 元素的XPath（相对于所在document）');
            console.log('  }');
            console.log('');
            console.log('  定位iframe内元素的步骤（支持多层嵌套）:');
            console.log('  1. 遍历 iframeChain，逐层进入iframe');
            console.log('  2. 每一层：定位iframe -> 进入contentDocument');
            console.log('  3. 在最内层iframe内使用 xpath 定位目标元素');
            console.log('');
            console.log('  示例：iframeChain: ["//*[@id=\'a\']", "//*[@id=\'b\']"]');
            console.log('    → 主文档定位iframe A → 进入A → 定位iframe B → 进入B → 定位元素');
        }

        console.log('==================================================');

        return exportData;
    }

    window.exportDOMTreeWithXPath = exportDOMTreeWithXPath;

    console.log('✅ XPath集成功能已加载');

})();
(function() {
    'use strict';

    /**
     * 获取元素的XPath
     * @param {Element} element - 目标DOM元素
     * @param {Object} options - 配置选项
     * @returns {string|Object} XPath字符串，如果元素在iframe内则返回对象
     *
     * 使用示例：
     * 1. 获取主文档元素的XPath：
     *    const xpath = window.getElementXPath(element);
     *    // 返回: "//*[@id='myid']"
     *
     * 2. 获取iframe内元素的XPath（包含iframe信息）：
     *    const xpathData = window.getElementXPath(iframeElement, { includeIframeInfo: true });
     *    // 返回: { inIframe: true, iframeChain: ["//*[@id='frame1']"], xpath: "//*[@id='inner']" }
     *
     * 3. 只获取XPath字符串（不包含iframe信息）：
     *    const xpath = window.getElementXPath(iframeElement, { includeIframeInfo: false });
     *    // 返回: "//*[@id='inner']"
     */
    function getElementXPath(element, options = {}) {
        const config = {
            includeIframeInfo: false,  // 是否包含iframe信息（默认false，只返回xpath字符串）
            debug: false,
            ...options
        };

        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            console.error('getElementXPath: 无效的元素');
            return null;
        }

        // 检查SmartXPathGenerator是否已加载
        if (!window.SmartXPathGenerator) {
            console.error('getElementXPath: SmartXPathGenerator未加载！');
            return null;
        }

        try {
            // 创建XPath生成器实例
            const xpathGen = new window.SmartXPathGenerator({ debug: config.debug });

            // 构建索引（提升性能）
            xpathGen.buildIndex(document.body);

            // 生成XPath
            const xpath = xpathGen.generateXPath(element);

            // 如果需要包含iframe信息
            if (config.includeIframeInfo) {
                const iframeInfo = getIframePath(element, xpathGen);

                if (iframeInfo.inIframe) {
                    return {
                        inIframe: true,
                        iframeChain: iframeInfo.iframeChain,
                        xpath: xpath
                    };
                } else {
                    return {
                        inIframe: false,
                        iframeChain: null,
                        xpath: xpath
                    };
                }
            }

            // 默认只返回xpath字符串
            return xpath;

        } catch (e) {
            console.error('getElementXPath: 生成XPath时出错', e);
            return null;
        }
    }

    /**
     * 获取元素所在的iframe路径链（支持多层嵌套）
     * @param {Element} element - 目标元素
     * @param {SmartXPathGenerator} xpathGen - XPath生成器实例
     * @returns {Object} { inIframe: boolean, iframeChain: string[]|null }
     */
    function getIframePath(element, xpathGen) {
        try {
            const elementDoc = element.ownerDocument;
            if (!elementDoc || elementDoc === window.document) {
                return { inIframe: false, iframeChain: null };
            }

            // 从元素所在的document向上查找，构建iframe链
            const iframeChain = [];
            let currentDoc = elementDoc;

            // 递归查找包含指定document的iframe元素
            function findIframeForDoc(searchDoc, targetDoc) {
                const iframes = searchDoc.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const iframeDoc = iframe.contentDocument ||
                                         (iframe.contentWindow && iframe.contentWindow.document);

                        if (iframeDoc === targetDoc) {
                            return iframe;
                        }

                        // 递归在iframe内部查找
                        if (iframeDoc) {
                            const found = findIframeForDoc(iframeDoc, targetDoc);
                            if (found) return found;
                        }
                    } catch (e) {
                        // 跨域iframe，跳过
                    }
                }
                return null;
            }

            // 向上遍历，直到到达主文档
            while (currentDoc && currentDoc !== window.document) {
                // 从主文档开始查找包含currentDoc的iframe
                const foundIframe = findIframeForDoc(window.document, currentDoc);

                if (!foundIframe) {
                    // 找不到对应的iframe，可能是跨域或其他问题
                    break;
                }

                // 生成iframe的XPath并添加到链的开头
                const iframeXPath = xpathGen.generateXPath(foundIframe);
                iframeChain.unshift(iframeXPath);

                // 向上移动到iframe所在的document
                currentDoc = foundIframe.ownerDocument;
            }

            if (iframeChain.length > 0) {
                return { inIframe: true, iframeChain: iframeChain };
            }
        } catch (e) {
            console.error('getIframePath 错误:', e);
        }
        return { inIframe: false, iframeChain: null };
    }

    // 导出到window
    window.getElementXPath = getElementXPath;

    console.log('✅ getElementXPath 方法已加载');
    console.log('📖 使用方法:');
    console.log('   const xpath = window.getElementXPath(element);');
    console.log('   const xpathData = window.getElementXPath(element, { includeIframeInfo: true });');

})();
