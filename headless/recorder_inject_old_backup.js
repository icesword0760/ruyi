/**
 * WebRTC Recorder - CDP注入脚本
 * 通过CDP Runtime.evaluate注入到页面，无需Chrome插件
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
    
    console.log(isReinjection ? '🔄 重新注入录制器（按钮丢失）' : '🎬 WebRTC Recorder 首次注入');
    
    // 使用全局状态，避免重新注入时状态丢失
    if (!window._recorderState) {
        window._recorderState = {
            isRecording: false,
            stepCounter: 0,
            recordingId: null
        };
    }
    
    // 引用全局状态
    const state = window._recorderState;
    
    // 创建悬浮录制按钮
    function createRecorderButton() {
        const button = document.createElement('div');
        button.id = 'webrtc-recorder-button';
        button.className = 'webrtc-recorder-btn';
        button.innerHTML = `
            <div class="recorder-icon">●</div>
            <div class="recorder-text">录制</div>
        `;
        
        // 样式
        const style = document.createElement('style');
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
        document.body.appendChild(button);
        
        button.addEventListener('click', toggleRecording);
        
        console.log('✅ 录制按钮已创建');
    }
    
    // 切换录制状态
    function toggleRecording() {
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
            button.querySelector('.recorder-icon').textContent = '■';
            button.querySelector('.recorder-text').textContent = '停止';
        }
        
        // 通知后端开始录制
        sendToBackend('START_RECORDING', {
            recordingId: state.recordingId,
            startTime: new Date().toISOString(),
            url: window.location.href
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
            button.querySelector('.recorder-icon').textContent = '●';
            button.querySelector('.recorder-text').textContent = '录制';
        }
        
        // 通知后端停止录制
        sendToBackend('STOP_RECORDING', {
            recordingId: state.recordingId,
            endTime: new Date().toISOString()
        });
        
        // 移除事件监听
        removeEventListeners();
        
        console.log('⏹️ 停止录制, ID:', state.recordingId);
    }
    
    // 事件监听器
    const eventListeners = {
        click: null,
        input: null,
        change: null,
        scroll: null
    };
    
    // 附加事件监听
    function attachEventListeners() {
        eventListeners.click = (e) => {
            if (e.target.id === 'webrtc-recorder-button' || 
                e.target.closest('#webrtc-recorder-button')) {
                return;
            }
            
            const selector = getElementSelector(e.target);
            const elementText = e.target.textContent?.trim().substring(0, 50) || '';
            
            recordStep('click', `点击 ${getElementDescription(e.target)}`, {
                selector: selector,
                x: e.clientX,
                y: e.clientY,
                elementText: elementText,
                tagName: e.target.tagName,
                url: window.location.href
            });
        };
        
        eventListeners.input = (e) => {
            const selector = getElementSelector(e.target);
            const value = e.target.type === 'password' ? '******' : e.target.value;
            
            recordStep('input', `输入 "${value.substring(0, 30)}"`, {
                selector: selector,
                value: value,
                placeholder: e.target.placeholder || '',
                url: window.location.href
            });
        };
        
        eventListeners.change = (e) => {
            if (e.target.tagName === 'SELECT') {
                const selector = getElementSelector(e.target);
                const value = e.target.options[e.target.selectedIndex]?.text || e.target.value;
                
                recordStep('change', `选择 "${value}"`, {
                    selector: selector,
                    value: value,
                    url: window.location.href
                });
            }
        };
        
        let scrollTimer = null;
        eventListeners.scroll = () => {
            if (scrollTimer) clearTimeout(scrollTimer);
            
            scrollTimer = setTimeout(() => {
                recordStep('scroll', `滚动到 (${window.scrollX}, ${window.scrollY})`, {
                    x: window.scrollX,
                    y: window.scrollY,
                    url: window.location.href
                });
            }, 500);
        };
        
        document.addEventListener('click', eventListeners.click, true);
        document.addEventListener('input', eventListeners.input, true);
        document.addEventListener('change', eventListeners.change, true);
        window.addEventListener('scroll', eventListeners.scroll, true);
        
        console.log('✅ 事件监听已启动');
    }
    
    // 移除事件监听
    function removeEventListeners() {
        document.removeEventListener('click', eventListeners.click, true);
        document.removeEventListener('input', eventListeners.input, true);
        document.removeEventListener('change', eventListeners.change, true);
        window.removeEventListener('scroll', eventListeners.scroll, true);
        
        console.log('✅ 事件监听已移除');
    }
    
    // 记录步骤
    function recordStep(type, description, details) {
        if (!state.isRecording) return;
        
        state.stepCounter++;
        
        const step = {
            number: state.stepCounter,
            type: type,
            description: description,
            timestamp: new Date().toISOString(),
            details: details
        };
        
        sendToBackend('RECORD_STEP', {
            recordingId: state.recordingId,
            step: step
        });
        
        console.log('📝 步骤', state.stepCounter, ':', type, '-', description);
    }
    
    // 发送到后端
    function sendToBackend(type, data) {
        fetch('http://localhost:5566/api/recorder/event', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: type,
                data: data,
                timestamp: Date.now()
            })
        }).then(response => {
            if (!response.ok) {
                console.warn('⚠️ 后端响应错误:', response.status);
            } else {
                console.log('✅ 事件已发送:', type);
            }
        }).catch(error => {
            console.warn('⚠️ 后端通信失败:', error);
        });
    }
    
    // 获取元素选择器
    function getElementSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(' ').filter(c => c).join('.');
            if (classes) {
                return `${element.tagName.toLowerCase()}.${classes}`;
            }
        }
        
        const parent = element.parentElement;
        if (parent) {
            const index = Array.from(parent.children).indexOf(element) + 1;
            return `${element.tagName.toLowerCase()}:nth-child(${index})`;
        }
        
        return element.tagName.toLowerCase();
    }
    
    // 获取元素描述
    function getElementDescription(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        
        const text = element.textContent?.trim().substring(0, 30);
        if (text) {
            return `"${text}"`;
        }
        
        if (element.placeholder) {
            return `[${element.placeholder}]`;
        }
        
        return element.tagName.toLowerCase();
    }
    
    // 页面加载完成后创建/恢复按钮
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            createRecorderButton();
            // 如果是重新注入且之前在录制中，恢复按钮状态
            if (isReinjection && state.isRecording) {
                console.log('🔄 恢复录制状态');
                const button = document.getElementById('webrtc-recorder-button');
                if (button) {
                    button.classList.add('recording');
                    button.querySelector('.recorder-icon').textContent = '■';
                    button.querySelector('.recorder-text').textContent = '停止';
                }
                // 重新附加事件监听
                attachEventListeners();
            }
        });
    } else {
        createRecorderButton();
        // 如果是重新注入且之前在录制中，恢复按钮状态
        if (isReinjection && state.isRecording) {
            console.log('🔄 恢复录制状态');
            const button = document.getElementById('webrtc-recorder-button');
            if (button) {
                button.classList.add('recording');
                button.querySelector('.recorder-icon').textContent = '■';
                button.querySelector('.recorder-text').textContent = '停止';
            }
            // 重新附加事件监听
            attachEventListeners();
        }
    }
    
    // 不在初始化时发送导航事件，只在实际录制时记录
    console.log('✅ 录制器初始化完成');
})();
