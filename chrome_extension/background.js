/**
 * WebRTC Screen Recorder - Background Service Worker
 * 管理录制状态，协调content script和后端通信
 */

console.log('🎬 WebRTC Screen Recorder 插件已启动');

// 全局录制状态
let isRecording = false;
let recordingId = null;
let recordingStartTime = null;

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background收到消息:', request.type);

  if (request.type === 'START_RECORDING') {
    handleStartRecording(sender.tab.id);
    sendResponse({ success: true });
  } 
  else if (request.type === 'STOP_RECORDING') {
    handleStopRecording();
    sendResponse({ success: true });
  }
  else if (request.type === 'RECORD_STEP') {
    handleRecordStep(request.data);
    sendResponse({ success: true });
  }
  else if (request.type === 'GET_STATUS') {
    sendResponse({ 
      isRecording: isRecording,
      recordingId: recordingId,
      startTime: recordingStartTime
    });
  }

  return true; // 保持消息通道开启
});

// 开始录制
function handleStartRecording(tabId) {
  isRecording = true;
  recordingId = Date.now();
  recordingStartTime = new Date().toISOString();
  
  console.log('🔴 开始录制, ID:', recordingId);
  
  // 通知后端开始录制
  sendToBackend('START_RECORDING', {
    recordingId: recordingId,
    startTime: recordingStartTime,
    tabId: tabId
  });
  
  // 通知所有content scripts录制已开始
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'RECORDING_STATUS_CHANGED',
        isRecording: true
      }).catch(() => {});
    });
  });
}

// 停止录制
function handleStopRecording() {
  if (!isRecording) return;
  
  console.log('⏹️ 停止录制, ID:', recordingId);
  
  const endTime = new Date().toISOString();
  
  // 通知后端停止录制
  sendToBackend('STOP_RECORDING', {
    recordingId: recordingId,
    endTime: endTime
  });
  
  isRecording = false;
  recordingId = null;
  recordingStartTime = null;
  
  // 通知所有content scripts录制已停止
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'RECORDING_STATUS_CHANGED',
        isRecording: false
      }).catch(() => {});
    });
  });
}

// 记录步骤
function handleRecordStep(stepData) {
  if (!isRecording) return;
  
  console.log('📝 记录步骤:', stepData.type);
  
  // 发送步骤到后端
  sendToBackend('RECORD_STEP', {
    recordingId: recordingId,
    step: stepData
  });
}

// 发送数据到后端
function sendToBackend(type, data) {
  // 通过HTTP发送到Flask后端
  fetch('http://localhost:5000/api/recorder/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: type,
      data: data,
      timestamp: Date.now()
    })
  })
  .then(response => response.json())
  .then(result => {
    console.log('✅ 后端响应:', result);
  })
  .catch(error => {
    console.warn('⚠️ 后端通信失败:', error);
  });
}

// 插件安装时
chrome.runtime.onInstalled.addListener(() => {
  console.log('✅ WebRTC Screen Recorder 插件已安装');
});
