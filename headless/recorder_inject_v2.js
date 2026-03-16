/**
 * WebRTC Recorder V2 - CDP注入脚本
 * 基于Chrome Recorder标准实现
 * 支持：ARIA选择器、多重备选、hover、防抖、标准格式
 */

(function() {
    // 检查是否已经注入并且按钮存在
    const existingButton = document.getElementById('webrtc-recorder-button');
    if (window._webrtcRecorderInjected && existingButton) {
        console.log('🎬 录制器已存在且按钮在DOM中，跳过注入');
        return;
    }
    
    // 如果之前注入过但按钮不在了，重新创建按钮但保持状态
    const isReinjection = window._webrtcRecorderInjected;
    window._webrtcRecorderInjected = true;
    
    console.log(isReinjection ? '🔄 重新注入录制器（按钮丢失）' : '🎬 WebRTC Recorder V2 首次注入');
    
    // 使用全局状态，避免重新注入时状态丢失
    if (!window._recorderState) {
        window._recorderState = {
            isRecording: false,
            stepCounter: 0,
            recordingId: null,
            inputTimers: new Map(),
            hoverTimer: null,
            lastClickTime: 0,
            lastClickTarget: null
        };
    }
    
    // 引用全局状态
    const state = window._recorderState;
    
    // 创建悬浮录制按钮
    function createRecorderButton() {
        // 检查按钮是否已存在
        if (document.getElementById('webrtc-recorder-button')) {
            console.log('⚠️ 按钮已存在，跳过创建');
            return;
        }
        
        const button = document.createElement('div');
        button.id = 'webrtc-recorder-button';
        button.className = 'webrtc-recorder-btn';
        button.innerHTML = `
            <div class="recorder-icon">●</div>
            <div class="recorder-text">录制</div>
        `;
        
        // 样式（只添加一次）
        if (!document.getElementById('webrtc-recorder-styles')) {
            const style = document.createElement('style');
            style.id = 'webrtc-recorder-styles';
            style.textContent = `
                .webrtc-recorder-btn {
                    position: fixed !important;
                    top: 20px !important;
                    right: 20px !important;
                    z-index: 2147483647 !important;
                    
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    
                    padding: 12px 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 30px;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                    
                    cursor: pointer;
                    user-select: none;
                    
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                    font-size: 14px;
                    font-weight: 600;
                    
                    transition: all 0.3s ease;
                }
                
                .webrtc-recorder-btn:hover {
                    transform: translateY(-2px) scale(1.05);
                    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.6);
                }
                
                .webrtc-recorder-btn:active {
                    transform: translateY(0) scale(0.98);
                }
                
                .webrtc-recorder-btn.recording {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
                    animation: recording-pulse 2s ease-in-out infinite;
                }
                
                @keyframes recording-pulse {
                    0%, 100% { box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4); }
                    50% { box-shadow: 0 4px 20px rgba(239, 68, 68, 0.8); }
                }
                
                .recorder-icon {
                    font-size: 16px;
                    line-height: 1;
                }
                
                .recorder-text {
                    line-height: 1;
                    white-space: nowrap;
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(button);
        button.addEventListener('click', toggleRecording);
        
        console.log('✅ 录制按钮已创建');
    }
    
    // 切换录制状态
    function toggleRecording(e) {
        e.stopPropagation();
        e.preventDefault();
        
        if (state.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
    
    // 开始录制
    function startRecording() {
        state.isRecording = true;
        state.stepCounter = 0;
        state.recordingId = Date.now();
        
        const button = document.getElementById('webrtc-recorder-button');
        if (button) {
            button.classList.add('recording');
            const icon = button.querySelector('.recorder-icon');
            const text = button.querySelector('.recorder-text');
            if (icon) icon.textContent = '■';
            if (text) text.textContent = '停止';
        }
        
        // 通知后端开始录制
        sendToBackend('START_RECORDING', {
            recordingId: state.recordingId,
            startTime: new Date().toISOString(),
            url: window.location.href,
            title: document.title,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        });
        
        // 开始监听事件
        attachEventListeners();
        
        console.log('🔴 开始录制, ID:', state.recordingId);
    }
    
    // 停止录制
    function stopRecording() {
        state.isRecording = false;
        
        const button = document.getElementById('webrtc-recorder-button');
        if (button) {
            button.classList.remove('recording');
            const icon = button.querySelector('.recorder-icon');
            const text = button.querySelector('.recorder-text');
            if (icon) icon.textContent = '●';
            if (text) text.textContent = '录制';
        }
        
        // 通知后端停止录制
        sendToBackend('STOP_RECORDING', {
            recordingId: state.recordingId,
            endTime: new Date().toISOString(),
            totalSteps: state.stepCounter
        });
        
        // 移除事件监听
        removeEventListeners();
        
        console.log('⏹️ 停止录制, ID:', state.recordingId, '共', state.stepCounter, '步');
    }
    
    // 事件监听器存储
    const listeners = {
        click: null,
        dblclick: null,
        mouseenter: null,
        input: null,
        change: null,
        scroll: null,
        keydown: null
    };
    
    // 附加事件监听
    function attachEventListeners() {
        // 1. 点击事件（支持单击和双击检测）
        listeners.click = (e) => {
            // 忽略录制按钮自身
            if (e.target.id === 'webrtc-recorder-button' || 
                e.target.closest('#webrtc-recorder-button')) {
                return;
            }
            
            const element = e.target;
            const rect = element.getBoundingClientRect();
            const now = Date.now();
            
            // 检查是否是双击
            const timeDiff = now - state.lastClickTime;
            const sameTarget = element === state.lastClickTarget;
            
            if (sameTarget && timeDiff < 500) {
                // 双击
                recordStepV2('doubleClick', element, {
                    offsetX: Math.round(e.clientX - rect.left),
                    offsetY: Math.round(e.clientY - rect.top),
                    button: getButtonType(e.button)
                });
                
                state.lastClickTime = 0;
                state.lastClickTarget = null;
            } else {
                // 单击
                recordStepV2('click', element, {
                    offsetX: Math.round(e.clientX - rect.left),
                    offsetY: Math.round(e.clientY - rect.top),
                    button: getButtonType(e.button)
                });
                
                state.lastClickTime = now;
                state.lastClickTarget = element;
            }
        };
        
        // 2. Hover事件（300ms防抖）
        listeners.mouseenter = (e) => {
            if (e.target.id === 'webrtc-recorder-button' || 
                e.target.closest('#webrtc-recorder-button')) {
                return;
            }
            
            if (state.hoverTimer) {
                clearTimeout(state.hoverTimer);
            }
            
            const element = e.target;
            state.hoverTimer = setTimeout(() => {
                if (!state.isRecording) return;
                
                recordStepV2('hover', element, {});
            }, 300);
        };
        
        // 3. Input事件（1秒防抖，只记录最终值）
        listeners.input = (e) => {
            const element = e.target;
            const elementId = getElementUniqueId(element);
            
            // 清除之前的定时器
            if (state.inputTimers.has(elementId)) {
                clearTimeout(state.inputTimers.get(elementId));
            }
            
            // 设置新的防抖定时器
            const timer = setTimeout(() => {
                if (!state.isRecording) return;
                
                const value = element.type === 'password' ? '' : element.value;
                
                recordStepV2('change', element, {
                    value: value,
                    inputType: element.type
                });
                
                state.inputTimers.delete(elementId);
            }, 1000);
            
            state.inputTimers.set(elementId, timer);
        };
        
        // 4. Change事件（用于select、checkbox、radio）
        listeners.change = (e) => {
            const element = e.target;
            
            if (element.tagName === 'SELECT') {
                const selectedOption = element.options[element.selectedIndex];
                recordStepV2('change', element, {
                    value: element.value,
                    selectedText: selectedOption?.text || element.value
                });
            } else if (element.type === 'checkbox' || element.type === 'radio') {
                recordStepV2('change', element, {
                    value: element.checked ? 'true' : 'false',
                    checked: element.checked
                });
            }
        };
        
        // 5. Scroll事件（500ms防抖）
        listeners.scroll = () => {
            if (state.scrollTimer) {
                clearTimeout(state.scrollTimer);
            }
            
            state.scrollTimer = setTimeout(() => {
                if (!state.isRecording) return;
                
                recordStepV2('scroll', null, {
                    x: window.scrollX,
                    y: window.scrollY
                });
            }, 500);
        };
        
        // 6. 键盘事件（只记录特殊键和组合键）
        listeners.keydown = (e) => {
            // 忽略普通字符输入（已由input事件处理）
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                return;
            }
            
            recordStepV2('keyDown', null, {
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey
            });
        };
        
        // 附加所有监听器
        document.addEventListener('click', listeners.click, true);
        document.addEventListener('dblclick', (e) => e.preventDefault(), true); // 防止默认双击行为
        document.addEventListener('mouseenter', listeners.mouseenter, true);
        document.addEventListener('input', listeners.input, true);
        document.addEventListener('change', listeners.change, true);
        window.addEventListener('scroll', listeners.scroll, { passive: true });
        document.addEventListener('keydown', listeners.keydown, true);
        
        console.log('✅ 事件监听已启动（7种类型）');
    }
    
    // 移除事件监听
    function removeEventListeners() {
        if (listeners.click) document.removeEventListener('click', listeners.click, true);
        if (listeners.mouseenter) document.removeEventListener('mouseenter', listeners.mouseenter, true);
        if (listeners.input) document.removeEventListener('input', listeners.input, true);
        if (listeners.change) document.removeEventListener('change', listeners.change, true);
        if (listeners.scroll) window.removeEventListener('scroll', listeners.scroll);
        if (listeners.keydown) document.removeEventListener('keydown', listeners.keydown, true);
        
        // 清理定时器
        state.inputTimers.forEach(timer => clearTimeout(timer));
        state.inputTimers.clear();
        if (state.hoverTimer) clearTimeout(state.hoverTimer);
        if (state.scrollTimer) clearTimeout(state.scrollTimer);
        
        console.log('✅ 事件监听已移除');
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 核心改进1: 多重选择器生成（基于Chrome Recorder标准）
    // ═══════════════════════════════════════════════════════════════
    
    function generateSelectors(element) {
        const selectors = [];
        
        // 1. data-testid (最高优先级)
        const testId = element.getAttribute('data-testid') || 
                       element.getAttribute('data-test-id') ||
                       element.getAttribute('data-test');
        if (testId) {
            selectors.push(`[data-testid="${testId}"]`);
        }
        
        // 2. ARIA选择器
        const ariaLabel = element.getAttribute('aria-label');
        const role = element.getAttribute('role') || getImplicitRole(element);
        
        if (role && ariaLabel) {
            selectors.push(`aria/${role}[name="${ariaLabel}"]`);
        } else if (role) {
            const name = getElementText(element);
            if (name) {
                selectors.push(`aria/${role}[name="${name}"]`);
            }
        }
        
        // 3. ID选择器（如果ID看起来稳定）
        if (element.id && /^[a-zA-Z][\w-]*$/.test(element.id) && !element.id.match(/^(ember|react|vue)/i)) {
            selectors.push(`#${CSS.escape(element.id)}`);
        }
        
        // 4. 唯一属性组合
        const uniqueAttr = findUniqueAttribute(element);
        if (uniqueAttr) {
            selectors.push(uniqueAttr);
        }
        
        // 5. CSS类（筛选稳定的类）
        if (element.className && typeof element.className === 'string') {
            const stableClasses = element.className.split(/\s+/)
                .filter(c => c && !c.match(/^(is-|has-|active|hover|focus|disabled|selected|current)/i));
            if (stableClasses.length > 0 && stableClasses.length <= 3) {
                const classSelector = stableClasses.map(c => '.' + CSS.escape(c)).join('');
                selectors.push(`${element.tagName.toLowerCase()}${classSelector}`);
            }
        }
        
        // 6. 文本选择器（按钮、链接）
        if (['BUTTON', 'A'].includes(element.tagName)) {
            const text = getElementText(element);
            if (text && text.length < 50 && text.length > 0) {
                selectors.push(`text/${text}`);
            }
        }
        
        // 7. XPath（最后备选）
        if (selectors.length === 0) {
            selectors.push(getXPath(element));
        }
        
        console.log('🎯 生成选择器:', selectors);
        return selectors;
    }
    
    // 获取元素的隐式ARIA role
    function getImplicitRole(element) {
        const roleMap = {
            'BUTTON': 'button',
            'A': 'link',
            'INPUT': element.type === 'checkbox' ? 'checkbox' : 
                     element.type === 'radio' ? 'radio' : 
                     element.type === 'submit' ? 'button' : 'textbox',
            'SELECT': 'combobox',
            'TEXTAREA': 'textbox',
            'IMG': 'img',
            'NAV': 'navigation',
            'MAIN': 'main',
            'HEADER': 'banner',
            'FOOTER': 'contentinfo',
            'ASIDE': 'complementary',
            'FORM': 'form',
            'H1': 'heading',
            'H2': 'heading',
            'H3': 'heading',
            'H4': 'heading',
            'H5': 'heading',
            'H6': 'heading'
        };
        return roleMap[element.tagName] || null;
    }
    
    // 获取元素的唯一属性
    function findUniqueAttribute(element) {
        const attrs = ['name', 'type', 'placeholder', 'title', 'alt', 'value'];
        
        for (const attr of attrs) {
            const value = element.getAttribute(attr);
            if (value) {
                const selector = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
                try {
                    const matches = document.querySelectorAll(selector);
                    if (matches.length === 1 && matches[0] === element) {
                        return selector;
                    }
                } catch (e) {
                    // 忽略无效选择器
                }
            }
        }
        
        return null;
    }
    
    // 获取元素的可见文本
    function getElementText(element) {
        // 优先使用aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim();
        
        // 使用innerText（只包含可见文本）
        let text = element.innerText || element.textContent || '';
        text = text.trim();
        
        // 如果文本太长，只取前30个字符
        if (text.length > 30) {
            text = text.substring(0, 30);
        }
        
        return text;
    }
    
    // 生成XPath
    function getXPath(element) {
        if (element.id) {
            return `xpath///*[@id="${element.id}"]`;
        }
        
        const parts = [];
        let current = element;
        
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
            let index = 1;
            let sibling = current.previousElementSibling;
            
            while (sibling) {
                if (sibling.nodeName === current.nodeName) {
                    index++;
                }
                sibling = sibling.previousElementSibling;
            }
            
            const tagName = current.nodeName.toLowerCase();
            parts.unshift(`${tagName}[${index}]`);
            current = current.parentElement;
        }
        
        return 'xpath//' + parts.join('/');
    }
    
    // 获取元素唯一ID（用于input防抖）
    function getElementUniqueId(element) {
        if (element.id) return element.id;
        if (!element._recorderId) {
            element._recorderId = `recorder_${Math.random().toString(36).substr(2, 9)}`;
        }
        return element._recorderId;
    }
    
    // 获取按钮类型
    function getButtonType(button) {
        const types = ['primary', 'auxiliary', 'secondary', 'back', 'forward'];
        return types[button] || 'primary';
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 核心改进2: 标准格式步骤记录（Puppeteer Replay格式）
    // ═══════════════════════════════════════════════════════════════
    
    function recordStepV2(type, element, extraData) {
        if (!state.isRecording) return;
        
        state.stepCounter++;
        
        // 生成符合Puppeteer Replay标准的步骤
        const step = {
            type: type,
            target: 'main',
            timeout: 5000
        };
        
        // 为有目标元素的步骤添加选择器
        if (element) {
            step.selectors = generateSelectors(element);
        }
        
        // 根据步骤类型添加特定字段
        if (type === 'click' || type === 'doubleClick') {
            step.offsetX = extraData.offsetX || 0;
            step.offsetY = extraData.offsetY || 0;
            step.button = extraData.button || 'primary';
        } else if (type === 'hover') {
            // hover没有额外字段
        } else if (type === 'change') {
            step.value = extraData.value || '';
        } else if (type === 'scroll') {
            step.x = extraData.x || 0;
            step.y = extraData.y || 0;
        } else if (type === 'keyDown') {
            step.key = extraData.key;
        }
        
        // 元数据（用于显示，非标准字段）
        step._metadata = {
            number: state.stepCounter,
            description: generateDescription(type, element, extraData),
            timestamp: new Date().toISOString(),
            url: window.location.href
        };
        
        // 发送到后端
        sendToBackend('RECORD_STEP', {
            recordingId: state.recordingId,
            step: step
        });
        
        console.log('📝 步骤', state.stepCounter, ':', type, '-', step._metadata.description);
    }
    
    // 生成步骤描述
    function generateDescription(type, element, extraData) {
        if (type === 'click') {
            return `点击 ${getElementDescription(element)}`;
        } else if (type === 'doubleClick') {
            return `双击 ${getElementDescription(element)}`;
        } else if (type === 'hover') {
            return `悬停在 ${getElementDescription(element)}`;
        } else if (type === 'change') {
            const desc = getElementDescription(element);
            if (extraData.selectedText) {
                return `选择 "${extraData.selectedText}"`;
            } else if (extraData.checked !== undefined) {
                return `${extraData.checked ? '选中' : '取消'} ${desc}`;
            } else {
                return `输入: ${desc}`;
            }
        } else if (type === 'scroll') {
            return `滚动到 (${extraData.x}, ${extraData.y})`;
        } else if (type === 'keyDown') {
            return `按键 ${getKeyDescription(extraData)}`;
        }
        return type;
    }
    
    // 获取元素描述
    function getElementDescription(element) {
        if (!element) return 'page';
        
        // 优先使用aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            return `"${ariaLabel}"`;
        }
        
        // 使用ID
        if (element.id) {
            return `#${element.id}`;
        }
        
        // 使用文本内容
        const text = getElementText(element);
        if (text) {
            return `"${text}"`;
        }
        
        // 使用placeholder
        if (element.placeholder) {
            return `[${element.placeholder}]`;
        }
        
        // 使用name
        if (element.name) {
            return `[name="${element.name}"]`;
        }
        
        // 使用角色
        const role = element.getAttribute('role') || getImplicitRole(element);
        if (role) {
            return `<${role}>`;
        }
        
        return element.tagName.toLowerCase();
    }
    
    // 获取键盘描述
    function getKeyDescription(data) {
        const modifiers = [];
        if (data.ctrlKey) modifiers.push('Ctrl');
        if (data.metaKey) modifiers.push('Cmd');
        if (data.altKey) modifiers.push('Alt');
        if (data.shiftKey) modifiers.push('Shift');
        
        return modifiers.length > 0 
            ? `${modifiers.join('+')}+${data.key}` 
            : data.key;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 网络通信
    // ═══════════════════════════════════════════════════════════════
    
    // 发送到后端
    function sendToBackend(type, data) {
        const payload = {
            type: type,
            data: data,
            timestamp: Date.now()
        };
        
        console.log('📤 发送事件:', type, data);
        
        fetch('http://localhost:5566/api/recorder/event', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        }).then(response => {
            if (!response.ok) {
                console.error('❌ 后端响应错误:', response.status, response.statusText);
                return response.text().then(text => {
                    console.error('响应内容:', text);
                });
            } else {
                console.log('✅ 事件已发送:', type);
            }
        }).catch(error => {
            console.error('❌ 后端通信失败:', error);
        });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════════════════════════
    
    // 页面加载完成后创建/恢复按钮
    function initializeRecorder() {
        createRecorderButton();
        
        // 如果是重新注入且之前在录制中，恢复按钮状态
        if (isReinjection && state.isRecording) {
            console.log('🔄 恢复录制状态 (stepCounter=' + state.stepCounter + ', recordingId=' + state.recordingId + ')');
            
            const button = document.getElementById('webrtc-recorder-button');
            if (button) {
                button.classList.add('recording');
                const icon = button.querySelector('.recorder-icon');
                const text = button.querySelector('.recorder-text');
                if (icon) icon.textContent = '■';
                if (text) text.textContent = '停止';
            }
            
            // 重新附加事件监听
            attachEventListeners();
            
            console.log('✅ 录制状态已恢复');
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeRecorder);
    } else {
        initializeRecorder();
    }
    
    console.log('✅ 录制器初始化完成 (version 2.0)');
})();
