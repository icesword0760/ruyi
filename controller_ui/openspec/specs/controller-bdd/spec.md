---
title: Controller 页面 BDD 风格产品需求文档 (V2)
date: 2026-03-11
tags: [prd, bdd, controller, webrtc]
aliases: [PRD, BDD需求文档, Controller PRD V2]
---

# Controller 页面 BDD 风格产品需求文档 (V2)

> 本文档按产品视角将 Controller 页面拆分为 **70 个原子模块**，覆盖 **~230 个 BDD Scenario**。每个 Scenario 标注源码文件及行号。
>
> **V2 改进**：通过 GitNexus 调用图补充了逻辑步骤系统（9 个校验函数）、拖拽系统（17 个函数）、Detach 分离窗口、videoFit、可访问性等横切功能域；严格对照 ACCEPTANCE_MATRIX 76 个验收场景确认无遗漏。
>
> 关联文档：[[FLOW_STATE_MACHINE]] · [[TEST_CASES]] · [[ACCEPTANCE_CHECKLIST]]

---

## 模块总览

### A. 页面外壳与初始化

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 1 | [页面加载与初始化](#m01) | 4 | App.tsx:24-132, streamCore.ts:67-75 | SHELL-001 |
| 2 | [可访问性与动效偏好](#m02) | 3 | ControllerLayout.tsx, aurora.ts | SHELL-002, SHELL-003 |
| 3 | [连接状态机](#m03) | 5 | streamCore.ts:778-821, controllerStore.ts | STATE-001~005 |

### B. 导航与标签页

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 4 | [URL 导航](#m04) | 5 | urlEdit.ts:29-86 | NAV-001~004 |
| 5 | [后退/前进/刷新](#m05) | 4 | navigationActions.ts:20-59 | NAV-005, NAV-006 |
| 6 | [标签页列表展示](#m06) | 3 | tabs.ts:26-87 | TAB-001 |
| 7 | [标签页新建](#m07) | 2 | headerActions.ts:267-289 | TAB-002 |
| 8 | [标签页切换](#m08) | 2 | tabs.ts:89-102 | TAB-003 |
| 9 | [标签页关闭](#m09) | 3 | tabs.ts:104-122 | TAB-004 |
| 10 | [标签页自动切换](#m10) | 2 | streamCore.ts:1085-1110 | TAB-005 |

### C. 远程控制

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 11 | [远程控制开关](#m11) | 3 | headerActions.ts:65-82 | CTRL-001 |
| 12 | [鼠标单击/双击/右键](#m12) | 5 | remoteControlManager.ts:308-348 | CTRL-002 |
| 13 | [鼠标移动与拖拽](#m13) | 4 | remoteControlManager.ts:194-305 | CTRL-003 |
| 14 | [滚轮操作](#m14) | 2 | remoteControlManager.ts:351-365 | CTRL-003 |
| 15 | [键盘输入](#m15) | 3 | remoteControlManager.ts:378-499 | CTRL-004 |
| 16 | [IME 中文组合输入](#m16) | 3 | remoteControlManager.ts:525-569 | — |
| 17 | [剪贴板粘贴](#m17) | 3 | remoteControlManager.ts:580-625 | — |
| 18 | [坐标校准](#m18) | 3 | remoteControlManager.ts:56-181 | — |
| 19 | [事件传输通道](#m19) | 4 | remoteControlManager.ts:641-831 | — |
| 20 | [IME 输入助手弹窗](#m20) | 5 | headerPopups.ts:96-182, headerActions.ts:291-317 | IME-001~004 |

### D. 连接与传输

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 21 | [WebRTC 连接](#m21) | 4 | streamCore.ts:742-850 | CONN-001 |
| 22 | [MJPEG 连接](#m22) | 4 | streamCore.ts:974-1161 | CONN-002 |
| 23 | [Scrcpy (H.264) 连接](#m23) | 3 | streamCore.ts, streamPlayerManager.ts:63-165 | CONN-003 |
| 24 | [传输模式切换](#m24) | 3 | headerActions.ts:214-265 | SET-004 |
| 25 | [断开连接](#m25) | 2 | headerActions.ts:88-156 | CONN-004 |
| 26 | [释放实例](#m26) | 3 | headerActions.ts:158-204 | CONN-005 |
| 27 | [视频适配 (videoFit)](#m27) | 3 | videoFit.ts:8-113 | — |

### E. 设置与全屏

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 28 | [设置弹窗开关](#m28) | 3 | headerPopups.ts:96-112 | SET-001 |
| 29 | [设置选项卡切换](#m29) | 2 | headerPopups.ts:114-120 | SET-002 |
| 30 | [画质设置](#m30) | 4 | headerActions.ts:206-212, streamCore.ts:605-634 | SET-003 |
| 31 | [AI 引擎设置](#m31) | 4 | headerPopups.ts:122-169 | SET-005 |
| 32 | [分离模式设置](#m32) | 3 | headerPopups.ts:152-162, aiCore.ts:5361-5371 | SET-006 |
| 33 | [全屏模式](#m33) | 2 | headerActions.ts:84-86, streamCore.ts:667-698 | FULL-001 |

### F. 日志面板

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 34 | [日志面板-视图切换](#m34) | 2 | logPanel.ts:18-72 | LOG-005 |
| 35 | [日志面板-筛选](#m35) | 2 | logPanel.ts:74-78 | LOG-002 |
| 36 | [日志面板-搜索](#m36) | 2 | logPanel.ts:80-83 | LOG-003 |
| 37 | [日志面板-自动滚动](#m37) | 2 | streamCore.ts:309-318 | LOG-001 |
| 38 | [日志面板-清空/导出](#m38) | 3 | streamCore.ts:276-305 | LOG-004 |

### G. 布局与面板

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 39 | [Dock 面板-拖拽调整](#m39) | 3 | dockLayout.ts:32-132 | — |
| 40 | [Dock 面板-折叠/展开](#m40) | 2 | dockLayout.ts:42-75 | — |
| 41 | [浮动面板](#m41) | 4 | floatingDock.ts:16-177 | — |
| 42 | [工具栏折叠/展开](#m42) | 2 | aiCore.ts:6086-6216 | — |
| 43 | [对话区拖拽调整高度](#m43) | 3 | aiCore.ts:5889-6050 | — |
| 44 | [Detach 分离窗口](#m44) | 4 | aiCore.ts:5380-5680 | — |

### H. AI 对话

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 45 | [AI 对话-发送消息](#m45) | 4 | aiCore.ts:4330-4434 | AI-001 |
| 46 | [AI 对话-SSE 流式处理](#m46) | 7 | aiCore.ts:4575-4799 | AI-001 |
| 47 | [AI 对话-停止生成](#m47) | 2 | aiCore.ts:4317-4328 | AI-002 |
| 48 | [AI 对话-浮框操作](#m48) | 4 | aiCore.ts:5013-5079 | AI-003, AI-004 |

### I. 脚本步骤管理

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 49 | [步骤新增](#m49) | 4 | aiCore.ts:2288-2460 | AI-003, AI-004 |
| 50 | [步骤删除](#m50) | 12 | aiCore.ts:2463-2555, 546-598, 285-383 | — |
| 51 | [步骤移动排序](#m51) | 3 | aiCore.ts:2594-2662, 2562-2591 | — |
| 52 | [步骤拖拽排序](#m52) | 5 | aiCore.ts:1110-1817 | AI-005 |
| 53 | [步骤选择/复制/清空](#m53) | 3 | aiCore.ts:2663-2813 | — |
| 54 | [步骤折叠/高亮](#m54) | 3 | aiCore.ts:2262-2285 | — |

### J. 逻辑步骤系统 (**V2 新增独立域**)

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 55 | [逻辑组生命周期](#m55) | 4 | aiCore.ts:279-383 | — |
| 56 | [逻辑链校验引擎](#m56) | 5 | aiCore.ts:393-598 | — |
| 57 | [逻辑感知拖拽约束](#m57) | 3 | aiCore.ts:1351-1542 | — |
| 58 | [嵌套渲染与树线](#m58) | 3 | aiCore.ts:907-1107 | — |

### K. 步骤编辑器

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 59 | [编辑器打开/关闭](#m59) | 3 | aiCore.ts:3087-3701 | AI-008 |
| 60 | [动作类型切换](#m60) | 4 | aiCore.ts:3249-3324 | AI-008 |
| 61 | [逻辑步骤编辑](#m61) | 5 | aiCore.ts:3327-3435 | — |
| 62 | [保存校验](#m62) | 4 | aiCore.ts:3496-3693 | AI-008 |
| 63 | [定位器管理](#m63) | 3 | aiCore.ts:2828-3083 | AI-009 |

### L. 步骤执行

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 64 | [单步执行](#m64) | 4 | aiCore.ts:3753-3812 | AI-006 |
| 65 | [全部执行/从此执行](#m65) | 4 | aiCore.ts:3815-3995 | AI-007 |
| 66 | [步骤重新生成](#m66) | 3 | aiCore.ts:3998-4045 | — |
| 67 | [OCR 重试](#m67) | 2 | aiCore.ts:2151-2196 | AI-010 |

### M. 脚本持久化

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 68 | [脚本保存](#m68) | 3 | aiCore.ts:5728-5775 | SCRIPT-001 |
| 69 | [脚本加载](#m69) | 3 | aiCore.ts:5818-5839 | SCRIPT-002 |
| 70 | [脚本重命名](#m70) | 2 | server.py:972-983 | SCRIPT-003 |
| 71 | [脚本删除](#m71) | 2 | aiCore.ts:5841-5855 | SCRIPT-004 |
| 72 | [脚本导出](#m72) | 2 | aiCore.ts:5857-5876 | SCRIPT-005 |

### N. 录制

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 73 | [录制开始/停止](#m73) | 4 | aiCore.ts:2111-2137, streamCore.ts:913-971 | REC-001 |
| 74 | [录制步骤转换](#m74) | 3 | aiCore.ts:1858-1971 | REC-001 |
| 75 | [录制 Enrichment](#m75) | 4 | aiCore.ts:1977-2095 | REC-002 |

### O. 统计与持久化

| # | 模块 | Scenario 数 | 关键源码 | 验收矩阵 |
|---|------|------------|---------|----------|
| 76 | [FPS/带宽统计](#m76) | 3 | streamCore.ts:111-208 | — |
| 77 | [传输/捕获模式轮询](#m77) | 2 | streamCore.ts:506-562 | — |
| 78 | [设置 localStorage 持久化](#m78) | 4 | 各模块 | SET-005, SET-006 |

**合计：78 模块 · ~234 Scenario · 对照 ACCEPTANCE_MATRIX 76 场景全覆盖**

---

## BDD Scenario 详细描述

> 以下按模块编号逐一展开。由于篇幅限制，每个 Scenario 使用紧凑 Gherkin 格式。

---

<a id="m01"></a>
### M01 — 页面加载与初始化

**S1.1** 页面加载展示占位符 `App.tsx:24-132` · `streamCore.ts:67-75`
```gherkin
Given 用户访问 /controller
When React 渲染完成
Then 显示占位符（aurora 动画 + 打字机提示）; 状态="未连接"; FPS/带宽="-"
```

**S1.2** 模块安装初始化 `install.ts:16-29` (GitNexus: installControllerModules → 9 个子模块)
```gherkin
Given DOM 就绪
When installControllerModules() 执行
Then 按序安装 9 个模块: headerActions, headerPopups, navigationActions, tabs, urlEdit, logPanel, dockLayout, floatingDock, videoFit
  And window.__controllerNewAppInitialized = true
```

**S1.3** AI Core 初始化 `aiCore.ts:6028-6043`
```gherkin
Given initStreamCore() 完成
When initAiCore() 执行
Then 缓存 DOM 引用; 恢复 AI 模型/分离模式; 渲染空步骤列表; 加载已保存脚本
```

**S1.4** 自动连接 `streamCore.ts` 初始化尾部
```gherkin
Given 非 E2E 模式 (window.__controllerE2E 未设置)
When 初始化完成
Then 以 MJPEG 连接 + 应用 1080p 设置
```

---

<a id="m02"></a>
### M02 — 可访问性与动效偏好

**S2.1** 减弱动效偏好 `ControllerLayout.tsx:31-77`
```gherkin
Given 用户系统设置 prefers-reduced-motion
When 页面加载
Then aurora 动画使用低帧率或禁用; 打字机效果使用即时显示
```

**S2.2** 键盘导航 `ControllerLayout.tsx:107-640`
```gherkin
Given 页面已加载
When 用户使用 Tab 键导航
Then 所有可交互元素可通过 Tab 聚焦; 焦点顺序符合视觉顺序
```

**S2.3** Escape 关闭弹窗 `headerPopups.ts:78-94`
```gherkin
Given 任意弹窗打开
When 用户按 Escape
Then 弹窗关闭; 焦点返回触发元素
```

---

<a id="m03"></a>
### M03 — 连接状态机

> 详见 [[FLOW_STATE_MACHINE#连接状态机]]

**S3.1** 初始断开状态 `controllerStore.ts:32-39`
```gherkin
Given 页面刚加载
Then store.connected=false; statusText="未连接"; placeholder 可见; connectBtn 启用
```

**S3.2** 进入 Connecting `streamCore.ts:742-750`
```gherkin
Given Disconnected
When 用户点击连接
Then connectBtn 禁用; 状态="正在连接..."
```

**S3.3** Connected `streamCore.ts:804-821`
```gherkin
Given Connecting
When onconnectionstatechange="connected"
Then isConnected=true; disconnectBtn 启用; 启动所有轮询; store.setConnected(true)
```

**S3.4** Degraded 自动重连 `streamCore.ts:778-802`
```gherkin
Given Connected
When oniceconnectionstatechange="disconnected"
Then 状态="连接中断，正在重连..."; 2s 后自动 reconnect()
```

**S3.5** Error 手动重连 `streamCore.ts:778-802`
```gherkin
Given Connecting 或 Connected
When ice state="failed"
Then 状态="连接失败"; 显示 reconnectBtn; 用户可手动重连
```

---

<a id="m04"></a>
### M04 — URL 导航

**S4.1** 进入编辑模式 `urlEdit.ts:44-54`
```gherkin
Given Connected, URL 显示 "https://example.com"
When 点击 URL 标签
Then 标签隐藏，输入框显示，预填当前 URL，聚焦并全选
```

**S4.2** 提交导航 `urlEdit.ts:56-78`
```gherkin
Given URL 输入框编辑中，输入 "baidu.com"
When 按 Enter
Then normalizeUrl → "https://baidu.com"; POST /api/session/navigate; 更新 URL; refreshStatus
```

**S4.3** 取消编辑 `urlEdit.ts:80-86`
```gherkin
Given URL 编辑中
When 按 Escape 或失焦
Then 恢复原值，不发送请求
```

**S4.4** 协议自动补全 `urlEdit.ts:17-27`
```gherkin
Given 提交 URL
When 缺少协议: "example.com" → "https://example.com"; "//x.com" → "https://x.com"
```

**S4.5** 导航失败 `urlEdit.ts:56-78`
```gherkin
Given 提交导航
When 后端返回错误
Then 控制台记录错误; URL 标签恢复
```

---

<a id="m05"></a>
### M05 — 后退/前进/刷新

**S5.1** 后退 `navigationActions.ts:25-35`
```gherkin
Given Connected; When 点击后退; Then POST /api/session/back; 更新 URL
```

**S5.2** 前进 `navigationActions.ts:37-47`
```gherkin
Given Connected; When 点击前进; Then POST /api/session/forward; 更新 URL
```

**S5.3** 刷新 `navigationActions.ts:49-59`
```gherkin
Given Connected; When 点击刷新; Then POST /api/session/reload; refreshStatus
```

**S5.4** 操作失败 `navigationActions.ts:25-59`
```gherkin
When 任一操作返回错误; Then 显示 toast/alert
```

---

<a id="m06"></a>
### M06 — 标签页列表展示

**S6.1** 连接后加载 `tabs.ts:31-53`
```gherkin
Given Connected; When refreshTabs(); Then GET /api/tabs/list; 更新列表和 store
```

**S6.2** 渲染 `tabs.ts:55-87`
```gherkin
Given 3 个标签页; Then 渲染 3 个 div; active 标签有 .active; 多标签时显示关闭按钮
```

**S6.3** 3s 轮询 `streamCore.ts:492-503`
```gherkin
Given Connected; Then 每 3s refreshTabs; 自动反映新增/删除/标题变更
```

---

<a id="m07"></a>
### M07 — 标签页新建

**S7.1** 新建 `headerActions.ts:267-289`
```gherkin
Given Connected; When 点击新建; Then 输入 URL(默认 baidu.com); POST /api/tabs/create; 刷新并切换
```

**S7.2** 取消 `headerActions.ts:267-289`
```gherkin
When 取消对话框; Then 无操作
```

---

<a id="m08"></a>
### M08 — 标签页切换

**S8.1** 切换 `tabs.ts:89-102`
```gherkin
Given 多标签; When 点击 Tab-B; Then POST /api/tabs/switch; activeTabId 更新; 刷新
```

**S8.2** 失败 `tabs.ts:89-102`
```gherkin
When 后端错误; Then toast 提示; 列表不变
```

---

<a id="m09"></a>
### M09 — 标签页关闭

**S9.1** 关闭 `tabs.ts:104-122`
```gherkin
Given 3 个标签; When 关闭一个; Then POST /api/tabs/close; 刷新列表
```

**S9.2** 阻止关闭最后 `tabs.ts:104-122`
```gherkin
Given 1 个标签; When 点击关闭; Then 提示"不能关闭最后一个"; 不发送请求
```

**S9.3** 关闭失败 `tabs.ts:104-122`
```gherkin
When 后端错误; Then toast; 列表不变
```

---

<a id="m10"></a>
### M10 — 标签页自动切换

**S10.1** TAB_CREATED 消息 `streamCore.ts:1085-1110`
```gherkin
Given MJPEG/Scrcpy 连接中
When WebSocket 收到 TAB_CREATED { targetId }
Then 500ms 后自动 switchToTab(targetId)
```

**S10.2** TAB_SWITCHED 消息 `streamCore.ts:1085-1110`
```gherkin
When WebSocket 收到 TAB_SWITCHED { activeTabId, resolution }
Then 更新 activeTabId; 同步分辨率; refreshTabs
```

---

<a id="m11"></a>
### M11 — 远程控制开关

**S11.1** 启用 `headerActions.ts:65-82` (GitNexus: → remoteControlManager.toggleControl:908)
```gherkin
Given Connected, 控制禁用; When 点击开关; Then toggleControl(true); Badge="ON"; 按钮 .active
```

**S11.2** 禁用 `headerActions.ts:65-82`
```gherkin
Given 控制启用; When 点击开关; Then toggleControl(false); Badge="OFF"
```

**S11.3** 断开时自动禁用 `headerActions.ts:88-156`
```gherkin
Given 控制启用; When disconnect(); Then controlEnabled=false
```

---

<a id="m12"></a>
### M12 — 鼠标单击/双击/右键

**S12.1** 单击 `remoteControlManager.ts:308-318`
```gherkin
Given 控制启用; When 单击视频区域; Then getRelativeCoords→send {type:"click", x, y, button:0}
```

**S12.2** 双击 `remoteControlManager.ts:322-332`
```gherkin
When 双击; Then send {type:"dblclick", x, y, button:0}
```

**S12.3** 右键 `remoteControlManager.ts:336-347`
```gherkin
When 右键; Then preventDefault; send {type:"contextmenu", x, y, button:2}
```

**S12.4** 控制禁用时不响应 `remoteControlManager.ts:308-348`
```gherkin
Given 控制禁用; When 点击; Then 不发送事件
```

**S12.5** 点击节流 `remoteControlManager.ts:691-789`
```gherkin
Given WebSocket 通道; When 50ms 内连续点击; Then 仅发第一次; 最多 5 pending
```

---

<a id="m13"></a>
### M13 — 鼠标移动与拖拽

**S13.1** 移动 `remoteControlManager.ts:194-228`
```gherkin
Given 控制启用; When 移动鼠标; Then rAF 节流(~60fps); send {type:"mousemove", x, y}
```

**S13.2** 拖拽开始 `remoteControlManager.ts:232-251`
```gherkin
When mousedown; Then isDragging=true; send {type:"mousedown", x, y, button}
```

**S13.3** 拖拽中移动 `remoteControlManager.ts:194-228`
```gherkin
Given isDragging; When 移动; Then 立即发送(不节流); 携带 button
```

**S13.4** 拖拽结束/鼠标离开 `remoteControlManager.ts:255-304`
```gherkin
When mouseup(移动>5px); Then send mouseup; isDragging=false
When 鼠标离开视频区; Then 自动发 mouseup 清理状态
```

---

<a id="m14"></a>
### M14 — 滚轮操作

**S14.1** 垂直滚动 `remoteControlManager.ts:351-364`
```gherkin
Given 控制启用; When 滚轮; Then preventDefault; send {type:"wheel", deltaX, deltaY}
```

**S14.2** 水平滚动 `remoteControlManager.ts:351-364`
```gherkin
When Shift+滚轮或触控板; Then send {type:"wheel", deltaX:非零}
```

---

<a id="m15"></a>
### M15 — 键盘输入

**S15.1** 普通按键 `remoteControlManager.ts:378-446`
```gherkin
Given 控制启用, 焦点不在本地输入框; When 按"a"; Then preventDefault; send keydown+keyup
```

**S15.2** 修饰键组合 `remoteControlManager.ts:378-446`
```gherkin
When Ctrl+C; Then send keydown(ctrlKey:true); 不触发本地复制
```

**S15.3** Ctrl+V 特殊处理 `remoteControlManager.ts:378-446`
```gherkin
When Ctrl+V; Then 不 preventDefault(让 paste 事件触发); 由 handlePaste 处理
```

---

<a id="m16"></a>
### M16 — IME 中文组合输入

**S16.1** 组合开始 `remoteControlManager.ts:525-536`
```gherkin
When compositionstart; Then isComposing=true; 暂停键盘转发
```

**S16.2** 组合更新 `remoteControlManager.ts:538-542`
```gherkin
Given isComposing; When compositionupdate; Then 仅记录调试日志
```

**S16.3** 组合结束 `remoteControlManager.ts:544-569`
```gherkin
When compositionend; Then send keydown(key=确认文本); isComposing=false; 恢复转发
```

---

<a id="m17"></a>
### M17 — 剪贴板粘贴

**S17.1** 短文本(≤100字符) `remoteControlManager.ts:580-625`
```gherkin
When paste ≤100 字符; Then preventDefault; 逐字符 send keydown
```

**S17.2** 长文本(>100字符) `remoteControlManager.ts:580-625`
```gherkin
When paste >100 字符; Then 单次 send keydown(完整文本)
```

**S17.3** 数据源回退 `remoteControlManager.ts:580-625`
```gherkin
When paste; Then 优先 event.clipboardData; 回退 navigator.clipboard.readText()
```

---

<a id="m18"></a>
### M18 — 坐标校准

> 详见 [[FLOW_STATE_MACHINE#远程控制事件流]]

**S18.1** VIDEO 元素 `remoteControlManager.ts:56-181`
```gherkin
Given <video> 渲染中; When getRelativeCoords; Then 用 videoWidth/Height; 考虑 object-fit 黑边
```

**S18.2** IMG 元素 `remoteControlManager.ts:56-181`
```gherkin
Given <img> 渲染中; When getRelativeCoords; Then 优先 backendResolution; fallback naturalWidth
```

**S18.3** CANVAS 元素 `remoteControlManager.ts:56-181`
```gherkin
Given <canvas> 渲染中; When getRelativeCoords; Then 用 canvas.width/height
```

---

<a id="m19"></a>
### M19 — 事件传输通道

> 详见 [[FLOW_STATE_MACHINE#远程控制事件流]]

**S19.1** WebSocket 通道 `remoteControlManager.ts:691-789`
```gherkin
Given MJPEG/Scrcpy 模式; When sendEvent; Then 优先二进制编码; fallback JSON
```

**S19.2** DataChannel 通道 `remoteControlManager.ts:641-686`
```gherkin
Given WebRTC 模式; When sendEvent; Then mousemove 立即; 其他入队; 每 10ms flushEventQueue
```

**S19.3** HTTP 回退 `remoteControlManager.ts:794-831`
```gherkin
Given WS/DC 不可用; When sendEvent; Then POST /api/control/event; mousemove 节流 16ms
```

**S19.4** 二进制协议 `remoteControlManager.ts:691-789` · `stream_server.py:314-399`
```gherkin
鼠标: 13字节 [type:1][x:2][y:2][btn:1][ts:4][rsv:3]
滚轮: 17字节 [type:1][x:2][y:2][dY:4][dX:4][ts:4]
键盘: 可变 [type:1][keyCode:2][mod:1][ts:4][key:N]
```

---

<a id="m20"></a>
### M20 — IME 输入助手弹窗

**S20.1** 打开 `headerPopups.ts:171-182`
```gherkin
When 点击 IME 按钮; Then 显示 #imePopup; 50ms 后聚焦 #imeInput; 关闭其他弹窗
```

**S20.2** 关闭 `headerPopups.ts:171-182`
```gherkin
When 再次点击; Then 隐藏 #imePopup
```

**S20.3** 发送文本 `headerActions.ts:298-317`
```gherkin
Given 弹窗打开, 控制启用, 输入"你好"; When 点击发送; Then sendEvent(keydown); 清空输入
```

**S20.4** 清空 `headerActions.ts:291-296`
```gherkin
When 点击清空; Then 清空 #imeInput; 计数归零; 隐藏弹窗
```

**S20.5** 字符计数 `streamCore.ts:1171-1174`
```gherkin
Given 弹窗打开; When 输入文本; Then 实时更新字符计数
```

---

<a id="m21"></a>
### M21 — WebRTC 连接

**S21.1-21.4** 同 V1 的 M19（WebRTC Offer/Answer、ontrack、DataChannel、连接后初始化），行号一致。

---

<a id="m22"></a>
### M22 — MJPEG 连接

**S22.1-22.4** 同 V1 的 M20（WebSocket 建立、模式切换、MJPEG 帧接收、控制消息分发），行号一致。

---

<a id="m23"></a>
### M23 — Scrcpy (H.264) 连接

**S23.1** H.264 初始化 `streamPlayerManager.ts:63-81` (GitNexus: switchMode → destroyCurrentPlayer → initH264Player)
```gherkin
Given 选择 Scrcpy; When WS onopen; Then switchMode("h264") → 自动选 WebCodecs > MSE
```

**S23.2** 接收 InitData `streamCore.ts:877-896` (GitNexus: handleH264Message → unpackMessage → receiveInitData)
```gherkin
When 收到 binary(magic=0xABCDEF00, type=0x02); Then unpack → streamPlayerManager.receiveInitData
```

**S23.3** 接收帧 `streamCore.ts:877-896`
```gherkin
When 收到 VIDEO_FRAME(type=0x01); Then unpack h264Data/pts/isKeyframe → receiveFrame; recordFrame
```

---

<a id="m24"></a>
### M24 — 传输模式切换

**S24.1-24.3** 同 V1 的 M22（切换流程、Scrcpy 模式、模式不变跳过），行号一致。

---

<a id="m25"></a>
### M25 — 断开连接

**S25.1-25.2** 同 V1 的 M23（主动断开、资源清理），行号一致。
(GitNexus: installHeaderActionsModule → destroyCurrentPlayer, toggleControl, stopUiRefresh)

---

<a id="m26"></a>
### M26 — 释放实例

**S26.1-26.3** 同 V1 的 M24（确认释放、取消、失败），行号一致。

---

<a id="m27"></a>
### M27 — 视频适配 (videoFit) (**V2 新增**)

**S27.1** 自动缩放 `videoFit.ts:33-95`
```gherkin
Given 视频画面显示中
When 容器或视频分辨率变化
Then recalc() 计算宽高比; 应用 object-fit:contain; 居中显示; 正确处理黑边
```

**S27.2** 窗口 resize `videoFit.ts:97-100`
```gherkin
Given 视频显示中
When 浏览器窗口大小变化
Then scheduleRecalc() 延迟重算; 使用 rAF 避免频繁触发
```

**S27.3** 多元素支持 `videoFit.ts:23-31` (GitNexus: getMediaAR)
```gherkin
Given 不同传输模式
When getMediaAR() 计算; Then 支持 VIDEO/IMG/CANVAS 三种元素的宽高比获取
```

---

<a id="m28"></a>
### M28 — 设置弹窗开关

**S28.1-28.3** 同 V1 的 M26（打开、关闭、点击外部关闭），行号一致。

---

<a id="m29"></a>
### M29 — 设置选项卡切换 (**V2 新增**)

**S29.1** 切换到画质 `headerPopups.ts:114-120`
```gherkin
Given 设置弹窗打开; When 点击"画质"tab; Then 显示 #settingsTabQuality; 隐藏 AI tab
```

**S29.2** 切换到 AI `headerPopups.ts:114-120`
```gherkin
When 点击"AI"tab; Then 显示 #settingsTabAi; 隐藏画质 tab; 同步引擎状态
```

---

<a id="m30"></a>
### M30 — 画质设置

**S30.1-30.4** 同 V1 的 M27，行号一致。

---

<a id="m31"></a>
### M31 — AI 引擎设置

**S31.1-31.4** 同 V1 的 M28，行号一致。
(GitNexus: syncSettingsAiTab → normalizeAiEngineState → readAiEngine)

---

<a id="m32"></a>
### M32 — 分离模式设置

**S32.1-32.3** 同 V1 的 M29，行号一致。

---

<a id="m33"></a>
### M33 — 全屏模式

**S33.1-33.2** 同 V1 的 M25，行号一致。
(GitNexus: handleFullscreenChange:686 被 initStreamCore 引用)

---

<a id="m34"></a>
### M34 — 日志面板-视图切换
**S34.1-34.2** 同 V1 的 M30。

---

<a id="m35"></a>
### M35 — 日志面板-筛选
**S35.1-35.2** 同 V1 的 M31。

---

<a id="m36"></a>
### M36 — 日志面板-搜索
**S36.1-36.2** 同 V1 的 M32。

---

<a id="m37"></a>
### M37 — 日志面板-自动滚动
**S37.1-37.2** 同 V1 的 M33。

---

<a id="m38"></a>
### M38 — 日志面板-清空/导出
**S38.1-38.3** 同 V1 的 M34。

---

<a id="m39"></a>
### M39 — Dock 面板-拖拽调整
**S39.1-39.3** 同 V1 的 M35。(GitNexus: installDockLayoutModule → applyDockWidth → getDockWidthLimits)

---

<a id="m40"></a>
### M40 — Dock 面板-折叠/展开
**S40.1-40.2** 同 V1 的 M36。

---

<a id="m41"></a>
### M41 — 浮动面板
**S41.1-41.4** 同 V1 的 M37。(GitNexus: onPointerUp → toggleDock → openDock/closeDock → repositionPanel)

---

<a id="m42"></a>
### M42 — 工具栏折叠/展开

**S42.1** 折叠 `aiCore.ts:6086-6216`
```gherkin
Given 工具栏展开; When 上拉 Pull Rope; Then Matter.js 物理动画; 工具栏折叠; 视频区扩大
  物理参数: gravity=0.4, stiffness=0.95, damping=0.12, 6节点+锚点
```

**S42.2** 展开 `aiCore.ts:6086-6216`
```gherkin
Given 工具栏折叠; When 下拉 Pull Rope; Then 物理动画; 工具栏展开; 视频区恢复
  拉绳交互: mouseenter → pullDown(160,3), idle tug 每 4-7s
```

---

<a id="m43"></a>
### M43 — 对话区拖拽调整高度 (**V2 新增**)

**S43.1** 拖拽调整 `aiCore.ts:5889-6050`
```gherkin
Given AI 面板对话区可见
When 用户拖拽 #aiConvoDragHandle
Then 实时调整 #aiConvoWrap 高度; 钳制在 [collapsed, maxH] 范围
  And 淡出效果: 距离 ≤ 0 → 隐藏历史; 0~60px → 渐变透明度; >60px → 完全显示
```

**S43.2** 点击切换 `aiCore.ts:5964-6000`
```gherkin
Given 未拖拽(移动 < 4px)
When 点击 drag handle
Then 切换 maximize/collapse 状态; 不改变高度值
```

**S43.3** 折叠阈值 `aiCore.ts:5964-6000`
```gherkin
Given 拖拽中
When 释放时高度 ≤ collapsed+15px
Then 自动折叠(移除 expanded class); 否则保持展开
```

---

<a id="m44"></a>
### M44 — Detach 分离窗口 (**V2 新增**)

**S44.1** 分离到独立窗口 `aiCore.ts:5548-5635`
```gherkin
Given AI 面板嵌入主窗口
When 用户点击分离按钮
Then 优先使用 documentPictureInPicture.requestWindow()
  回退: window.open() 计算窗口尺寸
  And 复制样式表到新窗口(copyStylesToWindow)
  And 移动面板 DOM 到新窗口
  And patchDocLookups() 劫持 getElementById/querySelector 跨窗口查找
  And proxyWindowFunctionsToPopup() 代理 ai*/toggle*/switch* 等函数
```

**S44.2** 附着回主窗口 `aiCore.ts:5637-5670`
```gherkin
Given 面板已分离
When 用户点击附着按钮 或 关闭弹窗
Then unpatchDocLookups() 恢复原始方法
  And 将面板 DOM 移回原位(placeholder)
  And 移除 ctl-panel-detached class
  And 关闭弹出窗口
```

**S44.3** 弹窗关闭自动附着 `aiCore.ts:5548-5635`
```gherkin
Given 面板在弹出窗口中
When 弹出窗口被关闭(beforeunload/pagehide)
Then 自动执行 doAttach()
```

**S44.4** 交互委托 `aiCore.ts:5447-5482`
```gherkin
Given 面板在弹出窗口中
When 用户点击弹窗中的按钮(复制/保存/执行等)
Then installPopupInteractionDelegation 拦截并委托到主窗口函数
```

---

<a id="m45"></a>
### M45 — AI 对话-发送消息
**S45.1-45.4** 同 V1 的 M38。

---

<a id="m46"></a>
### M46 — AI 对话-SSE 流式处理
**S46.1-46.7** 同 V1 的 M39。详见 [[FLOW_STATE_MACHINE#AI对话-执行流]]。

---

<a id="m47"></a>
### M47 — AI 对话-停止生成
**S47.1-47.2** 同 V1 的 M40。

---

<a id="m48"></a>
### M48 — AI 对话-浮框操作
**S48.1-48.4** 同 V1 的 M41。

---

<a id="m49"></a>
### M49 — 步骤新增

**S49.1** 手动新建 `aiCore.ts:2288-2321`
```gherkin
When 点击"+"按钮; Then aiCreateStepAfter → 新空步骤(action:"click"); 打开编辑器; 更新插入点
```

**S49.2** 新建子步骤 `aiCore.ts:2343-2361`
```gherkin
Given 有 IF 逻辑步骤; When 在 IF 块内点击"+"; Then aiOpenNewChildStepEditor(parentId, afterIdx)
```

**S49.3** 单个加入 `aiCore.ts:2419-2427`
```gherkin
When 点击步骤"加入"按钮; Then insertStepAtPoint → recomputeAllLogicGroupIds → renderScriptSteps
```

**S49.4** 批量加入 `aiCore.ts:2430-2460`
```gherkin
When 点击"全部加入"; Then 过滤非可执行步骤; 按序插入; 仅滚动最后一个到视图
```

---

<a id="m50"></a>
### M50 — 步骤删除

> **交互约束矩阵**：`aiRemoveStep`（aiCore.ts:2463-2555）调用链涉及 1 个前置守卫、1 个校验函数（3 个分支）、3 条执行路径、4 个状态副作用、2 个后置动作。共产出 **12 个 Scenario**。
>
> | 调用层 | 函数 | 源码行 | 产出 Scenario |
> |--------|------|--------|--------------|
> | 前置守卫 | `_regenerating` 检查 | 2465-2468 | S50.1 |
> | 校验 | `validateDeleteStep` → `getSiblings` → `getLogicGroupIndices` | 546-598, 285-294, 374-383 | S50.2~S50.5 |
> | 路径A | 级联删除（ok=false 确认后） | 2472-2506 | S50.6~S50.7 |
> | 路径B | 逻辑/循环步骤连带子步骤删除（ok=true） | 2509-2520 | S50.8 |
> | 路径C | 普通步骤直接删除 | 2526 | S50.9 |
> | 副作用 | `insertAfterIndex` 修正 | 2522-2537 | S50.10 |
> | 副作用 | `hoverInsertAfterIndex` + `selectedStepIndices` 重编号 | 2543-2552 | S50.11 |
> | 后置 | `recomputeAllLogicGroupIds` + `renderScriptSteps` | 332-369, 2553-2554 | S50.12 |

#### 前置守卫

**S50.1** 重新生成中不可删除 `aiCore.ts:2465-2468`
```gherkin
Given 步骤 #3 正在重新生成中（_regenerating = true）
When 用户点击步骤 #3 的删除按钮
Then 显示 Toast 警告"该步骤正在重新生成中，请稍后再试"
  And 步骤列表不变
```

#### 逻辑校验：validateDeleteStep 分支

**S50.2** 非逻辑步骤 → 直接放行 `aiCore.ts:546-552`
```gherkin
Given 步骤 #3 是 click 动作（stepType ≠ "logic"）
When validateDeleteStep(3) 执行
Then 返回 { ok: true }
  And 不触发任何确认弹窗
```

**S50.3** IF 头部有后续跟随 → 拦截 `aiCore.ts:566-587`
```gherkin
Given 脚本为 [#1 IF, #2 ELSE_IF, #3 ELSE]，三者共享 logicGroupId
When validateDeleteStep(0) 执行
Then isGroupStart = true（logicType === "if"）
  And hasFollowers = true（next.logicType === "else_if"）
  And 返回 {
    ok: false,
    reason: "删除此 IF 将导致后续逻辑步骤（ELSE_IF→ELSE）失去起始 IF",
    groupIndices: [0, 1, 2],
    cascadeWarning: "建议删除整个逻辑组"
  }
```

**S50.4** 中间 ELSE_IF → 可安全删除 `aiCore.ts:589-593`
```gherkin
Given 脚本为 [#1 IF, #2 ELSE_IF, #3 ELSE_IF, #4 ELSE]
When validateDeleteStep(2)（删除第二个 ELSE_IF）
Then isGroupMiddle = true（非头非尾）
  And 返回 { ok: true, groupIndices: [0,1,2,3] }
  And 删除后 #3 ELSE_IF 自动接上 #1 IF → #2 ELSE_IF 链
```

**S50.5** 尾部 ELSE 或孤立 IF → 可安全删除 `aiCore.ts:596-597`
```gherkin
Given 脚本为 [#1 IF, #2 ELSE]
When validateDeleteStep(1)（删除 ELSE）
Then isGroupEnd = true（logicType === "else"）
  And 返回 { ok: true }
  And IF 成为孤立 IF，仍合法
```

#### 路径 A：级联删除流（validateDeleteStep 返回 ok=false）

**S50.6** 级联删除 — 确认弹窗与递归收集 `aiCore.ts:2472-2506`
```gherkin
Given validateDeleteStep 返回 ok=false, groupIndices=[0,1,2]
  And #1 IF 下有子步骤 [#1a click, #1b input]（parentId === IF.id）
  And #2 ELSE_IF 下有子步骤 [#2a scroll]
When 弹出确认对话框：
  标题 = "删除此 IF 将导致后续逻辑步骤（ELSE_IF→ELSE）失去起始 IF"
  正文 = "逻辑组：#1 IF → #2 ELSE_IF → #3 ELSE\n建议删除整个逻辑组"
  按钮 = ["删除整个逻辑组"(danger), "取消"]
  And 用户点击"删除整个逻辑组"
Then 收集删除集 = {0, 1, 2}（groupIndices）
  And 递归追加子步骤：遍历 scriptSteps 中 parentId 匹配的 → 追加 {1a, 1b, 2a}
  And 按索引倒序 splice 逐个移除（避免索引偏移）
  And 共删除 6 个步骤
```

**S50.7** 级联删除 — 用户取消 `aiCore.ts:2480-2481`
```gherkin
Given validateDeleteStep 返回 ok=false
When 弹出确认对话框
  And 用户点击"取消"
Then 步骤列表不变
  And 不触发 recomputeAllLogicGroupIds
```

#### 路径 B：逻辑/循环步骤连带删除（validateDeleteStep 返回 ok=true）

**S50.8** 删除可安全删除的逻辑步骤 + 其子步骤 `aiCore.ts:2509-2520`
```gherkin
Given 脚本为 [#1 click, #2 ELSE（尾部，可安全删除）, #2a hover（parentId=#2.id）, #3 input]
  And validateDeleteStep(1) 返回 ok=true
When 执行删除
Then 先倒序收集子步骤：找到 #2a（parentId === #2.id）→ splice(2)
  And 再 splice(1) 删除 #2 本体
  And removeCount = 2
  And 结果 = [#1 click, #3 input]
```

#### 路径 C：普通步骤直接删除

**S50.9** 删除普通动作步骤 `aiCore.ts:2526`
```gherkin
Given 脚本为 [#1 navigate, #2 click, #3 input]
  And 步骤 #2 是普通动作步骤
When 删除 #2
Then splice(1, 1)
  And 结果 = [#1 navigate, #3 input]
```

#### 状态副作用

**S50.10** insertAfterIndex 修正 `aiCore.ts:2522-2537`
```gherkin
# 场景 a：删除位置在固定插入点之前
Given insertAfterIndex = 4; When 删除 idx=2
Then insertAfterIndex = 3（前移 1 位）

# 场景 b：删除的正好是固定插入点
Given insertAfterIndex = 2, 共 5 步; When 删除 idx=2
Then insertAfterIndex = max(0, 2-1) = 1（回退到前一个）

# 场景 c：删除后列表为空
Given insertAfterIndex = 0, 共 1 步; When 删除 idx=0
Then insertAfterIndex = -1（无步骤可固定）

# 场景 d：级联删除后状态全部重置
Given 级联删除整个逻辑组
Then insertAfterIndex = -1
  And activeGapParentId = null
  And activeGapExplicit = false
  And hoverInsertAfterIndex = -1
  And hoverGapParentId = null
  And selectedStepIndices.clear()
```

**S50.11** hoverInsertAfterIndex + selectedStepIndices 重编号 `aiCore.ts:2543-2552`
```gherkin
Given hoverInsertAfterIndex = 3; selectedStepIndices = {1, 3, 5}
When 删除 idx=2
Then hoverInsertAfterIndex = 2（3→2，前移）
  And selectedStepIndices = {1, 2, 4}（< idx 不变；> idx 减 1；=== idx 丢弃）

Given hoverInsertAfterIndex = 2
When 删除 idx=2
Then hoverInsertAfterIndex = -1; hoverGapParentId = null（正好命中则重置）
```

#### 后置动作

**S50.12** 逻辑组 ID 重算与渲染 `aiCore.ts:332-369, 2553-2554`
```gherkin
Given 删除完成后（任何路径）
When recomputeAllLogicGroupIds() 执行
Then 按 parentId 分组所有步骤
  And 对每组扫描连续逻辑链：if 开头 → 分配新 groupId → else_if/else 共享
  And 非逻辑步骤打断链：清除前方 currentGroupId
  And 孤立的 else_if/else（前方无 if）：delete logicGroupId
When renderScriptSteps() 执行
Then 重新渲染步骤列表（含嵌套树线更新）
```

---

<a id="m51"></a>
### M51 — 步骤移动排序

**S51.1** 上移 `aiCore.ts:2594-2662`
```gherkin
Given 步骤非首位; When 上移; Then 模拟→validateMoveResult→交换→recompute→重渲染
```

**S51.2** 下移 `aiCore.ts:2594-2662`
```gherkin
Given 步骤非末位; When 下移; Then 同上
```

**S51.3** 逻辑链完整性校验 `aiCore.ts:2562-2591`
```gherkin
Given IF→ELSE_IF→ELSE; When 尝试将 ELSE 移到 IF 之前; Then validateMoveResult 返回 ok=false
```

---

<a id="m52"></a>
### M52 — 步骤拖拽排序 (**V2 大幅扩展**)

**S52.1** 拖拽预览 `aiCore.ts:1205-1259`
```gherkin
Given 步骤列表有步骤
When 用户开始拖拽某步骤
Then buildDragPreview 克隆 DOM 元素; 浮动跟随鼠标; 更新深度缩进
```

**S52.2** 拖拽指示线 `aiCore.ts:1302-1314`
```gherkin
Given 拖拽中
When 鼠标移到步骤间隙
Then positionDragIndicator 显示插入指示线; 有效位置为蓝色; 无效位置为红色
```

**S52.3** IF 整组拖拽 `aiCore.ts:1161-1192`
```gherkin
Given IF→ELSE_IF→ELSE 逻辑组 + 子步骤
When 拖拽 IF 步骤
Then collectDragIndices 收集整个逻辑组 + 所有子步骤作为一个拖拽单元
```

**S52.4** 禁止自嵌套 `aiCore.ts:1351-1415`
```gherkin
Given 拖拽逻辑步骤
When 尝试拖入自己的子步骤区域
Then validateDropPosition → false; 指示线显示无效
```

**S52.5** 执行 Drop `aiCore.ts:1450-1542`
```gherkin
Given 拖拽到有效位置
When 释放鼠标
Then executeDrop: 模拟重排→validateMoveResult→更新 scriptSteps→remap 索引→recompute→重渲染
```

---

<a id="m53"></a>
### M53 — 步骤选择/复制/清空
**S53.1-53.3** 同 V1 的 M45。

---

<a id="m54"></a>
### M54 — 步骤折叠/高亮
**S54.1-54.3** 同 V1 的 M46。

---

<a id="m55"></a>
### M55 — 逻辑组生命周期 (**V2 新增独立域**)

**S55.1** 逻辑组自动创建 `aiCore.ts:332-369`
```gherkin
Given 用户创建 IF 步骤后跟 ELSE_IF
When recomputeAllLogicGroupIds() 执行
Then 自动分配相同 logicGroupId; 算法: 遇 IF 新建 groupId; 连续 else_if/else 继承
```

**S55.2** 逻辑组边界检测 `aiCore.ts:301-325`
```gherkin
Given 逻辑组 IF→ELSE_IF→ELSE
When findLogicGroupBounds(siblings, pos) 执行
Then 返回 { start, end } 包含组的所有成员索引; 向前找 IF 头; 向后找到非逻辑或新 IF
```

**S55.3** 获取同组所有步骤 `aiCore.ts:374-383`
```gherkin
Given 步骤属于某逻辑组
When getLogicGroupIndices(stepIdx); Then 返回所有同 logicGroupId 的步骤索引
```

**S55.4** 获取同级步骤 `aiCore.ts:285-294`
```gherkin
Given 嵌套步骤结构
When getSiblings(parentId); Then 返回同一 parentId 下的所有步骤(按索引排序)
```

---

<a id="m56"></a>
### M56 — 逻辑链校验引擎 (**V2 新增独立域**)

**S56.1** 位置合法性校验 `aiCore.ts:393-458`
```gherkin
Given 用户尝试在某位置插入逻辑步骤
When validateLogicTypeAtPosition(afterIdx, parentId, editIdx)
Then 返回 { if: {ok,reason,warn?}, else_if: {ok,reason}, else: {ok,reason} }
  规则:
  - IF: 始终允许; 若后续有 else_if/else → 警告"会吸收到新组"
  - ELSE_IF: 前驱必须是 if/else_if; 否则 ok=false
  - ELSE: 前驱必须是 if/else_if; 同组不能已有 ELSE; 否则 ok=false
```

**S56.2** 非逻辑插入校验 `aiCore.ts:464-496`
```gherkin
Given 用户在逻辑链中间插入普通步骤
When validateNonLogicInsertAt(afterIdx, parentId)
Then 若 prev=(if/else_if) AND next=(else_if/else) 且同组 → ok=false("会打断逻辑链")
  And 返回 affectedGroupIndices 用于 UI 高亮
```

**S56.3** 逻辑→动作类型变更校验 `aiCore.ts:503-539`
```gherkin
Given 用户编辑逻辑步骤，尝试改为动作类型
When validateTypeChangeFromLogic(idx)
Then 若后续有 else_if/else 属于本组 → ok=false("会孤立后续逻辑步骤")
```

**S56.4** 删除保护校验 `aiCore.ts:546-598`
```gherkin
Given 逻辑步骤
When validateDeleteStep(idx)
Then IF 头+有后续者 → ok=false(级联风险); 中间 ELSE_IF → ok=true; ELSE/尾部 → ok=true
  And 总是返回 groupIndices(UI 反馈用)
```

**S56.5** 移动结果校验 `aiCore.ts:2562-2591`
```gherkin
Given 步骤移动/拖拽后的模拟数组
When validateMoveResult(simSteps)
Then 按 parentId 分组; 检查每个 else_if/else 前驱是否为 if/else_if; 不允许非逻辑打断链
```

---

<a id="m57"></a>
### M57 — 逻辑感知拖拽约束 (**V2 新增独立域**)

**S57.1** IF 整组拖拽 `aiCore.ts:1161-1192`
```gherkin
Given IF→ELSE_IF→ELSE 带子步骤
When 拖拽 IF; Then collectDragIndices 收集: 整个逻辑组的所有成员 + 递归所有子步骤
  非 IF 的逻辑步骤: 仅收集自身 + 子步骤(不含整组)
```

**S57.2** 拖拽位置校验 `aiCore.ts:1351-1415`
```gherkin
Given 拖拽中
When computeInsertInfo 确定目标位置
Then validateDropPosition: 1) 排除自嵌套 2) 模拟重排 3) validateMoveResult 校验逻辑完整性
```

**S57.3** parentId 更新 `aiCore.ts:1194-1204`
```gherkin
Given 拖拽到新的父容器
When executeDrop 执行
Then applyParentIdToMovedRoots: 更新所有根步骤的 parentId 为新父级
```

---

<a id="m58"></a>
### M58 — 嵌套渲染与树线 (**V2 新增独立域**)

**S58.1** 递归渲染 `aiCore.ts:967-1053`
```gherkin
Given 有嵌套步骤(IF 包含子步骤)
When renderStepAndChildren(step, idx) 执行
Then 递归渲染: 步骤卡片 → 子步骤间隙 → 每个子步骤(递归) → 逻辑组标记
```

**S58.2** 树线绘制 `aiCore.ts:946-964`
```gherkin
Given 深度 > 0 的嵌套步骤
When buildTreeLinesHTML(step, idx)
Then 从步骤 parentId 向上遍历到根; 每层添加 ai-tree-vline; 最后一个子步骤用 └ 样式
  位置: right: 4 + depth*10 px
```

**S58.3** 折叠渲染 `aiCore.ts:967-1053`
```gherkin
Given IF 步骤的 id 在 collapsedLogicIds 中
When renderStepAndChildren
Then 不渲染子步骤和间隙; 折叠图标方向切换; showPanel=false
```

---

<a id="m59"></a>
### M59 — 编辑器打开/关闭
**S59.1-59.3** 同 V1 的 M47。

---

<a id="m60"></a>
### M60 — 动作类型切换
**S60.1-60.4** 同 V1 的 M48。

---

<a id="m61"></a>
### M61 — 逻辑步骤编辑
**S61.1-61.5** 同 V1 的 M49。

---

<a id="m62"></a>
### M62 — 保存校验
**S62.1-62.4** 同 V1 的 M50。详见 [[FLOW_STATE_MACHINE#步骤编辑器校验流]]。

---

<a id="m63"></a>
### M63 — 定位器管理 (**V2 新增**)

**S63.1** 定位器选项卡 `aiCore.ts:2828-2863`
```gherkin
Given 步骤编辑器打开, 步骤有多个定位器
When 渲染; Then 显示定位器选项卡: XPath, CSS, 文本, 图像, 坐标, AI 定位
  And 按优先级排序(_getLocatorOrder)
```

**S63.2** 启用/禁用定位器 `aiCore.ts:3080-3083`
```gherkin
Given 定位器面板; When 用户切换某定位器的启用开关; Then toggleLocatorEnabled(key); UI 更新
```

**S63.3** 定位器面板内容 `aiCore.ts:2864-3080`
```gherkin
Given 不同定位器类型
When 显示面板
Then XPath: 显示值+xpath信息; CSS: 显示选择器; 文本: 显示 text+source+matchIndex;
  图像: 显示截图预览; 坐标: 显示 xPercent/yPercent; AI: 显示启用状态
```

---

<a id="m64"></a>
### M64 — 单步执行
**S64.1-64.4** 同 V1 的 M51。

---

<a id="m65"></a>
### M65 — 全部执行/从此执行
**S65.1-65.4** 同 V1 的 M52。

---

<a id="m66"></a>
### M66 — 步骤重新生成
**S66.1-66.3** 同 V1 的 M53。

---

<a id="m67"></a>
### M67 — OCR 重试 (**V2 新增**)

**S67.1** 手动重试 VLM OCR `aiCore.ts:2151-2196`
```gherkin
Given 步骤有截图; When 用户点击 OCR 重试
Then POST 3100/api/vlm-ocr/start → 轮询 /result/{taskId} → 更新 locators.textContent(source:"vlm")
```

**S67.2** 重试不影响其他定位器 `aiCore.ts:2151-2196`
```gherkin
Given 步骤有多个定位器; When OCR 重试完成; Then 仅更新 textContent; 其他定位器不变
```

---

<a id="m68"></a>
### M68 — 脚本保存
**S68.1-68.3** 同 V1 的 M54。

---

<a id="m69"></a>
### M69 — 脚本加载
**S69.1-69.3** 同 V1 的 M55。

---

<a id="m70"></a>
### M70 — 脚本重命名 (**V2 新增**)

**S70.1** 重命名 `server.py:972-983`
```gherkin
Given 已保存脚本面板; When 用户重命名脚本; Then POST /api/ai/scripts/{id}/rename { name }; 列表刷新
```

**S70.2** 重命名失败 `server.py:972-983`
```gherkin
When 后端返回错误; Then 显示错误提示; 名称不变
```

---

<a id="m71"></a>
### M71 — 脚本删除
**S71.1-71.2** 同 V1 的 M56。

---

<a id="m72"></a>
### M72 — 脚本导出
**S72.1-72.2** 同 V1 的 M57。

---

<a id="m73"></a>
### M73 — 录制开始/停止
**S73.1-73.4** 同 V1 的 M58。

---

<a id="m74"></a>
### M74 — 录制步骤转换
**S74.1-74.3** 同 V1 的 M59。详见 [[FLOW_STATE_MACHINE#录制流]]。

---

<a id="m75"></a>
### M75 — 录制 Enrichment
**S75.1-75.4** 同 V1 的 M60。

---

<a id="m76"></a>
### M76 — FPS/带宽统计
**S76.1-76.3** 同 V1 的 M61。

---

<a id="m77"></a>
### M77 — 传输/捕获模式轮询
**S77.1-77.2** 同 V1 的 M62。

---

<a id="m78"></a>
### M78 — 设置 localStorage 持久化

**S78.1** AI 引擎 `localStorage["ai_engine"]`
**S78.2** AI 模型 `localStorage["ai_model"]`, `localStorage["maiui_model"]`
**S78.3** Dock 状态 `localStorage["ctl_dock_open"]`, `localStorage["ctl_dock_w"]`
**S78.4** 浮动面板 `localStorage["floating_dock_x"]`, `localStorage["floating_dock_y"]`

```gherkin
Given 用户更改设置; When 设置变更; Then 写入 localStorage
Given 用户刷新页面; When 初始化; Then 从 localStorage 恢复
```

---

## V1 → V2 对照表

| V2 新增/扩展模块 | V1 缺失原因 | 发现来源 |
|----------------|-----------|---------|
| M02 可访问性 | ACCEPTANCE_MATRIX 有 SHELL-002/003，V1 遗漏 | 验收矩阵对照 |
| M10 标签页自动切换 | TAB-005 场景，V1 未单独拆分 | 验收矩阵对照 |
| M27 videoFit | V1 完全遗漏 | **GitNexus 索引发现** |
| M29 设置选项卡切换 | SET-002 场景，V1 合并到 M26 | 验收矩阵对照 |
| M43 对话拖拽调整 | V1 完全遗漏 | Agent 深度读取 aiCore.ts |
| M44 Detach 分离窗口 | V1 完全遗漏(300行代码) | Agent 深度读取 aiCore.ts |
| M52 步骤拖拽(5 Scenario) | V1 无此模块(700行代码) | Agent 深度读取 aiCore.ts |
| M55 逻辑组生命周期 | V1 压缩到编辑器子场景 | **Agent 发现 + GitNexus 无法索引** |
| M56 逻辑链校验引擎(5个) | V1 仅 1 个 Scenario | Agent 发现 9 个校验函数 |
| M57 逻辑感知拖拽约束 | V1 完全遗漏 | Agent 读取拖拽系统 |
| M58 嵌套渲染与树线 | V1 完全遗漏 | Agent 读取渲染系统 |
| M63 定位器管理 | AI-009 场景，V1 遗漏 | 验收矩阵对照 |
| M67 OCR 重试 | AI-010 场景，V1 遗漏 | 验收矩阵对照 |
| M70 脚本重命名 | SCRIPT-003，V1 遗漏 | 验收矩阵 + **GitNexus 后端索引** |

---

## 数据结构参考

同 V1，补充：

### 逻辑步骤额外字段
```typescript
{
  stepType: 'logic' | 'loop'    // 步骤类型
  logicType: 'if' | 'else_if' | 'else'  // 仅 stepType='logic'
  logicGroupId: string          // 同组 if/else_if/else 共享
  parentId: string              // 嵌套父步骤 ID
  conditions?: Array<{          // IF/ELSE_IF 的条件列表
    type: string                // 条件类型
    connector: 'AND' | 'OR'     // 条件连接器
    // ... 条件具体字段
  }>
}
```

### 拖拽状态
```typescript
{
  _dragSrcIdx: number           // 拖拽源步骤索引
  _dragSrcIndices: number[]     // 所有被拖拽的索引（含子树和逻辑组）
  _dragInsertInfo: {
    afterIdx: number            // 插入位置
    parentId: string | null     // 目标父级
    valid: boolean              // 位置是否合法
  } | null
}
```
