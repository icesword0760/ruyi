---
title: Controller 页面 BDD 风格产品需求文档
date: 2026-03-10
tags: [prd, bdd, controller, webrtc]
aliases: [PRD, BDD需求文档, Controller PRD]
---

# Controller 页面 BDD 风格产品需求文档

> 本文档按产品视角将 Controller 页面拆分为 65 个原子模块，每个模块的交互行为以 BDD（Given-When-Then）风格严格描述，所有 Scenario 标注对应源码文件及行号。
>
> 关联文档：[[FLOW_STATE_MACHINE]] · [[TEST_CASES]] · [[ACCEPTANCE_CHECKLIST]]

---

## 目录索引

| # | 模块 | Scenario 数 | 关键源码 |
|---|------|------------|---------|
| 1 | [页面加载与初始化](#m01) | 4 | App.tsx, streamCore.ts |
| 2 | [连接状态机](#m02) | 5 | streamCore.ts:778-821 |
| 3 | [URL导航](#m03) | 5 | urlEdit.ts:36-86 |
| 4 | [后退/前进/刷新](#m04) | 4 | navigationActions.ts:25-59 |
| 5 | [标签页列表展示](#m05) | 3 | tabs.ts:31-87 |
| 6 | [标签页新建](#m06) | 2 | headerActions.ts:267-289 |
| 7 | [标签页切换](#m07) | 2 | tabs.ts:89-102 |
| 8 | [标签页关闭](#m08) | 3 | tabs.ts:104-122 |
| 9 | [远程控制开关](#m09) | 3 | headerActions.ts:65-82 |
| 10 | [鼠标单击/双击/右键](#m10) | 5 | remoteControlManager.ts:308-348 |
| 11 | [鼠标移动与拖拽](#m11) | 4 | remoteControlManager.ts:194-305 |
| 12 | [滚轮操作](#m12) | 2 | remoteControlManager.ts:351-365 |
| 13 | [键盘输入](#m13) | 3 | remoteControlManager.ts:379-500 |
| 14 | [IME中文组合输入](#m14) | 3 | remoteControlManager.ts:526-570 |
| 15 | [剪贴板粘贴](#m15) | 3 | remoteControlManager.ts:581-629 |
| 16 | [坐标校准](#m16) | 3 | remoteControlManager.ts:56-182 |
| 17 | [事件传输通道](#m17) | 4 | remoteControlManager.ts:642-832 |
| 18 | [IME输入助手弹窗](#m18) | 5 | headerPopups.ts:171-182 |
| 19 | [WebRTC连接](#m19) | 4 | streamCore.ts:742-850 |
| 20 | [MJPEG连接](#m20) | 4 | streamCore.ts:974-1161 |
| 21 | [Scrcpy(H.264)连接](#m21) | 3 | streamCore.ts, streamPlayerManager.ts |
| 22 | [传输模式切换](#m22) | 3 | headerActions.ts:214-265 |
| 23 | [断开连接](#m23) | 2 | headerActions.ts:88-156 |
| 24 | [释放实例](#m24) | 3 | headerActions.ts:158-204 |
| 25 | [全屏模式](#m25) | 2 | headerActions.ts:84-86 |
| 26 | [设置弹窗开关](#m26) | 3 | headerPopups.ts:103-112 |
| 27 | [画质设置](#m27) | 4 | headerActions.ts:206-212 |
| 28 | [AI引擎设置](#m28) | 4 | headerPopups.ts:122-169 |
| 29 | [分离模式设置](#m29) | 3 | headerPopups.ts:152-162 |
| 30 | [日志面板-视图切换](#m30) | 2 | logPanel.ts:64-72 |
| 31 | [日志面板-筛选](#m31) | 2 | logPanel.ts:74-78 |
| 32 | [日志面板-搜索](#m32) | 2 | logPanel.ts:80-83 |
| 33 | [日志面板-自动滚动](#m33) | 2 | ControllerLayout.tsx:425 |
| 34 | [日志面板-清空/导出](#m34) | 3 | ControllerLayout.tsx:428-431 |
| 35 | [Dock面板-拖拽调整](#m35) | 3 | dockLayout.ts:111-131 |
| 36 | [Dock面板-折叠/展开](#m36) | 2 | dockLayout.ts:63-75 |
| 37 | [浮动面板](#m37) | 4 | floatingDock.ts:147-177 |
| 38 | [AI对话-发送消息](#m38) | 4 | aiCore.ts:4330-4570 |
| 39 | [AI对话-SSE流式处理](#m39) | 7 | aiCore.ts:4575-4704 |
| 40 | [AI对话-停止生成](#m40) | 2 | aiCore.ts:4317-4323 |
| 41 | [AI对话-浮框操作](#m41) | 4 | aiCore.ts:5013-5074 |
| 42 | [脚本步骤-新增](#m42) | 4 | aiCore.ts:2288-2449 |
| 43 | [脚本步骤-删除](#m43) | 3 | aiCore.ts:2494-2555 |
| 44 | [脚本步骤-移动排序](#m44) | 2 | aiCore.ts:2594-2613 |
| 45 | [脚本步骤-选择/复制](#m45) | 3 | aiCore.ts:2663-2814 |
| 46 | [脚本步骤-折叠/高亮](#m46) | 3 | aiCore.ts:2262-2285 |
| 47 | [步骤编辑器-打开/关闭](#m47) | 3 | aiCore.ts:3087-3700 |
| 48 | [步骤编辑器-动作类型](#m48) | 4 | aiCore.ts:3249-3279 |
| 49 | [步骤编辑器-逻辑步骤](#m49) | 5 | aiCore.ts:3327-3420 |
| 50 | [步骤编辑器-保存校验](#m50) | 4 | aiCore.ts:3496-3690 |
| 51 | [单步执行](#m51) | 4 | aiCore.ts:3753-3812 |
| 52 | [全部执行/从此执行](#m52) | 4 | aiCore.ts:3815-3950 |
| 53 | [步骤重新生成](#m53) | 3 | aiCore.ts:3998-4045 |
| 54 | [脚本保存](#m54) | 3 | aiCore.ts:5728-5775 |
| 55 | [脚本加载](#m55) | 3 | aiCore.ts:5818-5839 |
| 56 | [脚本删除](#m56) | 2 | aiCore.ts:5841-5855 |
| 57 | [脚本导出](#m57) | 2 | aiCore.ts:5857-5876 |
| 58 | [录制-开始/停止](#m58) | 4 | aiCore.ts:2111-2137 |
| 59 | [录制-步骤转换](#m59) | 3 | aiCore.ts:1858-1971 |
| 60 | [录制-Enrichment](#m60) | 4 | aiCore.ts:1977-2095 |
| 61 | [统计轮询(FPS/带宽)](#m61) | 3 | streamCore.ts:111-208 |
| 62 | [传输/捕获模式轮询](#m62) | 2 | streamCore.ts:506-562 |
| 63 | [More菜单操作](#m63) | 5 | ControllerLayout.tsx:327-371 |
| 64 | [设置持久化](#m64) | 4 | 各模块 localStorage |
| 65 | [工具栏折叠/展开](#m65) | 2 | ControllerLayout.tsx:199-201 |

**合计：~211 Scenario**

---

## 模块 BDD 描述

---

<a id="m01"></a>
### M01 — 页面加载与初始化

**Feature:** 页面加载与初始化
> 用户首次访问 /controller 路由时，系统完成所有模块初始化，展示占位界面，并自动发起默认连接。

**Scenario 1.1:** 页面加载展示占位符
`ControllerLayout.tsx:108-148` · `streamCore.ts:67-75`

```gherkin
Given 用户访问 /controller 路由
When 页面完成 React 渲染
Then 显示占位符 #placeholder（含 aurora 动画和打字机提示）
  And 连接按钮 #connectBtn 可点击
  And 状态文本显示 "未连接"
  And FPS 和带宽显示 "-"
```

**Scenario 1.2:** 模块安装初始化
`streamCore.ts:67-75` · 各 install*Module()

```gherkin
Given 页面 DOM 就绪
When initStreamCore() 执行
Then 依次安装以下模块：
  | 模块 | 函数 |
  | headerActions | installHeaderActionsModule() |
  | headerPopups | installHeaderPopupsModule() |
  | navigationActions | installNavigationActionsModule() |
  | tabs | installTabsModule() |
  | urlEdit | installUrlEditModule() |
  | logPanel | installLogPanelModule() |
  | dockLayout | installDockLayoutModule() |
  | floatingDock | installFloatingDockModule() |
  And window.__controllerNewAppInitialized 设为 true
```

**Scenario 1.3:** AI Core 初始化
`aiCore.ts:6028-6043`

```gherkin
Given initStreamCore() 已完成
When initAiCore() 执行
Then DOM 引用缓存完成（chatMessages, chatInput, sendBtn, scriptSteps 等）
  And 恢复 localStorage 中的 AI 模型选择
  And 恢复分离模式状态
  And 渲染空的脚本步骤列表
  And 加载已保存脚本列表
```

**Scenario 1.4:** 自动连接（非 E2E 模式）
`streamCore.ts` 初始化尾部

```gherkin
Given 页面初始化完成
  And window.__controllerE2E 未设置
When 自动连接逻辑触发
Then 以 MJPEG 模式发起连接
  And 应用默认分辨率 1080p
```

---

<a id="m02"></a>
### M02 — 连接状态机

**Feature:** 连接状态机
> 系统维护 5 种连接状态，状态间转换由 ICE/PeerConnection 事件驱动。详见 [[FLOW_STATE_MACHINE#连接状态机]]。

**Scenario 2.1:** 初始断开状态
`controllerStore.ts:32-39`

```gherkin
Given 页面刚加载完成
Then 状态为 Disconnected
  And store.connected = false
  And store.statusText = "未连接"
  And #placeholder 可见
  And #connectBtn 启用, #disconnectBtn 禁用
```

**Scenario 2.2:** 进入连接中状态
`streamCore.ts:742-750`

```gherkin
Given 当前状态为 Disconnected
When 用户点击连接按钮
Then 状态转为 Connecting
  And #connectBtn 禁用
  And 状态文本更新为 "正在连接..."
```

**Scenario 2.3:** 连接成功
`streamCore.ts:804-821`

```gherkin
Given 当前状态为 Connecting
When pc.onconnectionstatechange 触发 "connected"
Then 状态转为 Connected
  And isConnected = true
  And #disconnectBtn 启用
  And 启动所有轮询（status/tabs/transport/capture）
  And store.setConnected(true)
```

**Scenario 2.4:** 连接降级
`streamCore.ts:778-802`

```gherkin
Given 当前状态为 Connected
When pc.oniceconnectionstatechange 触发 "disconnected"
Then 状态转为 Degraded
  And 状态文本显示 "连接中断，正在重连..."
  And 2 秒后自动触发 reconnect()
```

**Scenario 2.5:** 连接失败
`streamCore.ts:778-802`

```gherkin
Given 当前状态为 Connecting 或 Connected
When pc.oniceconnectionstatechange 触发 "failed"
Then 状态转为 Error
  And 状态文本显示连接失败信息
  And 显示 #reconnectBtn 供手动重连
```

---

<a id="m03"></a>
### M03 — URL 导航

**Feature:** URL 导航
> 用户可点击编辑当前 URL 并提交导航请求。

**Scenario 3.1:** 点击进入编辑模式
`urlEdit.ts:44-54`

```gherkin
Given 连接状态为 Connected
  And 当前 URL 显示为 "https://example.com"
When 用户点击 URL 标签
Then URL 标签隐藏，输入框显示
  And 输入框预填当前 URL
  And 输入框获取焦点并全选文本
```

**Scenario 3.2:** 提交导航
`urlEdit.ts:56-78`

```gherkin
Given URL 输入框处于编辑模式
  And 用户输入 "baidu.com"
When 用户按下 Enter 键
Then 输入框隐藏，URL 标签恢复显示
  And URL 自动补全为 "https://baidu.com"（normalizeUrl）
  And POST /api/session/navigate { url: "https://baidu.com" }
  And 成功后更新 URL 标签为返回的 url
  And 触发 refreshStatus()
```

**Scenario 3.3:** 取消编辑
`urlEdit.ts:80-86`

```gherkin
Given URL 输入框处于编辑模式
When 用户按下 Escape 或输入框失焦
Then 输入框隐藏，URL 标签恢复原始值
  And 不发送任何请求
```

**Scenario 3.4:** URL 自动补全协议
`urlEdit.ts:18-28`

```gherkin
Given 用户提交 URL 导航
When URL 缺少协议前缀
Then 系统按以下规则补全：
  | 输入 | 补全结果 |
  | example.com | https://example.com |
  | //example.com | https://example.com |
  | http://example.com | http://example.com（不变） |
```

**Scenario 3.5:** 导航失败处理
`urlEdit.ts:56-78`

```gherkin
Given 用户提交了 URL 导航
When 后端返回错误
Then 控制台记录错误信息
  And URL 标签恢复显示
```

---

<a id="m04"></a>
### M04 — 后退/前进/刷新

**Feature:** 浏览器导航操作
> 用户可通过导航按钮执行后退、前进和刷新操作。

**Scenario 4.1:** 后退
`navigationActions.ts:25-35`

```gherkin
Given 连接状态为 Connected
When 用户点击后退按钮
Then POST /api/session/back
  And 成功后更新 URL 显示为返回的 res.url
```

**Scenario 4.2:** 前进
`navigationActions.ts:37-47`

```gherkin
Given 连接状态为 Connected
When 用户点击前进按钮
Then POST /api/session/forward
  And 成功后更新 URL 显示为返回的 res.url
```

**Scenario 4.3:** 刷新
`navigationActions.ts:49-59`

```gherkin
Given 连接状态为 Connected
When 用户点击刷新按钮
Then POST /api/session/reload
  And 成功后触发 refreshStatus()
```

**Scenario 4.4:** 导航操作失败
`navigationActions.ts:25-59`

```gherkin
Given 连接状态为 Connected
When 任一导航操作返回错误
Then 显示 toast 或 alert 提示错误信息
```

---

<a id="m05"></a>
### M05 — 标签页列表展示

**Feature:** 标签页列表
> 连接后自动拉取标签页列表，3 秒轮询刷新。

**Scenario 5.1:** 连接后加载标签页
`tabs.ts:31-53`

```gherkin
Given 连接状态刚变为 Connected
When refreshTabs() 触发
Then GET /api/tabs/list
  And 更新 currentTabs 数组和 store.setTabs()
  And 若有标签页 → 显示 #headerTabs，渲染标签页列表
  And 若无标签页 → 隐藏 #headerTabs 和 #tabsBar
```

**Scenario 5.2:** 标签页渲染
`tabs.ts:55-87`

```gherkin
Given currentTabs 包含 3 个标签页
When renderTabs() 执行
Then 为每个标签页渲染一个 div 元素
  And 当前活跃标签页标记 .active 样式
  And 若标签页数 > 1，每个标签页显示关闭按钮
  And 每个标签页可点击以触发 switchToTab()
```

**Scenario 5.3:** 轮询自动刷新
`streamCore.ts:492-503`

```gherkin
Given 连接状态为 Connected
  And 标签页轮询已启动（3 秒间隔）
When 轮询定时器触发
Then 重新执行 refreshTabs()
  And 更新标签页列表（新增/删除/标题变更自动反映）
```

---

<a id="m06"></a>
### M06 — 标签页新建

**Feature:** 新建标签页

**Scenario 6.1:** 用户新建标签页
`headerActions.ts:267-289`

```gherkin
Given 连接状态为 Connected
When 用户点击新建标签页按钮
Then 弹出输入框，提示输入 URL（默认 "https://www.baidu.com"）
  And 用户确认后 POST /api/tabs/create { url }
  And 成功后刷新标签页列表
  And 自动切换到新标签页
```

**Scenario 6.2:** 取消新建
`headerActions.ts:267-289`

```gherkin
Given 新建标签页对话框显示中
When 用户点击取消或关闭对话框
Then 不发送任何请求
  And 标签页列表不变
```

---

<a id="m07"></a>
### M07 — 标签页切换

**Feature:** 切换标签页

**Scenario 7.1:** 切换到目标标签页
`tabs.ts:89-102`

```gherkin
Given 当前有多个标签页
  And 活跃标签页为 Tab-A
When 用户点击 Tab-B
Then POST /api/tabs/switch { targetId: Tab-B.targetId }
  And 更新 activeTabId 为 Tab-B
  And 刷新标签页列表和状态
  And store.setActiveTabId(Tab-B.targetId)
```

**Scenario 7.2:** 切换失败
`tabs.ts:89-102`

```gherkin
Given 用户点击了一个标签页
When 后端返回错误
Then 显示 toast/alert 错误信息
  And 标签页列表保持不变
```

---

<a id="m08"></a>
### M08 — 标签页关闭

**Feature:** 关闭标签页

**Scenario 8.1:** 关闭非最后标签页
`tabs.ts:104-122`

```gherkin
Given 当前有 3 个标签页
When 用户点击某标签页的关闭按钮
Then POST /api/tabs/close { targetId }
  And 成功后刷新标签页列表
```

**Scenario 8.2:** 阻止关闭最后标签页
`tabs.ts:104-122`

```gherkin
Given 当前仅剩 1 个标签页
When 用户点击关闭按钮
Then 显示 toast/alert 警告"不能关闭最后一个标签页"
  And 不发送关闭请求
```

**Scenario 8.3:** 关闭失败
`tabs.ts:104-122`

```gherkin
Given 用户关闭了某标签页
When 后端返回错误
Then 显示 toast/alert 错误信息
  And 标签页列表保持不变
```

---

<a id="m09"></a>
### M09 — 远程控制开关

**Feature:** 远程控制启用/禁用

**Scenario 9.1:** 启用远程控制
`headerActions.ts:65-82`

```gherkin
Given 连接状态为 Connected
  And 远程控制当前禁用
When 用户点击控制开关按钮
Then remoteControl.toggleControl(true) 调用
  And store.setControlEnabled(true)
  And 按钮样式切换为"已启用"（.active）
  And #controlBadge 显示 "ON"
```

**Scenario 9.2:** 禁用远程控制
`headerActions.ts:65-82`

```gherkin
Given 远程控制当前启用
When 用户点击控制开关按钮
Then remoteControl.toggleControl(false) 调用
  And store.setControlEnabled(false)
  And 按钮样式切换为"已禁用"
  And #controlBadge 显示 "OFF"
```

**Scenario 9.3:** 连接断开时自动禁用
`headerActions.ts:88-156`

```gherkin
Given 远程控制当前启用
When 连接断开（disconnect 执行）
Then controlEnabled 设为 false
  And store.setControlEnabled(false)
```

---

<a id="m10"></a>
### M10 — 鼠标单击/双击/右键

**Feature:** 鼠标点击交互
> 用户在视频区域的点击映射为远程浏览器上的对应操作。

**Scenario 10.1:** 单击
`remoteControlManager.ts:308-318`

```gherkin
Given 远程控制已启用
  And 视频画面显示中
When 用户在视频区域单击鼠标左键
Then 计算点击相对坐标（getRelativeCoords）
  And 发送 { type: "click", x, y, button: 0, viewportWidth, viewportHeight }
```

**Scenario 10.2:** 双击
`remoteControlManager.ts:322-332`

```gherkin
Given 远程控制已启用
When 用户在视频区域双击
Then 发送 { type: "dblclick", x, y, button: 0 }
```

**Scenario 10.3:** 右键
`remoteControlManager.ts:336-347`

```gherkin
Given 远程控制已启用
When 用户在视频区域右键点击
Then 阻止浏览器默认右键菜单
  And 发送 { type: "contextmenu", x, y, button: 2 }
```

**Scenario 10.4:** 控制禁用时不响应
`remoteControlManager.ts:308-348`

```gherkin
Given 远程控制未启用（isControlEnabled = false）
When 用户在视频区域点击
Then 不发送任何控制事件
```

**Scenario 10.5:** 点击节流
`remoteControlManager.ts:692-789`

```gherkin
Given 远程控制已启用
When 用户在 50ms 内连续快速点击多次
Then 仅发送第一次点击事件
  And 后续点击在 clickThrottle(50ms) 内被丢弃
  And 最多允许 5 次待处理点击排队
```

---

<a id="m11"></a>
### M11 — 鼠标移动与拖拽

**Feature:** 鼠标移动和拖拽操作

**Scenario 11.1:** 鼠标移动
`remoteControlManager.ts:194-228`

```gherkin
Given 远程控制已启用
When 用户在视频区域移动鼠标
Then 使用 requestAnimationFrame 节流（~60fps）
  And 发送 { type: "mousemove", x, y }
```

**Scenario 11.2:** 拖拽开始
`remoteControlManager.ts:232-251`

```gherkin
Given 远程控制已启用
When 用户在视频区域按下鼠标按钮
Then 设置 isDragging = true
  And 记录 dragStartCoords
  And 发送 { type: "mousedown", x, y, button }
```

**Scenario 11.3:** 拖拽移动
`remoteControlManager.ts:194-228`

```gherkin
Given 正在拖拽中（isDragging = true）
When 鼠标移动
Then 立即发送 mousemove 事件（不使用 rAF 节流）
  And 携带 button 信息
```

**Scenario 11.4:** 拖拽结束与鼠标离开
`remoteControlManager.ts:255-304`

```gherkin
Given 正在拖拽中
When 用户释放鼠标按钮
  And 移动距离 > 5px
Then 发送 { type: "mouseup", x, y, button }
  And 重置 isDragging = false

Given 正在拖拽中
When 鼠标离开视频区域
Then 自动发送 mouseup 事件以清理拖拽状态
```

---

<a id="m12"></a>
### M12 — 滚轮操作

**Feature:** 滚轮滚动

**Scenario 12.1:** 垂直滚动
`remoteControlManager.ts:351-364`

```gherkin
Given 远程控制已启用
When 用户在视频区域滚动鼠标滚轮
Then 阻止默认页面滚动
  And 发送 { type: "wheel", x, y, deltaX, deltaY, deltaZ }
```

**Scenario 12.2:** 水平滚动
`remoteControlManager.ts:351-364`

```gherkin
Given 远程控制已启用
When 用户使用 Shift+滚轮 或触控板水平滚动
Then 发送 { type: "wheel", x, y, deltaX: <非零>, deltaY }
```

---

<a id="m13"></a>
### M13 — 键盘输入

**Feature:** 键盘事件转发

**Scenario 13.1:** 普通按键
`remoteControlManager.ts:379-446`

```gherkin
Given 远程控制已启用
  And 焦点不在本地输入框中
When 用户按下键盘按键（如 "a"）
Then 阻止默认行为
  And 发送 { type: "keydown", key: "a", code: "KeyA", keyCode, modifiers }
When 用户释放按键
Then 发送 { type: "keyup", key: "a", code: "KeyA" }
```

**Scenario 13.2:** 修饰键组合
`remoteControlManager.ts:379-446`

```gherkin
Given 远程控制已启用
When 用户按下 Ctrl+C
Then 发送 keydown 事件并带 ctrlKey: true
  And 不触发本地复制行为
```

**Scenario 13.3:** 粘贴快捷键特殊处理
`remoteControlManager.ts:379-446`

```gherkin
Given 远程控制已启用
When 用户按下 Ctrl+V
Then 不阻止默认行为（让 paste 事件正常触发）
  And 由 paste handler 处理文本发送
```

---

<a id="m14"></a>
### M14 — IME 中文组合输入

**Feature:** IME 中文输入法组合输入

**Scenario 14.1:** 组合开始
`remoteControlManager.ts:526-536`

```gherkin
Given 远程控制已启用
When 输入法开始组合（compositionstart 事件）
Then 设置 isComposing = true
  And 显示 IME 助手弹窗
  And 暂停普通键盘事件转发
```

**Scenario 14.2:** 组合更新
`remoteControlManager.ts:539-542`

```gherkin
Given IME 组合中（isComposing = true）
When 组合文本更新（compositionupdate 事件）
Then 记录当前组合文本（调试日志）
  And 不发送事件到远程
```

**Scenario 14.3:** 组合结束并发送
`remoteControlManager.ts:545-569`

```gherkin
Given IME 组合中
When 用户确认输入（compositionend 事件）
Then 获取最终确认文本
  And 发送 { type: "keydown", key: <确认文本> }
  And 记录 lastComposedText 和 lastComposedTime
  And 设置 isComposing = false
  And 恢复普通键盘事件转发
```

---

<a id="m15"></a>
### M15 — 剪贴板粘贴

**Feature:** 剪贴板粘贴转发

**Scenario 15.1:** 短文本粘贴（≤100 字符）
`remoteControlManager.ts:581-629`

```gherkin
Given 远程控制已启用
When 用户粘贴文本且长度 ≤ 100 字符
Then 阻止默认粘贴
  And 逐字符发送 keydown 事件
```

**Scenario 15.2:** 长文本粘贴（>100 字符）
`remoteControlManager.ts:581-629`

```gherkin
Given 远程控制已启用
When 用户粘贴文本且长度 > 100 字符
Then 阻止默认粘贴
  And 作为单个 keydown 事件发送完整文本
```

**Scenario 15.3:** 粘贴数据源
`remoteControlManager.ts:581-629`

```gherkin
Given 用户触发粘贴事件
When clipboardData 可用
Then 从 event.clipboardData 读取文本
When clipboardData 不可用
Then 回退到 navigator.clipboard.readText()
```

---

<a id="m16"></a>
### M16 — 坐标校准

**Feature:** 视频画面坐标校准
> 将鼠标在页面上的位置精确映射为远程浏览器的视口坐标。详见 [[FLOW_STATE_MACHINE#远程控制事件流]]。

**Scenario 16.1:** 视频元素坐标计算
`remoteControlManager.ts:56-182`

```gherkin
Given 远程视频元素 <video> 渲染中
When 需要计算相对坐标
Then 获取视频 videoWidth/videoHeight 作为实际分辨率
  And 获取元素 getBoundingClientRect 作为渲染尺寸
  And 计算宽高比缩放因子
  And 返回 { x, y, viewportWidth, viewportHeight }
```

**Scenario 16.2:** MJPEG 图片坐标计算
`remoteControlManager.ts:56-182`

```gherkin
Given 远程画面通过 <img> 元素显示
When 需要计算相对坐标
Then 优先使用 window.backendResolution
  And 回退到 img.naturalWidth/naturalHeight
  And 考虑 object-fit:contain 下的黑边偏移
  And 钳制坐标到画面有效区域内
```

**Scenario 16.3:** Canvas 坐标计算
`remoteControlManager.ts:56-182`

```gherkin
Given 远程画面通过 <canvas> 元素显示（H.264 WebCodecs 模式）
When 需要计算相对坐标
Then 使用 canvas.width/canvas.height 属性作为实际分辨率
  And 按比例缩放到渲染尺寸
```

---

<a id="m17"></a>
### M17 — 事件传输通道

**Feature:** 控制事件传输通道选择
> 根据当前传输模式自动选择最优通道。详见 [[FLOW_STATE_MACHINE#远程控制事件流]]。

**Scenario 17.1:** WebSocket 通道（MJPEG/Scrcpy 模式）
`remoteControlManager.ts:692-789`

```gherkin
Given 当前为 MJPEG 或 Scrcpy 传输模式
  And mjpegWebSocket 连接正常
When 发送控制事件
Then 优先使用二进制编码（MJPEGEventEncoder）
  And 回退到 JSON 格式 { type: "control", event, timestamp }
  And mousemove 节流 16ms，click 节流 50ms
```

**Scenario 17.2:** DataChannel 通道（WebRTC 模式）
`remoteControlManager.ts:642-687`

```gherkin
Given 当前为 WebRTC 传输模式
  And DataChannel 已打开
When 发送控制事件
Then mousemove 立即发送（二进制或 JSON）
  And 其他事件进入事件队列
  And 每 10ms 批量刷新队列（flushEventQueue）
```

**Scenario 17.3:** HTTP API 回退通道
`remoteControlManager.ts:795-831`

```gherkin
Given WebSocket 和 DataChannel 均不可用
  And useHttpApi = true
When 发送控制事件
Then POST /api/control/event { ...event }
  And mousemove 节流 16ms
```

**Scenario 17.4:** 二进制协议编码
`remoteControlManager.ts:692-789`

```gherkin
Given 使用 WebSocket 通道发送事件
When 编码控制事件
Then 鼠标事件编码为 13 字节：[type:1][x:2][y:2][button:1][timestamp:4][reserved:3]
  And 滚轮事件编码为 17 字节：[type:1][x:2][y:2][deltaY:4][deltaX:4][timestamp:4]
  And 键盘事件编码为可变长度：[type:1][keyCode:2][modifiers:1][timestamp:4][key:N]
```

---

<a id="m18"></a>
### M18 — IME 输入助手弹窗

**Feature:** IME 中文输入助手弹窗

**Scenario 18.1:** 打开弹窗
`headerPopups.ts:171-182`

```gherkin
Given 连接状态为 Connected
When 用户点击 IME 按钮
Then 显示 #imePopup（添加 .show 类）
  And 50ms 后自动聚焦 #imeInput
  And 关闭其他弹窗（设置弹窗、脚本面板）
```

**Scenario 18.2:** 关闭弹窗
`headerPopups.ts:171-182`

```gherkin
Given IME 弹窗已打开
When 用户再次点击 IME 按钮
Then 隐藏 #imePopup（移除 .show 类）
```

**Scenario 18.3:** 输入并发送文本
`headerActions.ts:298-317`

```gherkin
Given IME 弹窗已打开
  And 远程控制已启用
When 用户在 #imeInput 中输入文本并点击发送
Then 读取 #imeInput 的文本值
  And 通过 remoteControl.sendEvent() 发送 keydown 事件
  And 清空 #imeInput
  And 更新字符计数
```

**Scenario 18.4:** 清空输入
`headerActions.ts:291-296`

```gherkin
Given IME 弹窗已打开且有输入文本
When 用户点击清空按钮
Then 清空 #imeInput 值
  And 字符计数归零
  And 隐藏弹窗
```

**Scenario 18.5:** 字符计数更新
`streamCore.ts:1171-1174`

```gherkin
Given IME 弹窗已打开
When 用户输入文本
Then 实时更新字符计数显示
```

---

<a id="m19"></a>
### M19 — WebRTC 连接

**Feature:** WebRTC 视频连接
> 详见 [[FLOW_STATE_MACHINE#连接状态机]]。

**Scenario 19.1:** 创建 Offer 并协商
`streamCore.ts:742-834`

```gherkin
Given 用户触发 WebRTC 连接
When connect() 执行
Then 创建 RTCPeerConnection（含 ICE 服务器配置）
  And 添加 video transceiver（direction: "recvonly"）
  And 创建 SDP Offer → 设置 localDescription
  And 等待 ICE gathering 完成
  And POST /api/webrtc/offer { sdp, type } → 获取 Answer
  And 设置 remoteDescription
```

**Scenario 19.2:** 接收视频轨道
`streamCore.ts:756-775`

```gherkin
Given WebRTC 协商完成
When pc.ontrack 触发
Then 将远程流绑定到 #remoteVideo
  And 隐藏 #placeholder 和 MJPEG 图片
  And 监听 loadedmetadata 以获取视频分辨率
  And 启动 captureModePolling
```

**Scenario 19.3:** DataChannel 建立
`streamCore.ts:823-828`

```gherkin
Given WebRTC 连接成功
When DataChannel "control" 创建（ordered: true, maxRetransmits: 1）
Then onopen → 初始化远程控制（initializeRemoteControl）
  And onclose → 禁用远程控制
```

**Scenario 19.4:** 连接后初始化
`streamCore.ts:836-843`

```gherkin
Given WebRTC 连接成功（onconnectionstatechange: "connected"）
When 连接后设置执行
Then refreshStatus() → 同步当前页面 URL
  And refreshTabs() → 加载标签页
  And applySettings() → 下发画质设置
  And startTransportModePolling()
  And syncBackendResolution()
```

---

<a id="m20"></a>
### M20 — MJPEG 连接

**Feature:** MJPEG 流连接

**Scenario 20.1:** WebSocket 建立
`streamCore.ts:974-986`

```gherkin
Given 用户触发 MJPEG 连接
When connectMJPEG() 执行
Then 创建 WebSocket 连接到 ws://{hostname}:5567
```

**Scenario 20.2:** 连接成功与模式切换
`streamCore.ts:986-1083`

```gherkin
Given WebSocket onopen 触发
When 初始化处理执行
Then 发送 { type: "switch_mode", mode: "mjpeg" }
  And 切换 StreamPlayerManager 到 MJPEG 模式
  And 初始化远程控制（使用 WebSocket）
  And 启动所有轮询
  And 启动 streamStats.startUiRefresh()
```

**Scenario 20.3:** 接收 MJPEG 帧
`streamCore.ts:1085-1147`

```gherkin
Given MJPEG 连接正常
When 收到二进制消息（非 H.264 magic number）
Then 创建 Blob 对象
  And streamPlayerManager.receiveMJPEGFrame(blob) 显示帧
  And streamStats.recordFrame() 记录统计
```

**Scenario 20.4:** 接收控制消息
`streamCore.ts:1085-1147`

```gherkin
Given MJPEG 连接正常
When 收到字符串消息（JSON）
Then 按 type 分发：
  | type | 处理 |
  | TAB_SWITCHED | 更新 activeTabId，刷新分辨率和标签页 |
  | TAB_CREATED | 500ms 后自动切换到新标签页 |
  | mode_switched | 记录日志 |
  | RECORDING_* | 调用 handleRecordingMessage() |
```

---

<a id="m21"></a>
### M21 — Scrcpy (H.264) 连接

**Feature:** Scrcpy H.264 流连接

**Scenario 21.1:** H.264 模式初始化
`streamCore.ts:986-1083` · `streamPlayerManager.ts:64-81`

```gherkin
Given 用户选择 Scrcpy 传输模式
When WebSocket onopen 触发
Then 发送 { type: "switch_mode", mode: "scrcpy" }
  And StreamPlayerManager 切换到 H.264 模式
  And 自动选择 WebCodecs（优先）或 MSE 播放器
```

**Scenario 21.2:** 接收初始化数据（SPS+PPS）
`streamCore.ts:1085-1147`

```gherkin
Given H.264 连接已建立
When 收到二进制消息且 magic number = 0xABCDEF00
  And 消息类型为 INIT_DATA (0x02)
Then 解包 initData
  And streamPlayerManager.receiveInitData(initData)
```

**Scenario 21.3:** 接收视频帧
`streamCore.ts:1085-1147`

```gherkin
Given H.264 播放器已初始化
When 收到 VIDEO_FRAME 消息（类型 0x01）
Then 解包 h264Data, pts, isKeyframe
  And streamPlayerManager.receiveFrame(h264Data, pts, isKeyframe)
  And streamStats.recordFrame() 记录统计
```

---

<a id="m22"></a>
### M22 — 传输模式切换

**Feature:** 运行时切换传输模式

**Scenario 22.1:** 切换传输模式
`headerActions.ts:214-265`

```gherkin
Given 当前使用 WebRTC 模式
When 用户在设置中选择 MJPEG 模式并点击应用
Then 断开当前连接
  And 等待 500ms
  And 以新模式重新连接
  And 日志记录模式切换过程
```

**Scenario 22.2:** 切换到 Scrcpy
`headerActions.ts:214-265`

```gherkin
Given 用户选择 Scrcpy 模式
When switchTransportMode() 执行
Then 调用 connectMJPEG()（Scrcpy 使用同一 WebSocket 通道）
  And 设置 currentTransportMode = "scrcpy"
```

**Scenario 22.3:** 模式不变时跳过
`headerActions.ts:206-212`

```gherkin
Given 用户点击应用设置
When 选择的模式与当前模式相同
Then 仅应用画质设置
  And 不触发重连
```

---

<a id="m23"></a>
### M23 — 断开连接

**Feature:** 断开连接

**Scenario 23.1:** 主动断开
`headerActions.ts:88-156`

```gherkin
Given 连接状态为 Connected
When 用户点击断开按钮
Then 关闭 RTCPeerConnection / MJPEG WebSocket
  And 重置 dataChannel 和 controlEnabled
  And 停止所有轮询
  And 隐藏视频/画面元素，显示 #placeholder
  And 启用 #connectBtn，禁用 #disconnectBtn
  And 更新状态文本为 "已断开"
  And store.setControlEnabled(false)
```

**Scenario 23.2:** 资源清理
`headerActions.ts:88-156`

```gherkin
Given disconnect() 执行中
When 清理资源
Then 释放以下资源：
  | 资源 | 操作 |
  | PeerConnection | pc.close() |
  | DataChannel | 设为 null |
  | MJPEG WebSocket | socket.close() |
  | StreamPlayerManager | cleanup |
  | 所有轮询定时器 | stop*Polling() |
  | 视频/图片/Canvas | 隐藏 |
```

---

<a id="m24"></a>
### M24 — 释放实例

**Feature:** 释放浏览器实例

**Scenario 24.1:** 确认释放
`headerActions.ts:158-204`

```gherkin
Given 连接状态为 Connected
When 用户点击释放实例按钮
Then 显示确认对话框
When 用户确认
Then 清理 StreamPlayerManager
  And 执行 disconnect()
  And POST /api/session/reset
  And 吊销 BLOB URL
  And 刷新状态
```

**Scenario 24.2:** 取消释放
`headerActions.ts:158-204`

```gherkin
Given 释放确认对话框显示中
When 用户取消
Then 不执行任何操作
```

**Scenario 24.3:** 释放失败
`headerActions.ts:158-204`

```gherkin
Given 用户确认释放
When 后端返回错误
Then 显示 toast/alert 错误信息
  And 连接状态已断开（disconnect 已先执行）
```

---

<a id="m25"></a>
### M25 — 全屏模式

**Feature:** 全屏切换

**Scenario 25.1:** 进入全屏
`headerActions.ts:84-86` · `streamCore.ts:667-685`

```gherkin
Given 页面当前为非全屏状态
When 用户点击全屏按钮
Then 调用 requestFullscreen()（含多浏览器 API 兼容）
  And 视频画面铺满屏幕
```

**Scenario 25.2:** 退出全屏
`streamCore.ts:667-698`

```gherkin
Given 页面当前为全屏状态
When 用户按 Escape 或再次点击全屏按钮
Then 调用 exitFullscreen()
  And 触发 syncBackendResolution() 重新同步分辨率
```

---

<a id="m26"></a>
### M26 — 设置弹窗开关

**Feature:** 设置弹窗

**Scenario 26.1:** 打开设置弹窗
`headerPopups.ts:103-112`

```gherkin
Given 设置弹窗当前关闭
When 用户点击设置按钮
Then 显示 #settingsPopup（添加 .show 类）
  And 同步 AI 引擎设置状态（syncSettingsAiTab）
  And 关闭其他弹窗（IME 弹窗、脚本面板）
```

**Scenario 26.2:** 关闭设置弹窗
`headerPopups.ts:103-112`

```gherkin
Given 设置弹窗当前打开
When 用户再次点击设置按钮
Then 隐藏 #settingsPopup（移除 .show 类）
```

**Scenario 26.3:** 点击外部关闭
`headerPopups.ts:79-95`

```gherkin
Given 设置弹窗当前打开
When 用户点击弹窗外部区域
Then 隐藏 #settingsPopup
```

---

<a id="m27"></a>
### M27 — 画质设置

**Feature:** 画质参数设置

**Scenario 27.1:** 调整 FPS
`streamCore.ts:605-634` · `ControllerLayout.tsx:209-250`

```gherkin
Given 设置弹窗 → 画质选项卡
When 用户修改 FPS 值
  And 点击应用设置
Then POST /api/session/settings { fps, quality, resolution, encoding_mode }
```

**Scenario 27.2:** 调整画质
`streamCore.ts:605-634`

```gherkin
Given 设置弹窗 → 画质选项卡
When 用户修改画质值并应用
Then 后端更新编码器参数
  And 日志记录设置变更
```

**Scenario 27.3:** 调整分辨率
`streamCore.ts:605-634`

```gherkin
Given 设置弹窗 → 画质选项卡
When 用户选择新分辨率并应用
Then 后端调整视口大小
  And syncBackendResolution() 同步前端坐标映射
```

**Scenario 27.4:** 传输模式变更触发重连
`headerActions.ts:206-212`

```gherkin
Given 用户在设置中修改了传输模式
When 点击应用
Then 应用画质设置
  And 检测到传输模式不同 → 触发 switchTransportMode()
```

---

<a id="m28"></a>
### M28 — AI 引擎设置

**Feature:** AI 引擎选择与配置

**Scenario 28.1:** 切换到 Midscene 引擎
`headerPopups.ts:122-126`

```gherkin
Given 设置弹窗 → AI 选项卡
When 用户选择 Midscene 引擎
Then localStorage["ai_engine"] = "midscene"
  And 显示 Midscene 模型选择器
  And 隐藏 MAI-UI 模型选择器
  And 显示分离模式切换
```

**Scenario 28.2:** 切换到 MAI-UI 引擎
`headerPopups.ts:122-126`

```gherkin
Given 设置弹窗 → AI 选项卡
When 用户选择 MAI-UI 引擎
Then localStorage["ai_engine"] = "mai-ui"
  And 显示 MAI-UI 模型选择器
  And 隐藏 Midscene 模型选择器
  And 隐藏分离模式切换
```

**Scenario 28.3:** 选择 AI 模型
`headerPopups.ts:128-135`

```gherkin
Given Midscene 引擎已选中
When 用户从下拉框选择模型
Then localStorage["ai_model"] = 选择值
  And 同步更新 AI 面板中的模型选择器
```

**Scenario 28.4:** 选择 MAI-UI 模型
`headerPopups.ts:145-150`

```gherkin
Given MAI-UI 引擎已选中
When 用户选择 MAI-UI 模型
Then localStorage["maiui_model"] = 选择值
  And 同步更新设置面板中的选择器
```

---

<a id="m29"></a>
### M29 — 分离模式设置

**Feature:** AI 分离模式（Split Mode）

**Scenario 29.1:** 启用分离模式
`headerPopups.ts:152-162`

```gherkin
Given Midscene 引擎已选中
  And 分离模式当前关闭
When 用户点击分离模式切换
Then #settingsSplitToggle 添加 .active
  And 显示 Planning Model 选择行
  And 同步 #aiSplitModeToggle checked 状态
  And 调用 aiToggleSplitMode(true)
  And localStorage["ai_split_mode"] = "true"
```

**Scenario 29.2:** 禁用分离模式
`headerPopups.ts:152-162`

```gherkin
Given 分离模式当前启用
When 用户点击分离模式切换
Then 移除 .active
  And 隐藏 Planning Model 选择行
  And aiToggleSplitMode(false)
```

**Scenario 29.3:** 非 Midscene 引擎时不可用
`headerPopups.ts:152-162`

```gherkin
Given 当前引擎为 MAI-UI
When 用户尝试切换分离模式
Then 操作被忽略（guard: only if midscene engine）
```

---

<a id="m30"></a>
### M30 — 日志面板-视图切换

**Feature:** 日志视图切换

**Scenario 30.1:** 切换到主日志
`logPanel.ts:64-72`

```gherkin
Given 当前显示调试日志
When 用户点击"主日志"选项卡
Then 显示 #logContent，隐藏 #debugLogContent
  And 应用当前筛选条件
  And 更新选项卡 .active 状态
```

**Scenario 30.2:** 切换到调试日志
`logPanel.ts:64-72`

```gherkin
Given 当前显示主日志
When 用户点击"调试日志"选项卡
Then 显示 #debugLogContent，隐藏 #logContent
  And 应用当前筛选条件
```

---

<a id="m31"></a>
### M31 — 日志面板-筛选

**Feature:** 日志类型筛选

**Scenario 31.1:** 选择筛选类型
`logPanel.ts:74-78`

```gherkin
Given 日志面板显示中
When 用户点击筛选芯片（如 "error"）
Then 仅显示匹配类型的日志条目
  And 更新 .log-filter-chip .active 状态
```

**Scenario 31.2:** 清除筛选
`logPanel.ts:74-78`

```gherkin
Given 当前有筛选条件
When 用户点击"全部"筛选芯片
Then 显示所有日志条目
  And filter 状态重置为 "all"
```

---

<a id="m32"></a>
### M32 — 日志面板-搜索

**Feature:** 日志搜索

**Scenario 32.1:** 输入搜索关键词
`logPanel.ts:80-83`

```gherkin
Given 日志面板显示中
When 用户在搜索框输入关键词
Then 实时过滤日志条目（包含关键词的条目显示，其余隐藏）
  And 搜索不区分大小写
```

**Scenario 32.2:** 清空搜索
`logPanel.ts:80-83`

```gherkin
Given 搜索框有内容
When 用户清空搜索框
Then 恢复显示所有日志条目（仍受类型筛选影响）
```

---

<a id="m33"></a>
### M33 — 日志面板-自动滚动

**Feature:** 日志自动滚动

**Scenario 33.1:** 启用自动滚动
`streamCore.ts:309-318` · `ControllerLayout.tsx:425`

```gherkin
Given 自动滚动当前关闭
When 用户点击自动滚动按钮
Then autoScroll = true
  And 新日志追加时自动滚动到底部
  And 按钮样式切换为激活状态
```

**Scenario 33.2:** 禁用自动滚动
`streamCore.ts:309-318`

```gherkin
Given 自动滚动当前开启
When 用户点击自动滚动按钮
Then autoScroll = false
  And 新日志追加时不自动滚动
```

---

<a id="m34"></a>
### M34 — 日志面板-清空/导出

**Feature:** 日志管理操作

**Scenario 34.1:** 清空日志
`streamCore.ts:276-285` · `ControllerLayout.tsx:428`

```gherkin
Given 日志面板有日志条目
When 用户点击清空按钮
Then 清除 #logContent 和 #debugLogContent 所有子元素
  And 重置 logEntries 数组
```

**Scenario 34.2:** 导出日志
`streamCore.ts:288-305` · `ControllerLayout.tsx:431`

```gherkin
Given 日志面板有日志条目
When 用户点击导出按钮
Then 将所有日志条目拼接为文本
  And 创建 Blob 并触发文件下载
  And 文件名包含时间戳
```

**Scenario 34.3:** 无日志时导出
`streamCore.ts:288-305`

```gherkin
Given 日志面板无日志条目
When 用户点击导出按钮
Then 导出空文件或提示无内容
```

---

<a id="m35"></a>
### M35 — Dock 面板-拖拽调整

**Feature:** Dock 面板宽度调整

**Scenario 35.1:** 拖拽调整宽度
`dockLayout.ts:111-125`

```gherkin
Given Dock 面板已展开
When 用户在分隔条上按下鼠标并拖动
Then 添加 ctl-dock-resizing 类
  And 实时更新 CSS 变量 --ctl-dock-w
  And 宽度钳制在 [min, max] 范围内（min: 260px 或 15%，max: 60%）
```

**Scenario 35.2:** 释放保存宽度
`dockLayout.ts:97-109`

```gherkin
Given 正在拖拽调整宽度
When 用户释放鼠标
Then 移除 ctl-dock-resizing 类
  And 保存最终宽度到 localStorage["ctl_dock_w"]
```

**Scenario 35.3:** 双击重置宽度
`dockLayout.ts:127-131`

```gherkin
Given Dock 面板已展开
When 用户双击分隔条
Then 移除 localStorage 中的保存宽度
  And 重置为默认宽度
```

---

<a id="m36"></a>
### M36 — Dock 面板-折叠/展开

**Feature:** Dock 面板折叠

**Scenario 36.1:** 展开面板
`dockLayout.ts:63-71`

```gherkin
Given Dock 面板当前折叠
When 调用 openDock()
Then dockOpen = true
  And 添加 .ctl-dock-open，移除 .ctl-dock-collapsed
  And 持久化状态到 localStorage
```

**Scenario 36.2:** 折叠面板
`dockLayout.ts:72-75`

```gherkin
Given Dock 面板当前展开
When 调用 closeDock()
Then 添加 .ctl-dock-collapsed，移除 .ctl-dock-open
  And 持久化状态到 localStorage
```

---

<a id="m37"></a>
### M37 — 浮动面板

**Feature:** 浮动 Dock 面板

**Scenario 37.1:** 打开浮动面板
`floatingDock.ts:53-60`

```gherkin
Given 浮动面板当前关闭
When 用户点击触发按钮（无拖拽移动）
Then isOpen = true
  And 添加 .show 类
  And 面板定位在触发按钮附近（居中偏移，视口约束）
```

**Scenario 37.2:** 拖拽移动面板
`floatingDock.ts:99-145`

```gherkin
Given 浮动面板可见
When 用户在触发按钮上按下并拖动（移动 > 4px）
Then 实时更新面板位置
  And 位置钳制到视口边界内
  And 释放时保存位置到 localStorage
```

**Scenario 37.3:** 点击外部关闭
`floatingDock.ts:152-157`

```gherkin
Given 浮动面板已打开
When 用户点击面板外部区域
Then 隐藏面板（移除 .show 类）
  And isOpen = false
```

**Scenario 37.4:** Escape 键关闭
`floatingDock.ts:159-161`

```gherkin
Given 浮动面板已打开
When 用户按下 Escape 键
Then 隐藏面板
```

---

<a id="m38"></a>
### M38 — AI 对话-发送消息

**Feature:** AI 对话消息发送

**Scenario 38.1:** 发送用户消息
`aiCore.ts:4330-4434`

```gherkin
Given AI 面板处于对话模式
  And 输入框有文本
When 用户点击发送按钮或按 Ctrl+Enter
Then 追加用户消息气泡到对话区
  And 清空输入框
  And 显示思考指示器
  And POST /api/ai/run（SSE 流式请求）
    携带 { prompt, model, engine, split_mode, planning_model }
```

**Scenario 38.2:** 空消息不发送
`aiCore.ts:4330-4434`

```gherkin
Given 输入框为空
When 用户点击发送按钮
Then 不发送任何请求
```

**Scenario 38.3:** 发送中禁用输入
`aiCore.ts:4081-4088`

```gherkin
Given AI 正在处理请求
When isProcessing = true
Then 隐藏发送按钮，显示停止按钮
  And 输入框可能被禁用
```

**Scenario 38.4:** 引用步骤到输入框
`aiCore.ts:4305-4312`

```gherkin
Given AI 面板处于对话模式
When 用户点击步骤的引用按钮
Then 将步骤信息格式化后追加到输入框
```

---

<a id="m39"></a>
### M39 — AI 对话-SSE 流式处理

**Feature:** SSE 流式事件处理
> 详见 [[FLOW_STATE_MACHINE#AI对话-执行流]]。

**Scenario 39.1:** thinking 事件
`aiCore.ts:4575-4799`

```gherkin
Given SSE 流已建立
When 收到 thinking 事件
Then 在回复容器中追加思考块
  And 更新回复状态为 "thinking"
```

**Scenario 39.2:** step_start 事件
`aiCore.ts:4575-4799`

```gherkin
Given SSE 流处理中
When 收到 step_start 事件
Then 在回复容器中追加新步骤卡片（状态: executing）
  And 更新 liveSteps 数组
```

**Scenario 39.3:** step_update 事件
`aiCore.ts:4575-4799`

```gherkin
Given SSE 流处理中
  And 已有步骤正在执行
When 收到 step_update 事件
Then 更新对应步骤的状态和详情
  And 可能更新步骤的思考过程展示
```

**Scenario 39.4:** done 事件
`aiCore.ts:4575-4799`

```gherkin
Given SSE 流处理中
When 收到 done 事件
Then 最终化所有 liveSteps（添加"加入脚本"按钮）
  And 更新回复状态为 "done"
  And 显示耗时信息
  And 恢复输入框可用
  And isProcessing = false
```

**Scenario 39.5:** error 事件
`aiCore.ts:4575-4799`

```gherkin
Given SSE 流处理中
When 收到 error 事件
Then 更新回复状态为 "error"
  And 显示错误摘要信息
  And 恢复输入框可用
```

**Scenario 39.6:** 步骤 success 状态
`aiCore.ts:4575-4799`

```gherkin
Given 某步骤正在执行
When step_update 中 status = "success"
Then 步骤卡片图标更新为成功✓
  And 记录步骤执行耗时
```

**Scenario 39.7:** 步骤 error 状态
`aiCore.ts:4575-4799`

```gherkin
Given 某步骤正在执行
When step_update 中 status = "error"
Then 步骤卡片图标更新为失败✗
  And 显示错误详情
```

---

<a id="m40"></a>
### M40 — AI 对话-停止生成

**Feature:** 停止 AI 生成

**Scenario 40.1:** 停止生成
`aiCore.ts:4317-4323`

```gherkin
Given AI 正在生成中（isProcessing = true）
When 用户点击停止按钮
Then 中止当前 fetch 请求（AbortController.abort()）
  And 更新回复状态为 "stopped"
  And isProcessing = false
  And 恢复发送按钮
```

**Scenario 40.2:** 停止后显示已生成步骤
`aiCore.ts:4325-4328`

```gherkin
Given AI 生成已被停止
  And 部分步骤已生成
When 停止完成
Then 显示"全部加入"按钮（针对已生成的步骤）
```

---

<a id="m41"></a>
### M41 — AI 对话-浮框操作

**Feature:** 步骤浮框（Steps Float）

**Scenario 41.1:** 打开浮框
`aiCore.ts:5013`

```gherkin
Given AI 回复中包含生成的步骤
When 浮框触发显示
Then 浮框面板显示
  And 展示步骤列表和操作按钮
```

**Scenario 41.2:** 单个步骤加入脚本
`aiCore.ts:5074-5079`

```gherkin
Given 浮框中有多个步骤
When 用户点击某步骤的"加入"按钮
Then 该步骤加入脚本编辑区
  And 标记该步骤已加入（灰化）
```

**Scenario 41.3:** 全部步骤加入脚本
`aiCore.ts:5073`

```gherkin
Given 浮框中有多个步骤
When 用户点击"全部加入"按钮
Then 所有步骤按顺序加入脚本编辑区
  And 浮框关闭
```

**Scenario 41.4:** 关闭浮框
`aiCore.ts:5013`

```gherkin
Given 浮框已打开
When 用户点击关闭按钮
Then 隐藏浮框
```

---

<a id="m42"></a>
### M42 — 脚本步骤-新增

**Feature:** 新增脚本步骤

**Scenario 42.1:** 在指定位置后新增空步骤
`aiCore.ts:2288-2321`

```gherkin
Given 脚本编辑区有步骤
When 用户点击步骤间的"+"按钮
Then 在该位置后创建新空步骤（默认 action: "click"）
  And 自动打开步骤编辑器
  And 插入点更新为新步骤位置
```

**Scenario 42.2:** 添加单个步骤
`aiCore.ts:2419-2427`

```gherkin
Given AI 生成了步骤
When 用户点击步骤的"加入"按钮
Then 步骤插入到当前插入点
  And 重新计算逻辑组 ID
  And 重新渲染步骤列表
  And 滚动新步骤到视图中
```

**Scenario 42.3:** 批量添加步骤
`aiCore.ts:2430-2460`

```gherkin
Given AI 生成了多个步骤
When 用户点击"全部加入"
Then 自动过滤非可执行步骤（仅保留 EXECUTABLE_ACTIONS 集合中的类型）
  And 按顺序插入所有步骤
  And 仅滚动最后一个步骤到视图中
```

**Scenario 42.4:** 逻辑步骤位置校验
`aiCore.ts:2393-2416`

```gherkin
Given 用户尝试在逻辑链中间插入步骤
When insertStepAtPoint 执行
Then 校验插入位置合法性（validateNonLogicInsertAt）
  And 若不合法则显示 toast 提示
  And 不执行插入
```

---

<a id="m43"></a>
### M43 — 脚本步骤-删除

**Feature:** 删除脚本步骤

**Scenario 43.1:** 删除动作步骤
`aiCore.ts:2463-2555`

```gherkin
Given 脚本编辑区有动作步骤
When 用户从步骤菜单选择"删除"
Then 校验删除合法性（validateDeleteStep）
  And 从 scriptSteps 数组中移除
  And 更新插入点
  And 重新渲染步骤列表
```

**Scenario 43.2:** 删除逻辑步骤（含子步骤）
`aiCore.ts:2463-2555`

```gherkin
Given 脚本有 IF-ELSE 逻辑块
When 用户删除 IF 步骤
Then 收集该逻辑组所有步骤索引（collectAllGroupIndices）
  And 删除 IF 及其所有子步骤
  And 同时删除关联的 ELSE_IF 和 ELSE 步骤
  And 重新计算逻辑组 ID
```

**Scenario 43.3:** 删除受保护的逻辑步骤
`aiCore.ts:546-612`

```gherkin
Given IF 步骤下有 ELSE 步骤
When 用户尝试单独删除 IF 步骤（不删除整组）
Then validateDeleteStep 返回 false
  And 显示 toast 提示无法删除
```

---

<a id="m44"></a>
### M44 — 脚本步骤-移动排序

**Feature:** 步骤上下移动

**Scenario 44.1:** 上移步骤
`aiCore.ts:2594-2662`

```gherkin
Given 脚本有多个步骤
  And 目标步骤不在第一位
When 用户点击上移按钮
Then 模拟移动并校验结果（validateMoveResult）
  And 若合法：交换步骤位置
  And 重新计算逻辑组 ID
  And 重新渲染步骤列表
```

**Scenario 44.2:** 下移步骤
`aiCore.ts:2594-2662`

```gherkin
Given 脚本有多个步骤
  And 目标步骤不在最后位
When 用户点击下移按钮
Then 模拟移动并校验逻辑链完整性
  And 若合法：交换步骤位置
  And 若不合法：显示 toast 提示
```

---

<a id="m45"></a>
### M45 — 脚本步骤-选择/复制

**Feature:** 步骤多选与复制

**Scenario 45.1:** 切换选择
`aiCore.ts:2663-2688`

```gherkin
Given 脚本编辑区有步骤
When 用户点击步骤的选择框
Then 切换该步骤的选中状态（selectedStepIndices Set）
  And 更新步骤卡片的选中样式
```

**Scenario 45.2:** 复制选中步骤
`aiCore.ts:2753-2813`

```gherkin
Given 有步骤被选中
When 用户点击复制按钮
Then 收集所有选中步骤的数据
  And 格式化为 JSON 字符串
  And 写入系统剪贴板
  And 显示成功 toast
```

**Scenario 45.3:** 清空所有步骤
`aiCore.ts:2690-2750`

```gherkin
Given 脚本编辑区有步骤
When 用户点击清空按钮
Then 显示确认对话框
When 用户确认
Then 清空 scriptSteps 数组
  And 重置插入点和选择状态
  And 重新渲染空步骤列表
```

---

<a id="m46"></a>
### M46 — 脚本步骤-折叠/高亮

**Feature:** 逻辑步骤折叠与高亮

**Scenario 46.1:** 折叠逻辑步骤
`aiCore.ts:2277-2285`

```gherkin
Given 脚本有 IF 逻辑步骤（含子步骤）
When 用户点击折叠按钮
Then 该逻辑步骤 ID 加入 collapsedLogicIds Set
  And 子步骤在渲染时隐藏
  And 折叠图标切换方向
```

**Scenario 46.2:** 展开逻辑步骤
`aiCore.ts:2277-2285`

```gherkin
Given 逻辑步骤已折叠
When 用户再次点击折叠按钮
Then 从 collapsedLogicIds 移除
  And 子步骤重新显示
```

**Scenario 46.3:** 高亮逻辑组
`aiCore.ts:2262-2274`

```gherkin
Given 鼠标悬停在逻辑步骤上
When aiHighlightLogicGroup(groupId) 调用
Then 同一 logicGroupId 的所有步骤添加高亮样式
When 鼠标离开
Then 移除所有高亮样式
```

---

<a id="m47"></a>
### M47 — 步骤编辑器-打开/关闭

**Feature:** 步骤编辑器模态框

**Scenario 47.1:** 打开现有步骤编辑器
`aiCore.ts:3087-3247`

```gherkin
Given 脚本有一个 click 步骤
When 用户双击步骤或从菜单选择"编辑"
Then 弹出步骤编辑器模态框
  And 预填当前步骤的所有字段（action, target, value, description）
  And 显示定位器选项卡（XPath, CSS, 文本, 图像, 坐标, AI）
  And 根据步骤类型显示对应面板（action/logic/loop）
```

**Scenario 47.2:** 打开新建步骤编辑器
`aiCore.ts:2324-2340`

```gherkin
Given 用户点击新建步骤
When 编辑器打开
Then 所有字段为空（草稿模式）
  And 动作类型默认为 "click"
  And 保存时创建新步骤
```

**Scenario 47.3:** 关闭编辑器
`aiCore.ts:3694-3701`

```gherkin
Given 步骤编辑器已打开
When 用户点击取消或按 Escape
Then 关闭编辑器模态框
  And 不保存任何修改
  And 若为新建草稿 → 清除 newStepDraft
```

---

<a id="m48"></a>
### M48 — 步骤编辑器-动作类型

**Feature:** 步骤动作类型切换

**Scenario 48.1:** 切换动作类型
`aiCore.ts:3249-3279`

```gherkin
Given 步骤编辑器已打开
When 用户从下拉框选择新动作类型（如从 "click" 改为 "input"）
Then 动态显示/隐藏相关字段：
  | 动作类型 | 显示字段 |
  | click | target |
  | input | target, value |
  | navigate | value (URL) |
  | scroll | target, value (deltaY) |
  | hover | target |
  | wait | value (毫秒) |
  | keypress | value (按键) |
```

**Scenario 48.2:** 切换步骤模式到 action
`aiCore.ts:3282-3324`

```gherkin
Given 步骤编辑器显示逻辑面板
When 用户切换到 action 模式
Then 显示动作类型下拉和字段面板
  And 隐藏逻辑条件面板
```

**Scenario 48.3:** 切换步骤模式到 logic
`aiCore.ts:3282-3324`

```gherkin
Given 步骤编辑器显示动作面板
When 用户切换到 logic 模式
Then 显示逻辑类型选择和条件面板
  And 隐藏动作字段面板
```

**Scenario 48.4:** 类型变更校验
`aiCore.ts:503-544`

```gherkin
Given 正在编辑一个逻辑步骤
When 用户尝试将其改为动作步骤
Then validateTypeChangeFromLogic 校验
  And 若该逻辑步骤有子步骤 → 显示警告并阻止
```

---

<a id="m49"></a>
### M49 — 步骤编辑器-逻辑步骤

**Feature:** 逻辑步骤编辑

**Scenario 49.1:** 选择逻辑类型
`aiCore.ts:3327-3359`

```gherkin
Given 步骤编辑器处于 logic 模式
When 用户选择逻辑类型（IF / ELSE_IF / ELSE）
Then 更新条件面板：
  | 逻辑类型 | 条件面板 |
  | IF | 显示条件编辑面板 |
  | ELSE_IF | 显示条件编辑面板 |
  | ELSE | 隐藏条件面板（无需条件） |
And 校验该位置是否允许选择的逻辑类型
```

**Scenario 49.2:** 添加逻辑条件
`aiCore.ts:3385-3408`

```gherkin
Given 逻辑步骤编辑器显示中（IF 或 ELSE_IF）
When 用户点击"添加条件"并选择连接器（AND / OR）
Then 追加新条件面板
  And 新条件默认为空
  And 更新条件选项卡
```

**Scenario 49.3:** 删除逻辑条件
`aiCore.ts:3420-3435`

```gherkin
Given 逻辑步骤有多个条件
When 用户点击某条件的删除按钮
Then 移除该条件面板
  And 重新编号条件选项卡
  And 若仅剩 1 个条件 → 隐藏删除按钮
```

**Scenario 49.4:** 切换条件选项卡
`aiCore.ts:3410-3418`

```gherkin
Given 逻辑步骤有多个条件
When 用户点击条件选项卡
Then 切换显示对应条件面板
  And 更新选项卡 .active 状态
```

**Scenario 49.5:** 条件类型变更
`aiCore.ts:3361-3367`

```gherkin
Given 条件面板显示中
When 用户更改条件类型
Then 动态显示/隐藏属性字段
```

---

<a id="m50"></a>
### M50 — 步骤编辑器-保存校验

**Feature:** 步骤保存与字段校验

**Scenario 50.1:** 保存动作步骤
`aiCore.ts:3496-3693`

```gherkin
Given 步骤编辑器中填写了完整信息
When 用户点击保存
Then 收集所有字段值
  And 合并定位器数据
  And 更新 scriptSteps[idx]
  And 重新计算逻辑组 ID
  And 关闭编辑器
  And 重新渲染步骤列表
```

**Scenario 50.2:** 保存逻辑步骤
`aiCore.ts:3496-3693`

```gherkin
Given 步骤编辑器处于 logic 模式
When 用户点击保存
Then collectLogicConditions() 收集所有条件
  And 校验逻辑类型在当前位置的合法性
  And 保存 stepType, logicType, conditions 到步骤
```

**Scenario 50.3:** 字段校验失败
`aiCore.ts:3496-3693`

```gherkin
Given 步骤编辑器中必填字段为空
When 用户点击保存
Then 显示校验错误提示
  And 不关闭编辑器
  And 高亮错误字段
```

**Scenario 50.4:** 新建步骤保存
`aiCore.ts:3496-3693`

```gherkin
Given 编辑器处于新建草稿模式（newStepDraft 不为 null）
When 用户保存
Then 在 afterIdx 位置后插入新步骤
  And 清除 newStepDraft
  And 更新插入点
```

---

<a id="m51"></a>
### M51 — 单步执行

**Feature:** 单个步骤执行
> 详见 [[FLOW_STATE_MACHINE#AI对话-执行流]]。

**Scenario 51.1:** 执行单步
`aiCore.ts:3753-3812`

```gherkin
Given 脚本有一个 click 步骤（status: pending）
When 用户点击步骤的"执行"按钮
Then 步骤状态更新为 executing
  And POST /api/ai/execute-step { step, screenshotBase64 }
  And 等待后端返回结果
```

**Scenario 51.2:** 执行成功
`aiCore.ts:3753-3812`

```gherkin
Given 步骤正在执行
When 后端返回成功
Then 步骤状态更新为 success
  And 显示执行耗时
  And 清除错误信息
```

**Scenario 51.3:** 执行失败
`aiCore.ts:3753-3812`

```gherkin
Given 步骤正在执行
When 后端返回错误
Then 步骤状态更新为 error
  And setStepFailure() 设置简化后的错误信息
  And 显示错误详情
```

**Scenario 51.4:** 非可执行步骤
`aiCore.ts:1827-1831`

```gherkin
Given 步骤类型为逻辑步骤（stepType = "logic"）
When isExecutableStep() 校验
Then 返回 false
  And 执行按钮不可用
```

---

<a id="m52"></a>
### M52 — 全部执行/从此执行

**Feature:** 批量步骤执行

**Scenario 52.1:** 全部执行
`aiCore.ts:3815-3907`

```gherkin
Given 脚本有多个步骤
When 用户点击"全部执行"
Then isExecuting = true
  And 按顺序依次执行每个可执行步骤
  And 跳过非可执行步骤（逻辑步骤）
  And currentExecutingIndex 实时更新
  And 执行按钮切换为"停止"
```

**Scenario 52.2:** 从指定步骤开始执行
`aiCore.ts:3910-3995`

```gherkin
Given 脚本有多个步骤
When 用户从步骤菜单选择"从此执行"
Then 从该步骤开始，按顺序执行到最后
  And 跳过之前的步骤
```

**Scenario 52.3:** 停止批量执行
`aiCore.ts:3743-3750`

```gherkin
Given 批量执行进行中
When 用户点击"停止"按钮
Then isExecuting = false
  And 当前步骤执行完成后停止
  And 后续步骤不再执行
```

**Scenario 52.4:** 执行中某步骤失败
`aiCore.ts:3815-3907`

```gherkin
Given 批量执行进行中
When 某步骤执行失败
Then 标记该步骤为 error 状态
  And 继续执行后续步骤（不中断）
```

---

<a id="m53"></a>
### M53 — 步骤重新生成

**Feature:** 重新生成步骤定位信息

**Scenario 53.1:** 触发重新生成
`aiCore.ts:3998-4045`

```gherkin
Given 脚本有一个步骤
When 用户从步骤菜单选择"重新生成"
Then 步骤标记 _regenerating = true
  And POST /api/ai/regenerate-step { step, screenshotBase64 }
```

**Scenario 53.2:** 重新生成成功
`aiCore.ts:3998-4045`

```gherkin
Given 步骤正在重新生成
When 后端返回新的定位信息
Then 更新步骤的 locators 数据
  And 清除 _regenerating 标记
  And 重新渲染步骤卡片
```

**Scenario 53.3:** 重新生成失败
`aiCore.ts:3998-4045`

```gherkin
Given 步骤正在重新生成
When 后端返回错误
Then 设置 _regenError 错误信息
  And 清除 _regenerating 标记
  And 显示错误提示
```

---

<a id="m54"></a>
### M54 — 脚本保存

**Feature:** 保存脚本到后端

**Scenario 54.1:** 保存新脚本
`aiCore.ts:5728-5775`

```gherkin
Given 脚本编辑区有步骤
When 用户点击保存按钮
Then 弹出输入框提示输入脚本名称
  And POST /api/ai/scripts { name, steps: scriptSteps }
  And 成功后刷新已保存脚本列表
  And 显示成功 toast
```

**Scenario 54.2:** 取消保存
`aiCore.ts:5728-5775`

```gherkin
Given 保存名称对话框显示中
When 用户取消
Then 不发送请求
```

**Scenario 54.3:** 保存失败
`aiCore.ts:5728-5775`

```gherkin
Given 用户确认保存
When 后端返回错误
Then 显示错误 toast/alert
```

---

<a id="m55"></a>
### M55 — 脚本加载

**Feature:** 加载已保存脚本

**Scenario 55.1:** 加载脚本
`aiCore.ts:5818-5839`

```gherkin
Given 已保存脚本面板显示中
When 用户点击某脚本的加载按钮
Then GET /api/ai/scripts/{id}
  And 将返回的步骤导入到 scriptSteps
  And 重新渲染步骤列表
```

**Scenario 55.2:** 覆盖当前步骤
`aiCore.ts:5818-5839`

```gherkin
Given 脚本编辑区已有步骤
When 用户加载新脚本
Then 当前步骤被替换为加载的步骤
```

**Scenario 55.3:** 加载失败
`aiCore.ts:5818-5839`

```gherkin
Given 用户点击加载
When 后端返回错误
Then 显示错误信息
  And 当前步骤不变
```

---

<a id="m56"></a>
### M56 — 脚本删除

**Feature:** 删除已保存脚本

**Scenario 56.1:** 确认删除
`aiCore.ts:5841-5855`

```gherkin
Given 已保存脚本面板显示中
When 用户点击某脚本的删除按钮
Then 显示确认对话框
When 用户确认
Then DELETE /api/ai/scripts/{id}
  And 刷新已保存脚本列表
```

**Scenario 56.2:** 取消删除
`aiCore.ts:5841-5855`

```gherkin
Given 删除确认对话框显示中
When 用户取消
Then 不执行删除
```

---

<a id="m57"></a>
### M57 — 脚本导出

**Feature:** 导出脚本为 pytest 文件

**Scenario 57.1:** 导出成功
`aiCore.ts:5857-5876`

```gherkin
Given 已保存脚本面板显示中
When 用户点击某脚本的导出按钮
Then GET /api/ai/scripts/{id}/export
  And 下载生成的 .py 文件
  And 文件包含 webrtc_healing.execute_step 调用
  And 包含 allure 装饰器
```

**Scenario 57.2:** 导出失败
`aiCore.ts:5857-5876`

```gherkin
Given 用户点击导出
When 后端返回错误
Then 显示错误 toast
```

---

<a id="m58"></a>
### M58 — 录制-开始/停止

**Feature:** 用户操作录制
> 详见 [[FLOW_STATE_MACHINE#录制流]]。

**Scenario 58.1:** 开始录制
`aiCore.ts:2111-2137`

```gherkin
Given 连接状态为 Connected
  And 当前未在录制
When 用户点击录制按钮
Then POST /api/recorder/start
  And 设置 isRecording = true
  And 录制按钮切换为停止样式（红色闪烁）
  And 日志记录 "🔴 录制开始"
```

**Scenario 58.2:** 停止录制
`aiCore.ts:2111-2137`

```gherkin
Given 正在录制中
When 用户点击停止录制按钮
Then POST /api/recorder/stop
  And 设置 isRecording = false
  And 录制按钮恢复正常样式
  And 日志记录录制结束
```

**Scenario 58.3:** 录制中接收步骤
`streamCore.ts:906-972`

```gherkin
Given 正在录制中
When WebSocket 收到 NEW_STEP 消息
Then 日志记录新步骤
  And 若 recordToScript 模式启用 → 转换为脚本步骤并加入编辑区
```

**Scenario 58.4:** 按钮状态同步
`aiCore.ts:2097-2109`

```gherkin
Given 录制状态发生变化
When updateRecordToScriptBtn() 调用
Then 同步录制按钮的视觉状态和提示文本
```

---

<a id="m59"></a>
### M59 — 录制-步骤转换

**Feature:** CDP 录制步骤转为脚本步骤
> 详见 [[FLOW_STATE_MACHINE#录制流]]。

**Scenario 59.1:** click 事件转换
`aiCore.ts:1858-1971`

```gherkin
Given 录制收到 CDP click 事件
When recordingStepToScriptStep(step) 执行
Then 生成脚本步骤：
  | 字段 | 映射 |
  | id | 自动生成 |
  | action | "click" |
  | target | step.selectors[0] 或 step.target |
  | coordinates | { x: step.x, y: step.y } |
  | locators.xpath | 从 step.xpathInfo 提取 |
  | locators.cssSelector | 从 step.cssSelector 提取 |
  | status | "pending" |
```

**Scenario 59.2:** input 事件转换
`aiCore.ts:1858-1971`

```gherkin
Given 录制收到 input/keydown 事件
When recordingStepToScriptStep(step) 执行
Then 生成脚本步骤（action: "input", value: step.value）
```

**Scenario 59.3:** navigate 事件转换
`aiCore.ts:1858-1971`

```gherkin
Given 录制收到 navigate 事件
When recordingStepToScriptStep(step) 执行
Then 生成脚本步骤（action: "navigate", value: step.url）
```

---

<a id="m60"></a>
### M60 — 录制-Enrichment

**Feature:** 录制步骤增强（OCR/AI 定位）

**Scenario 60.1:** 添加图像模板
`aiCore.ts:1977-2095`

```gherkin
Given 录制步骤已转换为脚本步骤
  And 步骤包含 screenshot（frameBase64）
When enrichRecordingStep() 执行
Then 设置 locators.imageTemplate = { screenshot: frameBase64, enabled: true }
```

**Scenario 60.2:** 添加归一化坐标
`aiCore.ts:1977-2095`

```gherkin
Given 步骤有 x, y 坐标和 viewportWidth/Height
When enrichRecordingStep() 执行
Then 计算 xPercent = x / viewportWidth
  And 计算 yPercent = y / viewportHeight
  And 设置 locators.normalizedCoords = { xPercent, yPercent, enabled: true }
```

**Scenario 60.3:** OCR 文本提取
`aiCore.ts:1977-2095`

```gherkin
Given 步骤有截图
When enrichRecordingStep() 执行
Then POST /api/ocr/extract-text { image: frameBase64, x, y }
  And 成功后设置 locators.textContent = { text, source: "ocr", enabled: true }
```

**Scenario 60.4:** VLM OCR 增强
`aiCore.ts:2151-2196`

```gherkin
Given 用户手动触发重新 OCR
When aiRetriggerOcr(idx) 执行
Then POST http://127.0.0.1:3100/api/vlm-ocr/start { image, x, y }
  And 轮询 /api/vlm-ocr/result/{taskId} 直到完成
  And 更新 locators.textContent = { text, source: "vlm" }
```

---

<a id="m61"></a>
### M61 — 统计轮询（FPS/带宽）

**Feature:** 实时统计显示

**Scenario 61.1:** FPS 计算
`streamCore.ts:111-208`

```gherkin
Given 视频流正在接收
When streamStats.recordFrame() 每帧调用
Then 记录帧时间戳到滑动窗口（3 秒）
  And 使用 EWMA（α=0.3）平滑 FPS 值
  And 每 500ms 刷新 UI 显示
```

**Scenario 61.2:** 带宽计算
`streamCore.ts:111-208`

```gherkin
Given 视频流正在接收
When 帧数据到达时记录字节数
Then 在 3 秒窗口内计算瞬时带宽
  And EWMA 平滑后格式化为 KB/s 或 MB/s
  And 更新 store.setStats({ fpsText, bandwidthText })
```

**Scenario 61.3:** 无帧时衰减
`streamCore.ts:111-208`

```gherkin
Given 视频流停止接收帧
When _prune() 清理过期帧记录
Then FPS 和带宽逐渐衰减到 0
  And UI 显示 "0 fps" 和 "0 KB/s"
```

---

<a id="m62"></a>
### M62 — 传输/捕获模式轮询

**Feature:** 模式状态轮询

**Scenario 62.1:** 传输模式轮询
`streamCore.ts:506-534`

```gherkin
Given 连接状态为 Connected
  And 传输模式轮询已启动（2 秒间隔）
When 轮询触发
Then GET /api/session/transport_mode
  And 更新 #transportModeBadge 显示当前模式
```

**Scenario 62.2:** 捕获模式轮询
`streamCore.ts:540-562`

```gherkin
Given 连接状态为 Connected
  And 捕获模式轮询已启动（1 秒间隔）
When 轮询触发
Then GET /api/session/capture_mode
  And 更新 #captureModeBadge 显示 push/poll 模式
```

---

<a id="m63"></a>
### M63 — More 菜单操作

**Feature:** More 菜单辅助操作

**Scenario 63.1:** 切换到日志面板
`ControllerLayout.tsx:327-371`

```gherkin
Given 当前显示 AI 面板
When 用户从 More 菜单选择"日志"
Then 调用 switchPanelTab("log")
  And 显示日志面板，隐藏 AI 面板
```

**Scenario 63.2:** 下载日志
`ControllerLayout.tsx:327-371`

```gherkin
Given More 菜单打开
When 用户选择"下载日志"
Then 调用 downloadLogs()
  And 触发文件下载
```

**Scenario 63.3:** 断开连接
`ControllerLayout.tsx:327-371`

```gherkin
Given More 菜单打开
When 用户选择"断开连接"
Then 调用 disconnect()
```

**Scenario 63.4:** 释放实例
`ControllerLayout.tsx:327-371`

```gherkin
Given More 菜单打开
When 用户选择"释放实例"
Then 调用 releaseInstance()
```

**Scenario 63.5:** 全屏切换
`ControllerLayout.tsx:327-371`

```gherkin
Given More 菜单打开
When 用户选择"全屏"
Then 调用 toggleFullscreen()
```

---

<a id="m64"></a>
### M64 — 设置持久化

**Feature:** 设置 localStorage 持久化

**Scenario 64.1:** AI 引擎持久化
`headerPopups.ts:122-126`

```gherkin
Given 用户更改 AI 引擎设置
When 设置变更
Then localStorage["ai_engine"] 更新
  And 下次页面加载时自动恢复
```

**Scenario 64.2:** AI 模型持久化
`headerPopups.ts:128-135`

```gherkin
Given 用户更改 AI 模型选择
When 设置变更
Then localStorage["ai_model"] 更新
```

**Scenario 64.3:** Dock 面板状态持久化
`dockLayout.ts:43-54`

```gherkin
Given 用户调整 Dock 面板宽度或折叠状态
When 状态变更
Then localStorage["ctl_dock_open"] 和 localStorage["ctl_dock_w"] 更新
  And 下次加载时恢复
```

**Scenario 64.4:** 浮动面板位置持久化
`floatingDock.ts:47-51`

```gherkin
Given 用户拖拽浮动面板到新位置
When 拖拽结束
Then localStorage["floating_dock_x"] 和 localStorage["floating_dock_y"] 更新
  And 下次加载时恢复位置
```

---

<a id="m65"></a>
### M65 — 工具栏折叠/展开

**Feature:** 顶部工具栏折叠

**Scenario 65.1:** 折叠工具栏
`ControllerLayout.tsx:199-201` · `aiCore.ts:6086-6216`

```gherkin
Given 工具栏当前展开
When 用户向上拉动拉绳（Pull Rope）
Then 工具栏折叠隐藏
  And 拉绳物理动画播放（Matter.js）
  And 视频区域扩大
```

**Scenario 65.2:** 展开工具栏
`ControllerLayout.tsx:199-201`

```gherkin
Given 工具栏当前折叠
When 用户向下拉动拉绳
Then 工具栏展开显示
  And 拉绳物理动画播放
  And 视频区域恢复
```

---

## 数据结构参考

### 脚本步骤 (Script Step)

```typescript
{
  id: string                    // 唯一标识（时间戳+随机串）
  action: string                // click|input|navigate|scroll|keypress|hover|wait|select|action
  target: string                // 目标元素描述
  value: string                 // 输入值/URL/按键等
  description: string           // 步骤描述
  status: 'pending'|'executing'|'success'|'error'
  locators: {
    xpath?: { value, enabled, priority }
    cssSelector?: { value, enabled, priority }
    textContent?: { text, source, enabled, priority, matchIndex, matchTotal }
    imageTemplate?: { screenshot, enabled, priority }
    normalizedCoords?: { xPercent, yPercent, enabled, priority }
    aiLocate?: { enabled, priority }
  }
  coordinates?: { x, y }
  screenshot?: string           // base64
  parentId?: string             // 逻辑步骤的父 ID
  stepType?: 'action'|'logic'|'loop'
  logicType?: 'if'|'else_if'|'else'
  logicGroupId?: string
  duration?: number             // 执行耗时（ms）
}
```

### 控制事件 (Control Event)

```typescript
// 鼠标事件
{ type: "click"|"dblclick"|"contextmenu"|"mousedown"|"mouseup"|"mousemove",
  x: number, y: number, button: 0|1|2,
  viewportWidth: number, viewportHeight: number }

// 键盘事件
{ type: "keydown"|"keyup"|"keypress",
  key: string, code: string, keyCode: number,
  ctrlKey: boolean, shiftKey: boolean, altKey: boolean, metaKey: boolean }

// 滚轮事件
{ type: "wheel", x: number, y: number,
  deltaX: number, deltaY: number, deltaZ: number }
```

### Store 状态 (controllerStore)

```typescript
{
  connected: boolean            // 连接状态
  statusText: string            // 状态文本
  currentUrl: string            // 当前页面 URL
  controlEnabled: boolean       // 远程控制开关
  stats: { fpsText: string, bandwidthText: string }
  tabs: Array<{ targetId, title?, url? }>
  activeTabId: string | null
}
```
