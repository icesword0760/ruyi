/**
 * WebRTC Screen Recorder - Content Script
 * 注入悬浮按钮，捕获用户操作
 */

console.log('🎬 WebRTC Recorder Content Script 已加载');

// 录制状态
let isRecording = false;
let stepCounter = 0;

// 创建悬浮录制按钮
function createFloatingButton() {
  // 检查是否已存在
  if (document.getElementById('webrtc-recorder-button')) {
    return;
  }

  const button = document.createElement('div');
  button.id = 'webrtc-recorder-button';
  button.className = 'webrtc-recorder-btn';
  button.innerHTML = `
    <div class="recorder-icon">●</div>
    <div class="recorder-text">录制</div>
  `;
  
  button.addEventListener('click', toggleRecording);
  document.body.appendChild(button);
  
  console.log('✅ 悬浮录制按钮已创建');
}

// 切换录制状态
function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

// 开始录制
function startRecording() {
  isRecording = true;
  stepCounter = 0;
  
  // 更新按钮样式
  const button = document.getElementById('webrtc-recorder-button');
  button.classList.add('recording');
  button.querySelector('.recorder-icon').textContent = '■';
  button.querySelector('.recorder-text').textContent = '停止';
  
  // 通知background script
  chrome.runtime.sendMessage({
    type: 'START_RECORDING'
  });
  
  // 开始监听用户操作
  attachEventListeners();
  
  console.log('🔴 开始录制');
}

// 停止录制
function stopRecording() {
  isRecording = false;
  
  // 更新按钮样式
  const button = document.getElementById('webrtc-recorder-button');
  button.classList.remove('recording');
  button.querySelector('.recorder-icon').textContent = '●';
  button.querySelector('.recorder-text').textContent = '录制';
  
  // 通知background script
  chrome.runtime.sendMessage({
    type: 'STOP_RECORDING'
  });
  
  // 移除事件监听
  removeEventListeners();
  
  console.log('⏹️ 停止录制');
}

// 事件监听器引用（用于移除）
const eventListeners = {
  click: null,
  input: null,
  change: null,
  scroll: null
};

// 附加事件监听器
function attachEventListeners() {
  // 点击事件
  eventListeners.click = (e) => {
    if (e.target.id === 'webrtc-recorder-button' || 
        e.target.closest('#webrtc-recorder-button')) {
      return; // 忽略录制按钮自身的点击
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
  
  // 输入事件
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
  
  // 表单变更
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
  
  // 滚动事件（节流）
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
  
  // 添加监听器
  document.addEventListener('click', eventListeners.click, true);
  document.addEventListener('input', eventListeners.input, true);
  document.addEventListener('change', eventListeners.change, true);
  window.addEventListener('scroll', eventListeners.scroll, true);
  
  console.log('✅ 事件监听器已附加');
}

// 移除事件监听器
function removeEventListeners() {
  document.removeEventListener('click', eventListeners.click, true);
  document.removeEventListener('input', eventListeners.input, true);
  document.removeEventListener('change', eventListeners.change, true);
  window.removeEventListener('scroll', eventListeners.scroll, true);
  
  console.log('✅ 事件监听器已移除');
}

// 记录步骤
function recordStep(type, description, details) {
  if (!isRecording) return;
  
  stepCounter++;
  
  const step = {
    number: stepCounter,
    type: type,
    description: description,
    timestamp: new Date().toISOString(),
    details: details
  };
  
  // 发送到background script
  chrome.runtime.sendMessage({
    type: 'RECORD_STEP',
    data: step
  });
  
  console.log('📝 步骤记录:', step);
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
  
  // 使用父元素 + nth-child
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

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'RECORDING_STATUS_CHANGED') {
    isRecording = request.isRecording;
    
    if (isRecording) {
      attachEventListeners();
    } else {
      removeEventListeners();
    }
    
    // 更新按钮状态
    const button = document.getElementById('webrtc-recorder-button');
    if (button) {
      if (isRecording) {
        button.classList.add('recording');
        button.querySelector('.recorder-icon').textContent = '■';
        button.querySelector('.recorder-text').textContent = '停止';
      } else {
        button.classList.remove('recording');
        button.querySelector('.recorder-icon').textContent = '●';
        button.querySelector('.recorder-text').textContent = '录制';
      }
    }
  }
  
  sendResponse({ received: true });
});

// 页面加载完成后创建按钮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFloatingButton);
} else {
  createFloatingButton();
}

// 确保按钮始终显示（防止被页面覆盖）
setInterval(() => {
  const button = document.getElementById('webrtc-recorder-button');
  if (!button) {
    createFloatingButton();
  }
}, 3000);

// 记录页面导航
chrome.runtime.sendMessage({
  type: 'RECORD_STEP',
  data: {
    number: 0,
    type: 'navigate',
    description: `导航到 ${window.location.href}`,
    timestamp: new Date().toISOString(),
    details: {
      url: window.location.href
    }
  }
});
