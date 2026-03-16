# /controller 全新重写规格（以 legacy 为准）

目标：在 **不再加载任何 `static/js/*.js` 旧脚本** 的前提下，用 React + TypeScript 以模块化架构完整复刻 `static/controller.html` + `static/js/controller-legacy-*.js` 的 **布局、功能、交互**。

本文件把 legacy 行为固化成“需求规格”，用于重写验收与 E2E 测试基准。

## 页面布局（必须保持一致）

来源：`static/controller.html`

- Header（标题栏）
  - 状态栏：连接状态点、状态文本、当前 URL（可点击编辑）、FPS、带宽
  - Header tabs：标签页列表（默认隐藏，tabs>0 显示），支持新建/切换/关闭
  - IME 弹窗：中文输入辅助（textarea、字数统计、清空、发送）
  - 导航/控制按钮：后退、前进、刷新、控制开关、全屏、断开、释放
  - 设置弹窗：画质设置/AI 设置 tab，包含传输模式/帧率/画质/分辨率、模型选择、分离模式、规划模型
  - 脚本按钮：已保存脚本面板开关

- Main container
  - Left panel（视频区）
    - placeholder（启动中提示）
    - remoteVideo（WebRTC 视频）
    - remoteImage（MJPEG 图片）
    - infoOverlay/toolbar/stats（兼容壳）
    - captureModeBadge（投屏模式提示）
    - transportModeBadge（兼容壳，实际内容在 header 隐藏节点 `#psbTransport`）
  - Right panel（AI）
    - AI 脚本编辑区：步骤列表、空态、保存脚本面板、分离模式行、执行/保存/清空/录制/收起
    - AI 对话区：历史消息（可展开/折叠/拖拽高度）、输入框、自适应高度、发送/停止

## 核心能力（必须完整实现）

### 传输/投屏

来源：`static/js/controller-legacy-stream.js` + `static/js/stream-player-manager.js` + `static/js/h264-*.js`

- WebRTC 模式（VP8）：
  - RTCPeerConnection 创建、offer/answer 交换：`POST /api/webrtc/offer`
  - `ontrack` 接收视频轨道并绑定到 `#remoteVideo`
  - DataChannel（如存在）用于控制事件发送
  - ICE 状态变化处理 + 自动重连（按 legacy 逻辑）

- MJPEG 模式：
  - 连接 WebSocket：`ws://{hostname}:5567`
  - 接收帧并展示在 `#remoteImage`（或播放器管理器）
  - 支持二进制事件协议（MJPEGEventEncoder），否则 JSON fallback

- Scrcpy（H.264）模式：
  - 复用同一 WebSocket，切换为 H.264 流
  - H264StreamProtocol 解包 INIT_DATA / VIDEO_FRAME
  - StreamPlayerManager 自动选择 WebCodecs / MSE 播放器并渲染

### 远程控制（鼠标/键盘/滚轮等）

来源：`static/js/remote-control.js` + encoder 脚本

- WebRTC：通过 DataChannel 发送
- MJPEG/Scrcpy：优先通过 WebSocket 发送（二进制优先），fallback 到 HTTP：`POST /api/control/event`
- 包含节流/批量发送/坐标校准/点击防积压（按 legacy 行为）

### 会话与导航

来源：`static/js/controller-legacy-stream.js`

- URL 导航：`POST /api/session/navigate`
- 后退/前进：`POST /api/session/back` / `POST /api/session/forward`
- 刷新：`POST /api/session/reload`
- 状态刷新：`GET /api/session/status`（更新当前 URL、debugPort 等）
- 设置应用：`POST /api/session/settings`（fps/quality/resolution/encoding_mode）
- 断开连接：清理 WebRTC/WS/播放器/UI 状态
- 释放实例：断开 + `POST /api/session/reset`（并做必要资源清理）

### Tabs

来源：`static/js/controller-legacy-stream.js`

- 列表：`GET /api/tabs/list`
- 切换：`POST /api/tabs/switch`
- 关闭：`POST /api/tabs/close`
- 新建：`POST /api/tabs/create`
- UI：header tabs 显示/隐藏、active 标记、close 按钮策略

### 统计/轮询

来源：`static/js/controller-legacy-stream.js`

- FPS/带宽（EWMA + 衰减到 0）：`#fps` / `#bandwidth`
- 带宽轮询：`GET /api/stats/bandwidth`
- 传输模式轮询：`GET /api/session/transport_mode`
- 投屏模式轮询：`GET /api/session/capture_mode`

### 自动连接（非 E2E）

来源：`static/js/controller-legacy-stream.js`

- 当 `!window.__controllerE2E` 时：
  - 默认 MJPEG + 1080p
  - applySettings → connectMJPEG → navigate 到 testerhome

### Recorder（录制）

来源：`static/js/controller-legacy-stream.js` + `static/js/controller-legacy-ai.js`

- UI：AI 面板「录制」按钮（录制到脚本编辑区）
- 后端 API：
  - `POST /api/recorder/start`
  - `POST /api/recorder/stop`
- WebSocket 消息（来自 5567）：
  - `RECORDING_STARTED`
  - `NEW_STEP`
  - `RECORDING_STOPPED`
- 录制步骤转脚本步骤：`recordingStepToScriptStep`（含 xpath/css/coords/viewport/boundingBox 等提取）
- 可选 enrichment：
  - 服务端快照 `step._frame_base64` 优先，否则 `captureMjpegFrame()`
  - OCR/定位/补全定位信息（按 legacy）

### AI 助手（对话/脚本/执行/保存）

来源：`static/js/controller-legacy-ai.js`

- 对话：
  - `POST /api/ai/run` 生成步骤/回复，支持 stop generation
  - 对话历史显示、展开/折叠、拖拽高度、输入框自适应高度
- 脚本编辑区：
  - 添加/删除/移动/拖拽排序/插入点
  - 单步执行与全部执行：`POST /api/ai/execute-step`
  - 步骤编辑器（含 locator 自愈策略：xpath/css/text/ocr/percent/boundingBox 等）
- 保存脚本：
  - 列表：`GET /api/ai/scripts`
  - 保存：`POST /api/ai/scripts`
  - 读取：`GET /api/ai/scripts/{id}`
  - 删除：`DELETE /api/ai/scripts/{id}`
  - 重命名：`POST /api/ai/scripts/{id}/rename`
  - 导出：`GET /api/ai/scripts/{id}/export`
- OCR：
  - `POST /api/ocr/extract-text`
  - （可选）AI 服务 VLM OCR：`http://127.0.0.1:3100/api/vlm-ocr/start` / `.../result/{taskId}`
- Toast：轻提示（成功/错误等）

## 关键持久化 Key（localStorage）

- `ai_model`
- `ai_split_mode`
- `ai_planning_model`

## WebSocket（5567）消息类型（需完整路由）

- MJPEG 帧/模式信息/Tab 信息/控制 ACK（按 legacy 解析）
- H.264：INIT_DATA、VIDEO_FRAME（Binary）
- Recorder：RECORDING_STARTED / NEW_STEP / RECORDING_STOPPED

