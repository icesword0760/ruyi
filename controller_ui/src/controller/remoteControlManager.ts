/**
 * WebRTC远程控制 - 纯JavaScript实现
 * 功能：完整的鼠标键盘控制 + 动作日志 + 性能优化
 */

export class RemoteControlManager {
    [key: string]: any;
    constructor() {
        this.dataChannel = null;
        this.isControlEnabled = false;
        this.lastMouseMoveTime = 0;
        this.mouseMoveThrottle = 16; // ~60fps
        this.eventQueue = [];
        this.batchInterval = 10; // 10ms批量发送
        this.batchTimer = null;
        this.coordinateCalibration = null;  // 坐标校准
        this.useHttpApi = false; // MJPEG模式使用HTTP API发送控制命令
        this.httpApiUrl = '/api/control/event'; // HTTP API端点
        this.mjpegWebSocket = null; // 🔥 改进3: MJPEG WebSocket连接（用于发送控制命令）
        
        // 🔥 防止点击事件积压
        this.lastClickTime = 0;
        this.clickThrottle = 50; // 点击事件最快50ms一次（20次/秒）
        this.pendingClicks = 0; // 待发送的点击数
    }

    /**
     * 初始化控制端
     * @param {RTCDataChannel|null} dataChannel - WebRTC DataChannel（可选）
     * @param {HTMLElement} videoElement - 视频或图片元素
     * @param {Object} options - 配置选项
     */
    initController(dataChannel: RTCDataChannel | null, videoElement: HTMLElement, options: any = {}) {
        this.dataChannel = dataChannel;
        this.useHttpApi = options.useHttpApi || false; // MJPEG模式设为true
        this.mjpegWebSocket = options.mjpegWebSocket || null; // 🔥 改进3: MJPEG WebSocket
        this.setupControllerListeners(videoElement);
        const mode = this.mjpegWebSocket ? 'WebSocket' : (this.useHttpApi ? 'HTTP API' : 'DataChannel');
        console.log(`✓ 控制端初始化完成 (${mode})`);
    }

    /**
     * 初始化被控端
     */
    initControlled(dataChannel: RTCDataChannel | null, coordinateCalibration: any = null) {
        this.dataChannel = dataChannel;
        this.coordinateCalibration = coordinateCalibration;
        this.setupControlledHandlers();
        console.log('✓ 被控端初始化完成');
    }

