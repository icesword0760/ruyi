/**
 * 元素定位工具 - 用于根据坐标获取元素信息
 * 在页面初始化时注入，后续可直接调用
 */

(function() {
    // 防止重复注入
    if (window.__elementLocatorUtils) {
        return;
    }
    // 获取iframe实际的上下文
    function getIframeDocument(iframe_list){
        let iframe_document = document;
        for (let iframe of iframe_list){
            const ele = document.evaluate(
                iframe.xpath,
                iframe_document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
            if (ele == null){
                return false
            }
            iframe_document = ele.contentDocument;
        }
        return iframe_document;
    }
    function isSameElement(locator1, type1, locator2, type2, iframe_list) {
        // 根据类型获取第一个元素
        let elem1 = null;
        iframe_document = getIframeDocument(iframe_list)
        if (iframe_document == false){
            return false
        }
        if (type1 === 'xpath') {
            const result = document.evaluate(
                locator1,
                iframe_document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            elem1 = result.singleNodeValue;
        } else if (type1 === 'selector') {
            elem1 = document.querySelector(locator1);
        } else {
            console.error('type1 必须是 "xpath" 或 "selector"');
            return false;
        }

        // 根据类型获取第二个元素
        let elem2 = null;
        if (type2 === 'xpath') {
            const result = document.evaluate(
                locator2,
                iframe_document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            elem2 = result.singleNodeValue;
        } else if (type2 === 'selector') {
            elem2 = document.querySelector(locator2);
        } else {
            console.error('type2 必须是 "xpath" 或 "selector"');
            return false;
        }

        // 检查是否都找到了元素，并且是同一个
        if (!elem1 || !elem2) {
            // 至少有一个没找到
            return false;
        }

        // 比较是否是同一个DOM节点
        return elem1 === elem2;
    }

    /**
     * 生成相对XPath（使用智能XPath生成器）
     * 优先使用 window.getElementXPath（来自 dom_exporter_all_in_one.js）
     * 如果不可用，回退到简单的XPath生成逻辑
     */
    function getRelativeXPath(element) {
        // 优先使用智能XPath生成器
        if (window.getElementXPath && window.SmartXPathGenerator) {
            try {
                // 使用智能生成器，确保唯一性
                const xpath = window.getElementXPath(element, {
                    debug: false,
                    ensureUnique: true
                });
                if (xpath) {
                    return xpath;
                }
            } catch (e) {
                console.warn('[ElementLocator] 智能XPath生成失败，使用备用方案:', e);
            }
        }

        // 备用方案：简单的XPath生成逻辑
//        if (element.id) {
//            return `//*[@id="${element.id}"]`;
//        }
//
//        const paths = [];
//        let current = element;
//
//        while (current && current.nodeType === Node.ELEMENT_NODE) {
//            let index = 0;
//            let sibling = current.previousSibling;
//
//            // 计算同名兄弟节点中的索引
//            while (sibling) {
//                if (sibling.nodeType === Node.ELEMENT_NODE &&
//                    sibling.nodeName === current.nodeName) {
//                    index++;
//                }
//                sibling = sibling.previousSibling;
//            }
//
//            const tagName = current.nodeName.toLowerCase();
//            const pathIndex = index > 0 ? `[${index + 1}]` : '';
//            paths.unshift(`${tagName}${pathIndex}`);
//
//            // 如果有ID或到达body，停止向上遍历
//            if (current.id || tagName === 'body') {
//                break;
//            }
//
//            current = current.parentNode;
//        }
//
//        return '//' + paths.join('/');
    }

    /**
     * 生成CSS Selector（相对路径）
     */
    function getRelativeSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }

        const paths = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let selector = current.nodeName.toLowerCase();

            // 添加类名
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/).filter(c => c);
                if (classes.length > 0) {
                    selector += '.' + classes.join('.');
                }
            }

            // 如果有唯一的类名或ID，可以停止
            if (current.id) {
                paths.unshift(`#${current.id}`);
                break;
            }

            // 计算nth-child索引
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.nodeName === current.nodeName) {
                    index++;
                }
                sibling = sibling.previousElementSibling;
            }

            // 如果有多个同类型兄弟节点，添加nth-child
            const siblings = current.parentNode ?
                Array.from(current.parentNode.children).filter(
                    el => el.nodeName === current.nodeName
                ) : [];
            if (siblings.length > 1) {
                selector += `:nth-child(${index})`;
            }

            paths.unshift(selector);

            if (current.nodeName.toLowerCase() === 'body') {
                break;
            }

            current = current.parentNode;
        }

        return paths.join(' > ');
    }

    /**
     * 获取元素文本
     */
    function getElementText(element) {
        // 优先获取直接文本内容
        let text = element.textContent?.trim() || '';

        // 如果是输入框，获取value或placeholder
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            text = element.value || element.placeholder || '';
        }

        // 限制文本长度
        if (text.length > 100) {
            text = text.substring(0, 100) + '...';
        }

        return text;
    }

    /**
     * 计算元素索引（在所有匹配的元素中）
     */
    function getElementIndex(element, xpath) {
        let index = 0;

        // 尝试通过xpath查找所有匹配元素
        try {
            const xpathResult = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            for (let i = 0; i < xpathResult.snapshotLength; i++) {
                if (xpathResult.snapshotItem(i) === element) {
                    index = i;
                    break;
                }
            }
        } catch (e) {

        }

        return index >= 0 ? index : 0;
    }

    /**
     * 根据坐标获取元素信息
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @returns {Object} 元素信息对象
     */
    function getActualElement(element, x, y) {
        let iframes = []; // 本函数内部维护遇到的 iframes

        function traverse(el) {
            console.log('当前检查的元素:', el ? el.tagName?.toLowerCase() : 'null/undefined');

            if (el && el.tagName && el.tagName.toLowerCase() === 'iframe') {
                iframes.push(el);
                try {
                    const iframeRect = el.getBoundingClientRect()
                    const doc = el.contentDocument;
                    if (doc) {
                        const innerEl = doc.elementFromPoint(x - iframeRect.left, y - iframeRect.top);
                        if (innerEl) {
                            return traverse(innerEl); // 递归
                        }
                    } else {
                        console.log('⚠️ 无法访问 iframe 的 contentDocument');
                    }
                } catch (e) {
                    console.error('❌ 无法访问该 iframe（可能跨域）:', e);
                }
            }
            return el; // 返回当前元素（可能是最终元素）
        }
        const finalEl = traverse(element);
        return {
            finalElement: finalEl,
            iframes: iframes
        };
    }
    function getElementInfoByCoordinates(x, y) {
        // 获取指定坐标的元素
        let element = document.elementFromPoint(x, y);
        if (!element) {
            return {
                success: false,
                message: '未找到元素'
            };
        }

        result = getActualElement(element, x, y)
        element = result.finalElement;

        const xpath = getRelativeXPath(element);
//        const selector = getRelativeSelector(element);
        const text = getElementText(element);
        const index = getElementIndex(element, xpath);

        iframeXpathList = []
        for (let i = 0; i < result.iframes.length; i++){
            iframeXpathList.push({"value": getRelativeXPath(result.iframes[i]), "index": 0, "url": result.iframes[i].src, "locationType": "xpath"})
        }

        // 获取元素的其他属性
//        const attributes = {};
//        for (let attr of element.attributes) {
//            attributes[attr.name] = attr.value;
//        }

        return {
            success: true,
            value: xpath,
//            selector: selector,
            text: text,
            index: index,
            iframes: iframeXpathList,
            tagName: element.tagName.toLowerCase(),
            x: x,
            y: y,
//            attributes: attributes,
            boundingBox: element.getBoundingClientRect(),
            locationType: "xpath"
        };
    }

    // 将工具函数暴露到全局对象
    window.__elementLocatorUtils = {
        getElementInfoByCoordinates: getElementInfoByCoordinates,
        getRelativeXPath: getRelativeXPath,
        getRelativeSelector: getRelativeSelector,
        getElementText: getElementText,
        getElementIndex: getElementIndex,
        isSameElement: isSameElement,
        version: '1.0.0'
    };

    console.log('[ElementLocator] 元素定位工具已注入，版本:', window.__elementLocatorUtils.version);
})();