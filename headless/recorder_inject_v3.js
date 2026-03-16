/**
 * WebRTC Recorder V3 - CDP注入脚本（增强版）
 * 新增：MutationObserver监控 + 自动重建 + 心跳检测
 */

(function() {
    // ═══════════════════════════════════════════════════════════════
    // 全局状态初始化
    // ═══════════════════════════════════════════════════════════════
    
    // 初始化全局状态（跨页面持久化）
    if (!window._recorderState) {
        window._recorderState = {
            isRecording: false,
            stepCounter: 0,
            recordingId: null,
            inputTimers: new Map(),
            hoverTimer: null,
            scrollTimer: null,
            lastClickTime: 0,
            lastClickTarget: null,
            buttonObserver: null,
            heartbeatInterval: null
        };
    }
    
    const state = window._recorderState;
    
    // 检查是否是重新注入
    const isReinjection = window._webrtcRecorderInjected === true;
    window._webrtcRecorderInjected = true;
    
    console.log(isReinjection 
        ? `🔄 重新注入录制器 (录制中=${state.isRecording}, 步骤=${state.stepCounter})` 
        : '🎬 WebRTC Recorder V3 首次注入');
    
    // ═══════════════════════════════════════════════════════════════
    // 按钮管理（核心改进：主动监控 + 自动重建）
    // ═══════════════════════════════════════════════════════════════
    
    // 创建或获取录制按钮
    function ensureButton() {
        let button = document.getElementById('webrtc-recorder-button');
        
        if (!button) {
            console.log('🔧 按钮不存在，创建新按钮');
            button = createButton();
        }
        
        // 确保按钮状态正确
        updateButtonState(button);
        
        return button;
    }
    
    // 创建按钮DOM
    function createButton() {
        const button = document.createElement('div');
        button.id = 'webrtc-recorder-button';
        button.className = 'webrtc-recorder-btn';
        button.innerHTML = `
            <div class="recorder-icon">●</div>
            <div class="recorder-text">录制</div>
        `;
        
        // 确保样式存在
        ensureStyles();
        
        // 添加到body（如果body不存在则等待）
        if (document.body) {
            document.body.appendChild(button);
        } else {
            console.warn('⚠️ body不存在，等待DOMContentLoaded');
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body && !document.getElementById('webrtc-recorder-button')) {
                    document.body.appendChild(button);
                    console.log('✅ 延迟添加按钮成功');
                }
            });
        }
        
        // 绑定点击事件
        button.addEventListener('click', toggleRecording);
        
        console.log('✅ 按钮已创建:', button.id);
        return button;
    }
    
    // 确保样式存在
    function ensureStyles() {
        if (document.getElementById('webrtc-recorder-styles')) {
            return;
        }
        
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
        
        if (document.head) {
            document.head.appendChild(style);
        } else {
            // head不存在时等待
            const observer = new MutationObserver(() => {
                if (document.head) {
                    document.head.appendChild(style);
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true });
        }
    }
    
    // 更新按钮状态
    function updateButtonState(button) {
        if (!button) return;
        
        const icon = button.querySelector('.recorder-icon');
        const text = button.querySelector('.recorder-text');
        
        if (state.isRecording) {
            button.classList.add('recording');
            if (icon) icon.textContent = '■';
            if (text) text.textContent = '停止';
        } else {
            button.classList.remove('recording');
            if (icon) icon.textContent = '●';
            if (text) text.textContent = '录制';
        }
    }
    
    // 启动按钮监控（MutationObserver）
    function startButtonMonitor() {
        // 清理旧的监控
        if (state.buttonObserver) {
            state.buttonObserver.disconnect();
        }
        
        // 创建新的监控
        state.buttonObserver = new MutationObserver((mutations) => {
            const button = document.getElementById('webrtc-recorder-button');
            
            if (!button) {
                console.warn('⚠️ 按钮被移除，立即重建');
                ensureButton();
                
                // 如果正在录制，重新附加事件监听
                if (state.isRecording) {
                    console.log('🔄 重新附加事件监听');
                    attachEventListeners();
                }
            }
        });
        
        // 监控body的子节点变化
        if (document.body) {
            state.buttonObserver.observe(document.body, {
                childList: true,
                subtree: false
            });
            console.log('✅ 按钮监控已启动');
        }
    }
    
    // 启动心跳检测
    function startHeartbeat() {
        // 清理旧的心跳
        if (state.heartbeatInterval) {
            clearInterval(state.heartbeatInterval);
        }
        
        // 每2秒检查一次按钮状态
        state.heartbeatInterval = setInterval(() => {
            const button = document.getElementById('webrtc-recorder-button');
            
            if (!button) {
                console.warn('💓 心跳检测：按钮丢失，重建');
                ensureButton();
                
                if (state.isRecording) {
                    attachEventListeners();
                }
            } else {
                // 确保按钮状态正确
                updateButtonState(button);
            }
        }, 2000);
        
        console.log('✅ 心跳检测已启动（2秒间隔）');
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 录制控制
    // ═══════════════════════════════════════════════════════════════
    
    function toggleRecording(e) {
        e.stopPropagation();
        e.preventDefault();
        
        console.log('🎯 点击录制按钮, 当前状态:', state.isRecording);
        
        if (state.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
    
    function startRecording() {
        state.isRecording = true;
        state.stepCounter = 0;
        state.recordingId = Date.now();
        
        console.log('🔴 开始录制, ID:', state.recordingId);
        
        // 更新按钮
        const button = ensureButton();
        updateButtonState(button);
        
        // 通知后端
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
        
        // 附加事件监听
        attachEventListeners();
    }
    
    function stopRecording() {
        console.log('⏹️ 停止录制, ID:', state.recordingId, '共', state.stepCounter, '步');
        
        state.isRecording = false;
        
        // 更新按钮
        const button = ensureButton();
        updateButtonState(button);
        
        // 通知后端
        sendToBackend('STOP_RECORDING', {
            recordingId: state.recordingId,
            endTime: new Date().toISOString(),
            totalSteps: state.stepCounter
        });
        
        // 移除事件监听
        removeEventListeners();
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 事件监听（与V2相同，略）
    // ═══════════════════════════════════════════════════════════════
    
    const listeners = {
        click: null,
        mouseenter: null,
        input: null,
        change: null,
        scroll: null,
        keydown: null
    };
    
    function attachEventListeners() {
        // 清理旧的监听器
        removeEventListeners();
        
        // 1. 点击事件
        listeners.click = (e) => {
            if (e.target.id === 'webrtc-recorder-button' || 
                e.target.closest('#webrtc-recorder-button')) {
                return;
            }
            
            const element = e.target;
            const rect = element.getBoundingClientRect();
            const now = Date.now();
            
            const timeDiff = now - state.lastClickTime;
            const sameTarget = element === state.lastClickTarget;
            
            if (sameTarget && timeDiff < 500) {
                recordStepV2('doubleClick', element, {
                    offsetX: Math.round(e.clientX - rect.left),
                    offsetY: Math.round(e.clientY - rect.top),
                    button: getButtonType(e.button)
                });
                state.lastClickTime = 0;
                state.lastClickTarget = null;
            } else {
                recordStepV2('click', element, {
                    offsetX: Math.round(e.clientX - rect.left),
                    offsetY: Math.round(e.clientY - rect.top),
                    button: getButtonType(e.button)
                });
                state.lastClickTime = now;
                state.lastClickTarget = element;
            }
        };
        
        // 2. Hover事件
        listeners.mouseenter = (e) => {
            if (e.target.id === 'webrtc-recorder-button' || 
                e.target.closest('#webrtc-recorder-button')) {
                return;
            }
            
            if (state.hoverTimer) clearTimeout(state.hoverTimer);
            
            const element = e.target;
            state.hoverTimer = setTimeout(() => {
                if (!state.isRecording) return;
                recordStepV2('hover', element, {});
            }, 300);
        };
        
        // 3. Input事件
        listeners.input = (e) => {
            const element = e.target;
            const elementId = getElementUniqueId(element);
            
            if (state.inputTimers.has(elementId)) {
                clearTimeout(state.inputTimers.get(elementId));
            }
            
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
        
        // 4. Change事件
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
        
        // 5. Scroll事件
        listeners.scroll = () => {
            if (state.scrollTimer) clearTimeout(state.scrollTimer);
            
            state.scrollTimer = setTimeout(() => {
                if (!state.isRecording) return;
                recordStepV2('scroll', null, {
                    x: window.scrollX,
                    y: window.scrollY
                });
            }, 500);
        };
        
        // 6. 键盘事件
        listeners.keydown = (e) => {
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
        document.addEventListener('dblclick', (e) => e.preventDefault(), true);
        document.addEventListener('mouseenter', listeners.mouseenter, true);
        document.addEventListener('input', listeners.input, true);
        document.addEventListener('change', listeners.change, true);
        window.addEventListener('scroll', listeners.scroll, { passive: true });
        document.addEventListener('keydown', listeners.keydown, true);
        
        console.log('✅ 事件监听已附加（7种类型）');
    }
    
    function removeEventListeners() {
        if (listeners.click) document.removeEventListener('click', listeners.click, true);
        if (listeners.mouseenter) document.removeEventListener('mouseenter', listeners.mouseenter, true);
        if (listeners.input) document.removeEventListener('input', listeners.input, true);
        if (listeners.change) document.removeEventListener('change', listeners.change, true);
        if (listeners.scroll) window.removeEventListener('scroll', listeners.scroll);
        if (listeners.keydown) document.removeEventListener('keydown', listeners.keydown, true);
        
        state.inputTimers.forEach(timer => clearTimeout(timer));
        state.inputTimers.clear();
        if (state.hoverTimer) clearTimeout(state.hoverTimer);
        if (state.scrollTimer) clearTimeout(state.scrollTimer);
        
        console.log('✅ 事件监听已移除');
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 选择器生成（与V2相同）
    // ═══════════════════════════════════════════════════════════════
    
    function generateSelectors(element) {
        const selectors = [];
        
        const testId = element.getAttribute('data-testid') || 
                       element.getAttribute('data-test-id') ||
                       element.getAttribute('data-test');
        if (testId) {
            selectors.push(`[data-testid="${testId}"]`);
        }
        
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
        
        if (element.id && /^[a-zA-Z][\w-]*$/.test(element.id) && !element.id.match(/^(ember|react|vue)/i)) {
            selectors.push(`#${CSS.escape(element.id)}`);
        }
        
        const uniqueAttr = findUniqueAttribute(element);
        if (uniqueAttr) {
            selectors.push(uniqueAttr);
        }
        
        if (element.className && typeof element.className === 'string') {
            const stableClasses = element.className.split(/\s+/)
                .filter(c => c && !c.match(/^(is-|has-|active|hover|focus|disabled|selected|current)/i));
            if (stableClasses.length > 0 && stableClasses.length <= 3) {
                const classSelector = stableClasses.map(c => '.' + CSS.escape(c)).join('');
                selectors.push(`${element.tagName.toLowerCase()}${classSelector}`);
            }
        }
        
        if (['BUTTON', 'A'].includes(element.tagName)) {
            const text = getElementText(element);
            if (text && text.length < 50 && text.length > 0) {
                selectors.push(`text/${text}`);
            }
        }
        
        if (selectors.length === 0) {
            selectors.push(getXPath(element));
        }
        
        return selectors;
    }
    
    function getImplicitRole(element) {
        const roleMap = {
            'BUTTON': 'button', 'A': 'link',
            'INPUT': element.type === 'checkbox' ? 'checkbox' : 
                     element.type === 'radio' ? 'radio' : 
                     element.type === 'submit' ? 'button' : 'textbox',
            'SELECT': 'combobox', 'TEXTAREA': 'textbox', 'IMG': 'img',
            'NAV': 'navigation', 'MAIN': 'main', 'HEADER': 'banner',
            'FOOTER': 'contentinfo', 'ASIDE': 'complementary', 'FORM': 'form',
            'H1': 'heading', 'H2': 'heading', 'H3': 'heading',
            'H4': 'heading', 'H5': 'heading', 'H6': 'heading'
        };
        return roleMap[element.tagName] || null;
    }
    
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
                } catch (e) {}
            }
        }
        return null;
    }
    
    function getElementText(element) {
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim();
        
        let text = element.innerText || element.textContent || '';
        text = text.trim();
        
        if (text.length > 30) {
            text = text.substring(0, 30);
        }
        
        return text;
    }
    
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
    
    function getElementUniqueId(element) {
        if (element.id) return element.id;
        if (!element._recorderId) {
            element._recorderId = `recorder_${Math.random().toString(36).substr(2, 9)}`;
        }
        return element._recorderId;
    }
    
    function getButtonType(button) {
        const types = ['primary', 'auxiliary', 'secondary', 'back', 'forward'];
        return types[button] || 'primary';
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 步骤记录
    // ═══════════════════════════════════════════════════════════════
    
    function recordStepV2(type, element, extraData) {
        if (!state.isRecording) return;
        
        state.stepCounter++;
        
        const step = {
            type: type,
            target: 'main',
            timeout: 5000
        };
        
        if (element) {
            step.selectors = generateSelectors(element);
        }
        
        if (type === 'click' || type === 'doubleClick') {
            step.offsetX = extraData.offsetX || 0;
            step.offsetY = extraData.offsetY || 0;
            step.button = extraData.button || 'primary';
        } else if (type === 'change') {
            step.value = extraData.value || '';
        } else if (type === 'scroll') {
            step.x = extraData.x || 0;
            step.y = extraData.y || 0;
        } else if (type === 'keyDown') {
            step.key = extraData.key;
        }
        
        step._metadata = {
            number: state.stepCounter,
            description: generateDescription(type, element, extraData),
            timestamp: new Date().toISOString(),
            url: window.location.href
        };
        
        sendToBackend('RECORD_STEP', {
            recordingId: state.recordingId,
            step: step
        });
        
        console.log('📝 步骤', state.stepCounter, ':', type, '-', step._metadata.description);
    }
    
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
    
    function getElementDescription(element) {
        if (!element) return 'page';
        
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return `"${ariaLabel}"`;
        
        if (element.id) return `#${element.id}`;
        
        const text = getElementText(element);
        if (text) return `"${text}"`;
        
        if (element.placeholder) return `[${element.placeholder}]`;
        if (element.name) return `[name="${element.name}"]`;
        
        const role = element.getAttribute('role') || getImplicitRole(element);
        if (role) return `<${role}>`;
        
        return element.tagName.toLowerCase();
    }
    
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
    
    function sendToBackend(type, data) {
        const payload = {
            type: type,
            data: data,
            timestamp: Date.now()
        };
        
        fetch('http://localhost:5566/api/recorder/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(response => {
            if (!response.ok) {
                console.error('❌ 后端响应错误:', response.status, response.statusText);
            } else {
                console.log('✅ 事件已发送:', type);
            }
        }).catch(error => {
            console.error('❌ 后端通信失败:', error);
        });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 初始化（核心改进）
    // ═══════════════════════════════════════════════════════════════
    
    function initialize() {
        console.log('🚀 开始初始化录制器...');
        
        // 1. 确保按钮存在
        ensureButton();
        
        // 2. 启动按钮监控
        startButtonMonitor();
        
        // 3. 启动心跳检测
        startHeartbeat();
        
        // 4. 如果正在录制，恢复事件监听
        if (isReinjection && state.isRecording) {
            console.log('🔄 检测到录制中，恢复事件监听');
            attachEventListeners();
        }
        
        console.log('✅ 录制器初始化完成 (V3.0 - 增强版)');
        console.log('   - 录制状态:', state.isRecording);
        console.log('   - 步骤计数:', state.stepCounter);
        console.log('   - 按钮监控: 已启动');
        console.log('   - 心跳检测: 已启动');
    }
    
    // 根据页面加载状态初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        // 使用setTimeout确保DOM完全ready
        setTimeout(initialize, 100);
    }
    
})();
