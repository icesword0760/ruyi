/**
 * V4录制器 - 最小化UI（可选）
 * 
 * 说明：
 * - 这个脚本只负责显示录制按钮UI
 * - 不监听任何事件（由CDP Recorder监听）
 * - 点击按钮通过CDP binding通知后端
 * - 即使这个UI消失，录制也不受影响
 */

(function() {
    'use strict';
    
    // 检查是否已存在
    if (window._recorderUIInitialized) {
        console.log('🎬 录制UI已存在');
        return;
    }
    window._recorderUIInitialized = true;
    
    console.log('🎬 V4录制UI初始化（最小化版本）');
    
    // ═══════════════════════════════════════════════════════════════
    // 创建UI按钮
    // ═══════════════════════════════════════════════════════════════
    
    function createRecorderButton() {
        // 检查是否已存在
        if (document.getElementById('webrtc-recorder-button')) {
            return document.getElementById('webrtc-recorder-button');
        }
        
        const button = document.createElement('div');
        button.id = 'webrtc-recorder-button';
        button.className = 'webrtc-recorder-btn';
        button.innerHTML = `
            <span class="recorder-icon">●</span>
            <span class="recorder-text">录制</span>
        `;
        
        // 点击通过binding通知后端
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            // 调用CDP binding（由cdp_recorder.py处理）
            if (window._sendRecorderToggle) {
                window._sendRecorderToggle();
            } else {
                console.warn('⚠️ CDP binding未就绪');
            }
        });
        
        // 添加样式
        ensureStyles();
        
        // 添加到页面
        if (document.body) {
            document.body.appendChild(button);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body) {
                    document.body.appendChild(button);
                }
            });
        }
        
        return button;
    }
    
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
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 监听录制状态（从后端）
    // ═══════════════════════════════════════════════════════════════
    
    window._updateRecorderUI = function(isRecording) {
        const button = document.getElementById('webrtc-recorder-button');
        if (!button) return;
        
        const icon = button.querySelector('.recorder-icon');
        const text = button.querySelector('.recorder-text');
        
        if (isRecording) {
            button.classList.add('recording');
            if (icon) icon.textContent = '■';
            if (text) text.textContent = '停止';
        } else {
            button.classList.remove('recording');
            if (icon) icon.textContent = '●';
            if (text) text.textContent = '录制';
        }
    };
    
    // ═══════════════════════════════════════════════════════════════
    // 按钮防护：监控DOM变化，自动重建按钮
    // ═══════════════════════════════════════════════════════════════
    
    function setupButtonProtection() {
        // 定期检查按钮是否存在
        setInterval(() => {
            if (!document.getElementById('webrtc-recorder-button')) {
                console.log('🔄 检测到按钮被移除，重新创建...');
                createRecorderButton();
            }
        }, 1000);
        
        // MutationObserver监控DOM变化
        if (window.MutationObserver) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.removedNodes.forEach((node) => {
                        if (node.id === 'webrtc-recorder-button') {
                            console.log('🔄 按钮被移除，立即重建...');
                            setTimeout(createRecorderButton, 100);
                        }
                    });
                });
            });
            
            if (document.body) {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════════════════════════
    
    function initialize() {
        createRecorderButton();
        setupButtonProtection();
        console.log('✅ V4录制UI初始化完成（仅显示，事件由CDP处理）');
        console.log('✅ 按钮防护已启用（自动重建）');
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
})();