    /**
     * 设置控制端事件监听器
     */
    setupControllerListeners(videoElement: HTMLElement) {
        // 计算相对坐标（支持video和img元素）
        const getRelativeCoords = (event: any) => {
            const rect = videoElement.getBoundingClientRect();
            
            // 获取实际分辨率（video用videoWidth，img用naturalWidth）
            let actualWidth, actualHeight;
            if (videoElement.tagName === 'VIDEO') {
                actualWidth = (videoElement as HTMLVideoElement).videoWidth;
                actualHeight = (videoElement as HTMLVideoElement).videoHeight;
            } else if (videoElement.tagName === 'CANVAS') {
                // H.264/Scrcpy模式：使用Canvas的width/height属性（实际渲染分辨率）
                actualWidth = (videoElement as HTMLCanvasElement).width || window.backendResolution?.width || 1920;
                actualHeight = (videoElement as HTMLCanvasElement).height || window.backendResolution?.height || 1080;
            } else if (videoElement.tagName === 'IMG') {
                // MJPEG模式：优先使用window.backendResolution（最可靠）
                // 因为图片的naturalWidth/Height可能在分辨率切换后不会立即更新
                const backendWidth = window.backendResolution?.width || 1920;
                const backendHeight = window.backendResolution?.height || 1080;
                
                // 如果图片已加载且尺寸和后端一致，使用图片尺寸（双重验证）
                if ((videoElement as HTMLImageElement).naturalWidth > 0 && (videoElement as HTMLImageElement).naturalHeight > 0) {
                    // 检查图片尺寸是否和后端一致（允许小误差）
                    if (Math.abs((videoElement as HTMLImageElement).naturalWidth - backendWidth) < 10 && 
                        Math.abs((videoElement as HTMLImageElement).naturalHeight - backendHeight) < 10) {
                        actualWidth = (videoElement as HTMLImageElement).naturalWidth;
                        actualHeight = (videoElement as HTMLImageElement).naturalHeight;
                    } else {
                        // 尺寸不一致，说明图片还是旧的，使用后端值
                        actualWidth = backendWidth;
                        actualHeight = backendHeight;
                        if (event.type === 'click' || event.type === 'mousedown') {
                            console.warn(`⚠️ 图片尺寸(${(videoElement as HTMLImageElement).naturalWidth}x${(videoElement as HTMLImageElement).naturalHeight})与后端不一致(${backendWidth}x${backendHeight})，使用后端值`);
                        }
                    }
                } else {
                    // 图片未加载，使用后端值
                    actualWidth = backendWidth;
                    actualHeight = backendHeight;
                }
            } else {
                actualWidth = rect.width;
                actualHeight = rect.height;
            }
            
            // 计算缩放比例和坐标
            // 注意：如果使用object-fit: contain，图片可能不会填满整个容器
            // 需要考虑图片在容器中的实际位置
            const displayAspect = rect.width / rect.height;
            const imageAspect = actualWidth / actualHeight;
            
            let renderedWidth, renderedHeight, offsetX, offsetY;
            
            if (imageAspect > displayAspect) {
                // 图片更宽，以宽度为准，上下有黑边
                renderedWidth = rect.width;
                renderedHeight = rect.width / imageAspect;
                offsetX = 0;
                offsetY = (rect.height - renderedHeight) / 2;
            } else {
                // 图片更高，以高度为准，左右有黑边
                renderedHeight = rect.height;
                renderedWidth = rect.height * imageAspect;
                offsetX = (rect.width - renderedWidth) / 2;
                offsetY = 0;
            }
            
            // 鼠标相对于图片实际渲染区域的坐标
            const mouseInImageX = event.clientX - rect.left - offsetX;
            const mouseInImageY = event.clientY - rect.top - offsetY;
            
            // 🔥 边界检查：如果鼠标在黑边区域（图片外），钳制到图片边缘
            const clampedMouseX = Math.max(0, Math.min(mouseInImageX, renderedWidth));
            const clampedMouseY = Math.max(0, Math.min(mouseInImageY, renderedHeight));
            
            // 映射到实际分辨率
            const scaleX = actualWidth / renderedWidth;
            const scaleY = actualHeight / renderedHeight;
            
            const relX = Math.round(clampedMouseX * scaleX);
            const relY = Math.round(clampedMouseY * scaleY);
            
            // 🔥 最终边界检查：确保坐标在有效范围内
            const finalX = Math.max(0, Math.min(relX, actualWidth - 1));
            const finalY = Math.max(0, Math.min(relY, actualHeight - 1));
            
            // 🔥 检测坐标异常（点击位置偏移）
            const isAbnormal = finalY !== relY || finalX !== relX;
            if (isAbnormal && (event.type === 'click' || event.type === 'mousedown')) {
                console.warn(`⚠️ 坐标被钳制: (${relX}, ${relY}) → (${finalX}, ${finalY})`);
                console.warn(`   可能原因: 点击在黑边区域，或分辨率未同步`);
            }
            
            // 调试信息（仅在点击事件时输出）
            if (event.type === 'click' || event.type === 'mousedown') {
                const debugInfo = {
                    '鼠标位置': `(${event.clientX}, ${event.clientY})`,
                    '元素类型': videoElement.tagName,
                    '元素位置': `left=${rect.left.toFixed(1)}, top=${rect.top.toFixed(1)}`,
                    '元素显示尺寸': `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
                };
                
                // MJPEG模式专用调试
                if (videoElement.tagName === 'IMG') {
                    debugInfo['图片naturalSize'] = `${videoElement.naturalWidth}x${videoElement.naturalHeight}`;
                    debugInfo['window.backendResolution'] = window.backendResolution ? 
                        `${window.backendResolution.width}x${window.backendResolution.height}` : 'undefined';
                }
                
                debugInfo['最终使用分辨率'] = `${actualWidth}x${actualHeight}`;
                debugInfo['图片渲染尺寸'] = `${renderedWidth.toFixed(1)}x${renderedHeight.toFixed(1)}`;
                debugInfo['黑边偏移'] = `(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`;
                debugInfo['图片内坐标'] = `(${mouseInImageX.toFixed(1)}, ${mouseInImageY.toFixed(1)})`;
                debugInfo['钳制后坐标'] = `(${clampedMouseX.toFixed(1)}, ${clampedMouseY.toFixed(1)})`;
                debugInfo['缩放比例'] = `${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`;
                debugInfo['计算坐标'] = `(${relX}, ${relY})`;
                debugInfo['最终坐标'] = `(${finalX}, ${finalY})`;
                
                console.log(`📍 坐标调试:`, debugInfo);
            }
            
            return {
                x: finalX,
                y: finalY,
                viewportWidth: actualWidth,
                viewportHeight: actualHeight
            };
        };

        // 拖拽状态跟踪
        let isDragging = false;
        let dragButton = -1;
        let dragStartCoords = null;
        let lastDragCoords = null;
        
        // 鼠标移动 - 使用requestAnimationFrame节流
        let rafPending = false;
        let lastCoords = null;

        videoElement.addEventListener('mousemove', (e) => {
            if (!this.isControlEnabled || !this.dataChannel || this.dataChannel.readyState !== 'open') return;
            
            lastCoords = getRelativeCoords(e);
            
            // 如果正在拖拽，增加发送频率和包含按钮信息
            if (isDragging) {
                lastDragCoords = lastCoords;
                // 拖拽时直接发送，不使用requestAnimationFrame节流，以确保流畅
                this.sendEvent({
                    type: 'mousemove',
                    button: dragButton,
                    buttons: e.buttons,  // 当前按下的按钮位掩码
                    isDragging: true,
                    ...lastCoords,
                    timestamp: Date.now()
                });
                return;
            }
            
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => {
                    if (lastCoords) {
                        this.sendEvent({
                            type: 'mousemove',
                            buttons: 0,  // 没有按钮按下
                            isDragging: false,
                            ...lastCoords,
                            timestamp: Date.now()
                        });
                    }
                    rafPending = false;
                });
            }
        });

        // 鼠标按下 - 可能是拖拽开始
        videoElement.addEventListener('mousedown', (e) => {
            if (!this.isControlEnabled) return;
            e.preventDefault();
            
            const coords = getRelativeCoords(e);
            
            // 记录拖拽开始状态
            isDragging = true;
            dragButton = e.button;
            dragStartCoords = coords;
            lastDragCoords = coords;
            
            this.sendEvent({
                type: 'mousedown',
                button: e.button,
                ...coords,
                timestamp: Date.now()
            });
            
            console.log('✓ 拖拽开始:', coords);
        });

        // 鼠标释放 - 拖拽结束
        videoElement.addEventListener('mouseup', (e) => {
            if (!this.isControlEnabled) return;
            e.preventDefault();
            
            const coords = getRelativeCoords(e);
            
            // 检查是否完成了拖拽操作
            if (isDragging && dragStartCoords) {
                const dx = Math.abs(coords.x - dragStartCoords.x);
                const dy = Math.abs(coords.y - dragStartCoords.y);
                if (dx > 5 || dy > 5) {
                    console.log('✓ 拖拽完成: 从', dragStartCoords, '到', coords);
                }
            }
            
            // 重置拖拽状态
            isDragging = false;
            dragButton = -1;
            dragStartCoords = null;
            lastDragCoords = null;
            
            this.sendEvent({
                type: 'mouseup',
                button: e.button,
                ...coords,
                timestamp: Date.now()
            });
        });
        
        // 鼠标离开视频区域时，如果正在拖拽，发送mouseup结束拖拽
        videoElement.addEventListener('mouseleave', (e) => {
            if (!this.isControlEnabled) return;
            
            if (isDragging) {
                const coords = getRelativeCoords(e);
                console.log('✓ 鼠标离开视频区域，结束拖拽');
                
                this.sendEvent({
                    type: 'mouseup',
                    button: dragButton,
                    ...coords,
                    timestamp: Date.now()
                });
                
                // 重置拖拽状态
                isDragging = false;
                dragButton = -1;
                dragStartCoords = null;
                lastDragCoords = null;
            }
        });

        // 点击
        videoElement.addEventListener('click', (e) => {
            if (!this.isControlEnabled) return;
            e.preventDefault();
            
            const coords = getRelativeCoords(e);
            this.sendEvent({
                type: 'click',
                button: e.button,
                ...coords,
                timestamp: Date.now()
            });
        });

        // 双击
        videoElement.addEventListener('dblclick', (e) => {
            if (!this.isControlEnabled) return;
            e.preventDefault();
            
            const coords = getRelativeCoords(e);
            this.sendEvent({
                type: 'dblclick',
                button: e.button,
                ...coords,
                timestamp: Date.now()
            });
        });

        // 右键菜单
        videoElement.addEventListener('contextmenu', (e) => {
            if (!this.isControlEnabled) return;
            e.preventDefault();
            
            const coords = getRelativeCoords(e);
            console.log('✓ 右键菜单事件:', coords);
            this.sendEvent({
                type: 'contextmenu',
                button: 2,  // 右键
                ...coords,
                timestamp: Date.now()
            });
        });

        // 滚轮
        videoElement.addEventListener('wheel', (e) => {
            if (!this.isControlEnabled) return;
            e.preventDefault();
            
            const coords = getRelativeCoords(e);
            this.sendEvent({
                type: 'wheel',
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                deltaZ: e.deltaZ,
                deltaMode: e.deltaMode,
                ...coords,
                timestamp: Date.now()
            });
        });

        // 键盘事件 - 监听整个文档，这样不需要焦点也能工作
        videoElement.tabIndex = 1000;
        
        // 保存视频元素引用，用于判断是否应该拦截事件
        this.videoElement = videoElement;
        
        // 输入法组合状态
        let isComposing = false;
        let lastComposedText = '';  // 记录最后一次composition的文本
        let lastComposedTime = 0;   // 记录最后一次composition的时间
        
        // 键盘事件处理函数
        const handleKeyDown = (e) => {
            if (!this.isControlEnabled) return;
            
            // 如果正在输入法组合中，只允许某些控制按键（如Escape取消输入法）
            if (isComposing) {
                // 允许Escape键来取消输入法
                if (e.key === 'Escape') {
                    // 让这个按键通过
                } else {
                    // 其他按键在composition期间不发送
                    return;
                }
            }
            
            // 防止重复发送刚刚通过composition发送的文本
            // 如果这个keydown的key和最近的composition文本相同，且时间在100ms内，跳过
            if (e.key && e.key === lastComposedText && Date.now() - lastComposedTime < 100) {
                console.log('✓ 跳过重复的keydown（刚通过composition发送）:', e.key);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            
            // 如果焦点在本地输入框中（导航栏等），不拦截
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                // 检查是否是本地的输入框（不是远程画面）
                if (!this.videoElement.contains(target)) {
                    return; // 本地输入框，不拦截
                }
            }
            
            // 检测粘贴快捷键 (Ctrl+V 或 Cmd+V)，让浏览器的 paste 事件处理
            const isPasteShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
            // 检测复制快捷键 (Ctrl+C 或 Cmd+C)，让它正常工作
            const isCopyShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
            // 检测剪切快捷键 (Ctrl+X 或 Cmd+X)
            const isCutShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x';
            // 检测全选快捷键 (Ctrl+A 或 Cmd+A)
            const isSelectAllShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a';
            
            // 对于粘贴快捷键，不阻止默认行为，让 paste 事件处理
            if (isPasteShortcut) {
                console.log('✓ 检测到粘贴快捷键，等待 paste 事件');
                return; // 不拦截，让浏览器触发 paste 事件
            }
            
            // 对于其他需要保留的快捷键，也发送到远程
            if (isCopyShortcut || isCutShortcut || isSelectAllShortcut) {
                console.log('✓ 检测到快捷键:', e.key);
                // 不阻止默认行为，但也发送到远程
            } else {
                e.preventDefault();
                e.stopPropagation();
            }
            
            this.sendEvent({
                type: 'keydown',
                key: e.key,
                code: e.code,
                keyCode: e.keyCode,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
                metaKey: e.metaKey,
                repeat: e.repeat,
                timestamp: Date.now()
            });
        };

        const handleKeyUp = (e) => {
            if (!this.isControlEnabled) return;
            
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                if (!this.videoElement.contains(target)) {
                    return;
                }
            }
            
            // 防止重复发送刚刚通过composition发送的文本
            if (e.key && e.key === lastComposedText && Date.now() - lastComposedTime < 100) {
                console.log('✓ 跳过重复的keyup（刚通过composition发送）:', e.key);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            this.sendEvent({
                type: 'keyup',
                key: e.key,
                code: e.code,
                keyCode: e.keyCode,
                timestamp: Date.now()
            });
        };

        const handleKeyPress = (e) => {
            if (!this.isControlEnabled) return;
            
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                if (!this.videoElement.contains(target)) {
                    return;
                }
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            this.sendEvent({
                type: 'keypress',
                key: e.key,
                code: e.code,
                keyCode: e.keyCode,
                charCode: e.charCode,
                timestamp: Date.now()
            });
        };

        // 绑定到 document，这样无论焦点在哪里都能捕获键盘事件
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        document.addEventListener('keypress', handleKeyPress, true);
        
        // 保存事件处理器引用，以便后续清理
        this.keyboardHandlers = {
            keydown: handleKeyDown,
            keyup: handleKeyUp,
            keypress: handleKeyPress
        };

        // 辅助函数：判断事件来源是否是本地输入框（而非视频画面内的元素）
        const isLocalInput = (e) => {
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                if (!this.videoElement || !this.videoElement.contains(target)) {
                    return true; // 本地输入框，不拦截
                }
            }
            return false;
        };

        // 中文输入支持 - composition 事件
        const handleCompositionStart = (e) => {
            if (!this.isControlEnabled) return;
            // 本地输入框（如 AI 输入框、导航栏等）触发的 composition，不弹辅助框
            if (isLocalInput(e)) return;
            isComposing = true;
            console.log('✓ 开始输入法组合');
            
            // 自动显示中文输入辅助框
            if (typeof showImeHelper === 'function') {
                showImeHelper();
            }
        };
        
        const handleCompositionUpdate = (e) => {
            if (!this.isControlEnabled) return;
            if (isLocalInput(e)) return;
            console.log('✓ 输入法组合中:', e.data);
        };
        
        const handleCompositionEnd = (e) => {
            if (!this.isControlEnabled) return;
            // 本地输入框的 composition 结束，不向远程发送
            if (isLocalInput(e)) return;
            
            const text = e.data;
            if (text) {
                console.log('✓ 中文输入完成:', text);
                // 记录发送的文本和时间，用于去重
                lastComposedText = text;
                lastComposedTime = Date.now();
                
                // 发送整个中文字符串
                this.sendEvent({
                    type: 'keydown',
                    key: text,
                    code: '',
                    keyCode: 0,
                    timestamp: Date.now()
                });
            }
            
            // 立即重置 isComposing，因为composition已经结束
            // 但我们已经通过lastComposedText/Time来防止重复发送
            isComposing = false;
        };
        
        document.addEventListener('compositionstart', handleCompositionStart, true);
        document.addEventListener('compositionupdate', handleCompositionUpdate, true);
        document.addEventListener('compositionend', handleCompositionEnd, true);
        
        this.keyboardHandlers.compositionstart = handleCompositionStart;
        this.keyboardHandlers.compositionupdate = handleCompositionUpdate;
        this.keyboardHandlers.compositionend = handleCompositionEnd;

        // 复制粘贴支持
        const handlePaste = async (e) => {
            if (!this.isControlEnabled) return;
            
            const target = e.target;
            // 如果焦点在本地输入框中，不拦截
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                if (!this.videoElement.contains(target)) {
                    return; // 本地输入框，不拦截
                }
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            try {
                const text = e.clipboardData?.getData('text') || await navigator.clipboard.readText();
                if (text) {
                    console.log('✓ 粘贴文本 (' + text.length + ' 字符):', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
                    
                    // 如果文本较短，逐字符发送；如果较长，使用 insertText
                    if (text.length <= 100) {
                        // 短文本：逐字符发送，保持兼容性
                        for (const char of text) {
                            this.sendEvent({
                                type: 'keydown',
                                key: char,
                                code: '',
                                keyCode: char.charCodeAt(0),
                                timestamp: Date.now()
                            });
                        }
                    } else {
                        // 长文本：直接发送整个文本
                        this.sendEvent({
                            type: 'keydown',
                            key: text,
                            code: '',
                            keyCode: 0,
                            timestamp: Date.now()
                        });
                    }
                }
            } catch (err) {
                console.error('粘贴失败:', err);
            }
        };
        
        document.addEventListener('paste', handlePaste, true);
        this.keyboardHandlers.paste = handlePaste;

        // 焦点相关
        videoElement.addEventListener('focus', () => {
            console.log('✓ 视频元素已聚焦，可以接收键盘输入');
        });

        console.log('✓ 控制端监听器已设置（包括全局键盘、中文输入、复制粘贴）');
    }

    /**
     * 发送事件（带批量处理）
     */
    sendEvent(event: any) {
        // 检查传输方式
        if (this.mjpegWebSocket && this.mjpegWebSocket.readyState === WebSocket.OPEN) {
            // 🔥 改进3: MJPEG模式通过WebSocket发送（更低延迟）
            this.sendEventViaWebSocket(event);
        } else if (this.useHttpApi) {
            // MJPEG模式：使用HTTP API（备用）
            this.sendEventViaHttp(event);
        } else {
            // WebRTC模式：使用DataChannel
            if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
                return;
            }

            // 鼠标移动事件立即发送（已经过节流）
            if (event.type === 'mousemove') {
                try {
                    // 🔥 新增：DataChannel支持二进制协议
                    if (window.binaryEventEncoder && window.USE_BINARY_EVENTS) {
                        const binaryData = window.binaryEventEncoder.encodeMouseEvent(
                            event.type, event.x, event.y, event.button || 0
                        );
                        if (binaryData) {
                            this.dataChannel.send(binaryData);
                            return;
                        }
                    }
                    
                    // Fallback: JSON
                    this.dataChannel.send(JSON.stringify(event));
                } catch (err) {
                    console.error('发送事件失败:', err);
                }
                return;
            }

            // 其他事件加入队列批量发送
            this.eventQueue.push(event);
            
            if (!this.batchTimer) {
                this.batchTimer = setTimeout(() => {
                    this.flushEventQueue();
                }, this.batchInterval);
            }
        }
    }

    /**
     * 🔥 改进3: 通过WebSocket发送事件（MJPEG模式，低延迟）
     */
    sendEventViaWebSocket(event: any) {
        if (!this.mjpegWebSocket || this.mjpegWebSocket.readyState !== WebSocket.OPEN) {
            console.error('MJPEG WebSocket未连接');
            return;
        }
        
        // 鼠标移动事件节流
        if (event.type === 'mousemove') {
            const now = Date.now();
            if (now - this.lastMouseMoveTime < this.mouseMoveThrottle) {
                return;
            }
            this.lastMouseMoveTime = now;
        }
        
        // 🔥 点击事件防抖（防止快速点击积压）
        if (event.type === 'click' || event.type === 'mousedown') {
            const now = Date.now();
            if (now - this.lastClickTime < this.clickThrottle) {
                this.pendingClicks++;
                if (this.pendingClicks > 5) {
                    console.warn('⚠️ 点击过快，丢弃事件（防止积压）');
                    return;
                }
                // 允许少量积压，但限制速率
                console.log(`⏱️ 点击节流 (待处理: ${this.pendingClicks})`);
            }
            this.lastClickTime = now;
        }
        
        try {
            // 通过WebSocket发送控制命令
            // 🔥 新增：尝试使用二进制编码
            let sendSuccess = false;
            
            if (window.binaryEventEncoder && window.USE_BINARY_EVENTS) {
                try {
                    let binaryData = null;
                    
                    // 根据事件类型编码
                    if (event.type === 'wheel') {
                        binaryData = window.binaryEventEncoder.encodeWheelEvent(
                            event.x, event.y, event.deltaY, event.deltaX || 0
                        );
                    } else if (event.type.startsWith('key')) {
                        const modifiers = 
                            (event.ctrlKey ? 1 : 0) |
                            (event.shiftKey ? 2 : 0) |
                            (event.altKey ? 4 : 0) |
                            (event.metaKey ? 8 : 0);
                        
                        binaryData = window.binaryEventEncoder.encodeKeyboardEvent(
                            event.type, event.key || '', event.keyCode || 0, modifiers
                        );
                    } else {
                        // 鼠标事件
                        binaryData = window.binaryEventEncoder.encodeMouseEvent(
                            event.type, event.x, event.y, event.button || 0
                        );
                    }
                    
                    if (binaryData) {
                        this.mjpegWebSocket.send(binaryData);
                        sendSuccess = true;
                        
                        // 调试日志（非移动事件）
                        if (event.type !== 'mousemove') {
                            console.log(`📦 [Binary] 发送 ${event.type}: ${binaryData.byteLength}字节`);
                        }
                    }
                } catch (err) {
                    console.warn('⚠️  二进制编码失败，回退到JSON:', err);
                    sendSuccess = false;
                }
            }
            
            // Fallback: JSON协议
            if (!sendSuccess) {
                this.mjpegWebSocket.send(JSON.stringify({
                    type: 'control',
                    event: event,
                    timestamp: Date.now()
                }));
                
                // 调试日志
                if (event.type !== 'mousemove') {
                    console.log(`🌐 [JSON] 发送 ${event.type}: (${event.x}, ${event.y})`);
                }
            }
            
            // 发送成功后减少计数
            if (event.type === 'click' || event.type === 'mousedown') {
                this.pendingClicks = Math.max(0, this.pendingClicks - 1);
            }
            
        } catch (err) {
            console.error('❌ WebSocket发送失败:', err);
        }
    }
    
    /**
     * 通过HTTP API发送事件（MJPEG模式备用方案）
     */
    async sendEventViaHttp(event: any) {
        // 鼠标移动事件节流（避免发送过多请求）
        if (event.type === 'mousemove') {
            const now = Date.now();
            if (now - this.lastMouseMoveTime < this.mouseMoveThrottle) {
                return; // 跳过过于频繁的mousemove事件
            }
            this.lastMouseMoveTime = now;
        }

        try {
            // 调试日志：非移动事件
            if (event.type !== 'mousemove') {
                console.log(`🌐 [HTTP API] 发送 ${event.type}:`, event);
            }
            
            const response = await fetch(this.httpApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(event)
            });
            
            if (!response.ok) {
                console.error(`❌ HTTP API错误: ${response.status}`);
                const text = await response.text();
                console.error('响应内容:', text);
            } else {
                // 成功但不记录mousemove
                if (event.type !== 'mousemove') {
                    console.log(`✅ [HTTP API] ${event.type} 发送成功`);
                }
            }
        } catch (err) {
            console.error('❌ HTTP API发送失败:', err);
        }
    }

    /**
     * 批量发送队列中的事件
     */
    flushEventQueue() {
        if (this.eventQueue.length === 0) {
            this.batchTimer = null;
            return;
        }

        try {
            // 🔥 新增：DataChannel批量发送支持二进制协议
            if (window.binaryEventEncoder && window.USE_BINARY_EVENTS) {
                // 尝试二进制发送每个事件
                let binarySuccess = true;
                for (const event of this.eventQueue) {
                    let binaryData = null;
                    
                    if (event.type === 'wheel') {
                        binaryData = window.binaryEventEncoder.encodeWheelEvent(
                            event.x, event.y, event.deltaY, event.deltaX || 0
                        );
                    } else if (event.type.startsWith('key')) {
                        const modifiers = 
                            (event.ctrlKey ? 1 : 0) |
                            (event.shiftKey ? 2 : 0) |
                            (event.altKey ? 4 : 0) |
                            (event.metaKey ? 8 : 0);
                        
                        binaryData = window.binaryEventEncoder.encodeKeyboardEvent(
                            event.type, event.key || '', event.keyCode || 0, modifiers
                        );
                    } else {
                        binaryData = window.binaryEventEncoder.encodeMouseEvent(
                            event.type, event.x, event.y, event.button || 0
                        );
                    }
                    
                    if (binaryData) {
                        this.dataChannel.send(binaryData);
                    } else {
                        binarySuccess = false;
                        break;
                    }
                }
                
                if (binarySuccess) {
                    this.eventQueue = [];
                    this.batchTimer = null;
                    return;
                }
            }
            
            // Fallback: JSON协议
            // 单个事件直接发送，多个事件批量发送
            if (this.eventQueue.length === 1) {
                this.dataChannel.send(JSON.stringify(this.eventQueue[0]));
            } else {
                this.dataChannel.send(JSON.stringify({
                    type: 'batch',
                    events: this.eventQueue,
                    timestamp: Date.now()
                }));
            }
            
            this.eventQueue = [];
        } catch (err) {
            console.error('批量发送事件失败:', err);
        }
        
        this.batchTimer = null;
    }

    /**
     * 启用/禁用控制
     */
    toggleControl(enabled: boolean) {
        this.isControlEnabled = enabled;

        console.log(`控制已${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 设置被控端事件处理器
     */
    setupControlledHandlers() {
        if (!this.dataChannel) return;

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // 批量事件
                if (data.type === 'batch') {
                    data.events.forEach(evt => this.handleRemoteEvent(evt));
                } else {
                    this.handleRemoteEvent(data);
                }
            } catch (err) {
                console.error('处理远程事件失败:', err);
            }
        };

        console.log('✓ 被控端事件处理器已设置');
    }

    /**
     * 处理远程控制事件
     */
    handleRemoteEvent(event: any) {
        const startTime = performance.now();
        
        try {
            // 应用坐标修正（如果已校准）
            if (this.coordinateCalibration && this.coordinateCalibration.isCalibrated) {
                if (event.x !== undefined && event.y !== undefined) {
                    const corrected = this.coordinateCalibration.correctCoordinates(event.x, event.y);
                    event.x = corrected.x;
                    event.y = corrected.y;
                }
            }
            
            switch (event.type) {
                case 'mousemove':
                    this.handleMouseMove(event);
                    break;
                case 'mousedown':
                case 'mouseup':
                case 'click':
                case 'dblclick':
                case 'contextmenu':
                    this.handleMouseEvent(event);
                    break;
                case 'wheel':
                    this.handleWheelEvent(event);
                    break;
                case 'keydown':
                case 'keyup':
                case 'keypress':
                    this.handleKeyboardEvent(event);
                    break;
            }
        } catch (err) {
            console.error(`处理${event.type}事件失败:`, err);
        }
        
        const processingTime = performance.now() - startTime;
        if (processingTime > 5) {
            console.warn(`事件处理耗时: ${processingTime.toFixed(2)}ms`);
        }
    }

    /**
     * 处理鼠标移动
     */
    handleMouseMove(event: any) {
        // 鼠标移动不触发实际事件，只用于显示光标位置
        // 可以创建一个虚拟光标来显示远程鼠标位置
        this.updateVirtualCursor(event.x, event.y);
    }

    /**
     * 更新虚拟光标位置
     */
    updateVirtualCursor(x: number, y: number) {
        let cursor = document.getElementById('remote-cursor');
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.id = 'remote-cursor';
            cursor.style.cssText = `
                position: fixed;
                width: 20px;
                height: 20px;
                border: 2px solid red;
                border-radius: 50%;
                pointer-events: none;
                z-index: 999999;
                transform: translate(-50%, -50%);
                transition: left 0.016s, top 0.016s;
            `;
            document.body.appendChild(cursor);
        }
        
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
    }

    /**
     * 处理鼠标事件（点击等）
     */
    handleMouseEvent(event: any) {
        const element = document.elementFromPoint(event.x, event.y);
        
        if (!element) {
            console.warn(`未找到坐标(${event.x}, ${event.y})处的元素`);
            return;
        }

        // 获取元素的XPath
        const xpath = this.getElementXPath(element);
        
        // 记录动作日志
        this.logAction(event.type, element, xpath, event);

        // 创建并派发事件
        const mouseEventInit = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: event.x,
            clientY: event.y,
            screenX: event.x,
            screenY: event.y,
            button: event.button || 0,
            buttons: this.getButtonsFromButton(event.button),
            ctrlKey: event.ctrlKey || false,
            shiftKey: event.shiftKey || false,
            altKey: event.altKey || false,
            metaKey: event.metaKey || false
        };

        let eventObj;
        switch (event.type) {
            case 'click':
            case 'dblclick':
            case 'contextmenu':
                eventObj = new MouseEvent(event.type, mouseEventInit);
                break;
            case 'mousedown':
            case 'mouseup':
                eventObj = new MouseEvent(event.type, mouseEventInit);
                break;
            default:
                return;
        }

        // 派发事件
        element.dispatchEvent(eventObj);

        // 对于特定元素，执行额外的操作
        this.handleSpecialElements(element, event);
    }

    /**
     * 处理滚轮事件
     */
    handleWheelEvent(event: any) {
        const element = document.elementFromPoint(event.x, event.y) || document.documentElement;
        const xpath = this.getElementXPath(element);
        
        this.logAction('wheel', element, xpath, event);

        // 方案1：派发wheel事件
        const wheelEvent = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: event.x,
            clientY: event.y,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ || 0,
            deltaMode: event.deltaMode || 0
        });

        element.dispatchEvent(wheelEvent);

        // 方案2：直接操作滚动（更可靠）
        // 查找最近的可滚动祖先元素
        let scrollTarget = element;
        while (scrollTarget && scrollTarget !== document.body) {
            const style = window.getComputedStyle(scrollTarget);
            const overflowY = style.overflowY;
            const overflowX = style.overflowX;
            
            if (overflowY === 'scroll' || overflowY === 'auto' || 
                overflowX === 'scroll' || overflowX === 'auto') {
                break;
            }
            scrollTarget = scrollTarget.parentElement;
        }
        
        if (!scrollTarget) {
            scrollTarget = document.documentElement;
        }

        // 直接滚动
        const scrollAmount = event.deltaY;
        const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        
        if (isHorizontal) {
            scrollTarget.scrollLeft += event.deltaX;
        } else {
            scrollTarget.scrollTop += scrollAmount;
        }
        
        console.log(`滚动 ${scrollTarget.tagName}: deltaY=${scrollAmount}, 当前scrollTop=${scrollTarget.scrollTop}`);
    }

    /**
     * 处理键盘事件
     */
    handleKeyboardEvent(event: any) {
        const activeElement = document.activeElement;
        const xpath = this.getElementXPath(activeElement);
        
        this.logAction(event.type, activeElement, xpath, event);

        const keyboardEventInit = {
            bubbles: true,
            cancelable: true,
            view: window,
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            charCode: event.charCode || 0,
            ctrlKey: event.ctrlKey || false,
            shiftKey: event.shiftKey || false,
            altKey: event.altKey || false,
            metaKey: event.metaKey || false,
            repeat: event.repeat || false
        };

        const keyEvent = new KeyboardEvent(event.type, keyboardEventInit);
        activeElement.dispatchEvent(keyEvent);

        // 对于输入框，手动设置值
        if (event.type === 'keypress' && 
            (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            this.handleTextInput(activeElement, event.key);
        }
    }

    /**
     * 处理文本输入
     */
    handleTextInput(element: any, key: string) {
        if (key.length === 1) {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const value = element.value;
            
            element.value = value.substring(0, start) + key + value.substring(end);
            element.selectionStart = element.selectionEnd = start + 1;
            
            // 触发input事件
            element.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (key === 'Backspace') {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const value = element.value;
            
            if (start === end && start > 0) {
                element.value = value.substring(0, start - 1) + value.substring(end);
                element.selectionStart = element.selectionEnd = start - 1;
            } else {
                element.value = value.substring(0, start) + value.substring(end);
                element.selectionStart = element.selectionEnd = start;
            }
            
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    /**
     * 处理特殊元素
     */
    handleSpecialElements(element: any, event: any) {
        const tagName = element.tagName.toLowerCase();
        
        // 链接
        if (tagName === 'a' && event.type === 'click') {
            const href = element.getAttribute('href');
            if (href && !href.startsWith('javascript:')) {
                console.log(`导航到: ${href}`);
                // 实际导航会自动发生
            }
        }
        
        // 按钮和表单
        if (tagName === 'button' && event.type === 'click') {
            const form = element.closest('form');
            if (form && element.type === 'submit') {
                console.log('提交表单');
            }
        }
        
        // 复选框和单选框
        if ((tagName === 'input') && 
            (element.type === 'checkbox' || element.type === 'radio') && 
            event.type === 'click') {
            element.checked = !element.checked;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`${element.type} 状态: ${element.checked}`);
        }
        
        // 输入框聚焦
        if ((tagName === 'input' || tagName === 'textarea') && event.type === 'click') {
            element.focus();
            console.log('输入框已聚焦');
        }
    }

    /**
     * 获取元素的XPath
     */
    getElementXPath(element: any) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        if (element.id) {
            return `//*[@id="${element.id}"]`;
        }

        const paths = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let index = 0;
            let sibling = current.previousSibling;

            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE && 
                    sibling.nodeName === current.nodeName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }

            const tagName = current.nodeName.toLowerCase();
            const pathIndex = index > 0 ? `[${index + 1}]` : '';
            paths.unshift(`${tagName}${pathIndex}`);

            current = current.parentNode;
        }

        return paths.length ? `/${paths.join('/')}` : '';
    }

    /**
     * 记录动作日志
     */
    logAction(action: string, element: any, xpath: string, event: any) {
        const tagName = element ? element.tagName.toLowerCase() : 'unknown';
        const elementInfo = this.getElementInfo(element);
        
        const logData = {
            时间: new Date().toLocaleTimeString(),
            动作: action,
            标签: tagName,
            XPath: xpath,
            元素信息: elementInfo,
            事件详情: this.getEventDetails(action, event)
        };

        console.log('%c远程控制动作', 'color: #4CAF50; font-weight: bold', logData);
        
        // 在页面上显示日志
        this.displayActionLog(logData);
    }

    /**
     * 获取元素信息
     */
    getElementInfo(element: any) {
        if (!element) return 'N/A';
        
        const info = [];
        
        if (element.id) info.push(`id="${element.id}"`);
        if (element.className) info.push(`class="${element.className}"`);
        if (element.name) info.push(`name="${element.name}"`);
        if (element.type) info.push(`type="${element.type}"`);
        if (element.value) info.push(`value="${element.value.substring(0, 20)}..."`);
        if (element.textContent) {
            const text = element.textContent.trim().substring(0, 30);
            if (text) info.push(`text="${text}..."`);
        }
        
        return info.join(', ') || 'N/A';
    }

    /**
     * 获取事件详情
     */
    getEventDetails(action: string, event: any) {
        const details = {};
        
        if (action.includes('mouse') || action === 'click' || action === 'dblclick') {
            details.坐标 = `(${event.x}, ${event.y})`;
            if (event.button !== undefined) {
                details.按钮 = ['左键', '中键', '右键'][event.button] || event.button;
            }
        }
        
        if (action === 'wheel') {
            details.滚动 = `deltaY: ${event.deltaY}`;
        }
        
        if (action.includes('key')) {
            details.按键 = event.key;
            if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                const modifiers = [];
                if (event.ctrlKey) modifiers.push('Ctrl');
                if (event.shiftKey) modifiers.push('Shift');
                if (event.altKey) modifiers.push('Alt');
                if (event.metaKey) modifiers.push('Meta');
                details.修饰键 = modifiers.join('+');
            }
        }
        
        return details;
    }

