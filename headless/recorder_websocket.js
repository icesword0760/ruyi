/**
 * WebSocket版录制器 - 适用于Headless Chrome
 * 
 * V3优化：
 * 1. 移除UI按钮（按钮现在在控制端）
 * 2. 监听后端的录制状态消息
 * 3. 始终发送事件，由后端根据录制状态过滤
 */

(function() {
    'use strict';
    
    // 防止重复初始化
    if (window._recorderWSInitialized) {
        console.log('🎬 WebSocket录制器已初始化');
        return;
    }
    window._recorderWSInitialized = true;
    
    console.log('🎬 WebSocket录制器初始化...');
    
    // WebSocket连接
    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000;
    
    // 录制状态（由后端控制）
    let isRecording = false;
    
    // ═══════════════════════════════════════════════════════════════
    // WebSocket连接管理
    // ═══════════════════════════════════════════════════════════════
    
    function connectWebSocket() {
        // 连接到MJPEG WebSocket服务器（端口5567）
        const wsUrl = 'ws://localhost:5567';
        
        try {
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('✅ 录制器WebSocket已连接');
                reconnectAttempts = 0;
                
                // 发送初始化消息
                sendEvent({
                    type: 'recorder_init',
                    timestamp: Date.now(),
                    url: window.location.href,
                    title: document.title
                });
            };
            
            ws.onclose = () => {
                console.log('⚠️ 录制器WebSocket断开');
                ws = null;
                
                // 自动重连
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    console.log(`🔄 ${reconnectDelay}ms后重连 (${reconnectAttempts}/${maxReconnectAttempts})`);
                    setTimeout(connectWebSocket, reconnectDelay);
                }
            };
            
            ws.onerror = (error) => {
                console.error('❌ 录制器WebSocket错误:', error);
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleServerMessage(data);
                } catch (e) {
                    console.error('❌ 解析服务器消息失败:', e);
                }
            };
            
        } catch (error) {
            console.error('❌ 创建WebSocket失败:', error);
        }
    }
    
    function sendEvent(eventData) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                channel: 'recorder',
                data: eventData
            }));
        } else {
            console.warn('⚠️ WebSocket未连接，无法发送事件');
        }
    }
    
    function handleServerMessage(message) {
        // 监听后端发来的录制状态消息
        if (message.type === 'RECORDING_STARTED') {
            isRecording = true;
            console.log('🔴 后端通知：开始录制');
        } else if (message.type === 'RECORDING_STOPPED') {
            isRecording = false;
            console.log('⏹️ 后端通知：停止录制');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 事件监听（始终发送，由后端过滤）
    // ═══════════════════════════════════════════════════════════════
    
    function setupEventListeners() {
        console.log('🎧 设置事件监听器...');
        
        // 点击事件
        document.addEventListener('click', (e) => {
            console.log('🖱️ 检测到点击:', e.target.tagName);
            
            // V5: 使用增强的元素信息提取
            const targetInfo = extractElementInfo(e.target);
            
            sendEvent({
                type: 'click',
                timestamp: Date.now(),
                target: targetInfo,
                clientX: e.clientX,
                clientY: e.clientY,
                button: e.button,
                offsetX: e.offsetX,
                offsetY: e.offsetY,
                pageX: e.pageX,
                pageY: e.pageY
            });
        }, true);
        
        // 双击事件
        document.addEventListener('dblclick', (e) => {
            console.log('🖱️ 检测到双击:', e.target.tagName);
            
            const targetInfo = extractElementInfo(e.target);
            
            sendEvent({
                type: 'dblclick',
                timestamp: Date.now(),
                target: targetInfo,
                clientX: e.clientX,
                clientY: e.clientY,
                offsetX: e.offsetX,
                offsetY: e.offsetY
            });
        }, true);
        
        // 输入事件（防抖）
        let inputTimeout = null;
        document.addEventListener('input', (e) => {
            console.log('⌨️ 检测到输入:', e.target.tagName);
            
            clearTimeout(inputTimeout);
            inputTimeout = setTimeout(() => {
                const targetInfo = extractElementInfo(e.target);
                
                sendEvent({
                    type: 'input',
                    timestamp: Date.now(),
                    target: targetInfo,
                    value: e.target.value
                });
            }, 1000);
        }, true);
        
        // 滚动事件（防抖）
        let scrollTimeout = null;
        document.addEventListener('scroll', (e) => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                console.log('📜 检测到滚动');
                
                sendEvent({
                    type: 'scroll',
                    timestamp: Date.now(),
                    scrollX: window.scrollX,
                    scrollY: window.scrollY
                });
            }, 500);
        }, true);
        
        // 键盘事件
        document.addEventListener('keydown', (e) => {
            // 只记录特殊键
            if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) {
                console.log('⌨️ 检测到按键:', e.key);
                
                sendEvent({
                    type: 'keydown',
                    timestamp: Date.now(),
                    key: e.key,
                    code: e.code,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    altKey: e.altKey,
                    shiftKey: e.shiftKey
                });
            }
        }, true);
        
        console.log('✅ 事件监听器已设置');
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════════════════════════
    
    function initialize() {
        console.log('🎬 初始化WebSocket录制器...');
        
        // 1. 连接WebSocket
        connectWebSocket();
        
        // 2. 设置事件监听
        setupEventListeners();
        
        console.log('✅ WebSocket录制器初始化完成（无UI按钮）');
    }
    
    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
})();