    /**
     * 在页面上显示动作日志
     */
    displayActionLog(logData: any) {
        let logContainer = document.getElementById('remote-control-logs');
        
        if (!logContainer) {
            logContainer = document.createElement('div');
            logContainer.id = 'remote-control-logs';
            logContainer.style.cssText = `
                position: fixed;
                bottom: 10px;
                right: 10px;
                width: 400px;
                max-height: 300px;
                background: rgba(0, 0, 0, 0.9);
                color: #0f0;
                font-family: monospace;
                font-size: 11px;
                padding: 10px;
                border-radius: 5px;
                overflow-y: auto;
                z-index: 999998;
                pointer-events: none;
            `;
            document.body.appendChild(logContainer);
        }

        const logEntry = document.createElement('div');
        logEntry.style.cssText = `
            margin-bottom: 5px;
            padding: 5px;
            border-left: 3px solid #4CAF50;
            background: rgba(0, 255, 0, 0.1);
        `;
        
        logEntry.innerHTML = `
            <div>[${logData.时间}] <strong>${logData.动作}</strong> → ${logData.标签}</div>
            <div style="margin-left: 10px; color: #888;">
                ${logData.元素信息}
            </div>
            <div style="margin-left: 10px; font-size: 10px; color: #666;">
                ${logData.XPath}
            </div>
        `;
        
        logContainer.insertBefore(logEntry, logContainer.firstChild);
        
        // 限制日志条数
        while (logContainer.children.length > 20) {
            logContainer.removeChild(logContainer.lastChild);
        }
    }

    /**
     * 从button值获取buttons值
     */
    getButtonsFromButton(button: number) {
        switch (button) {
            case 0: return 1; // 左键
            case 1: return 4; // 中键
            case 2: return 2; // 右键
            default: return 0;
        }
    }
}

// Expose to module-based frontends (e.g. Vite/React) safely.
// In classic <script> usage this is harmless; in <script type="module"> it enables access via window.RemoteControlManager.
if (typeof window !== 'undefined') {
    window.RemoteControlManager = RemoteControlManager;
}
