# /controller（React 版）视觉语言 + UED + 交互重构规格（功能 0 损失）

> 目标：在 **不改变/不损失当前 `/controller`（React 版）任何功能** 的前提下，进行“视觉语言传达、UED 设计、交互设计”全量重构。
>
> - 允许：样式、布局、信息架构、交互路径、动画与过渡
> - 禁止：任何功能被弱化、隐藏到不可发现、或交互变得更难完成（同等可达/同等反馈/同等快捷）

---

## 0. 完成标准（DoD）

### 功能（Hard）

- 现有 `/controller` 的所有能力在新 UI 下 **100% 可达**，并提供同等或更强反馈
- 关键链路具备：禁用态、loading、成功/失败提示、可恢复路径（重试/回滚/解释）
- 行为自动化回归：Playwright E2E 覆盖关键路径 + 失败路径（见验收矩阵）

### 审美（Hard）

- 视觉语言统一：字体、图标、圆角、阴影、边框、间距、颜色、动效全部收敛到 tokens
- 轻快、明亮、科技感、克制高级（Frosted Glass + Calm Tech）
- **禁止 emoji 作为产品图标**（日志文本允许可选装饰，但默认 UI 控件不使用 emoji）

### 易用性（Hard）

- 低认知门槛：高频动作一眼可见、分组清晰、二级入口可发现
- 键盘可达：Popover/Dialog/Drawer 焦点管理完善、Esc 可关闭、Tab 顺序合理
- `prefers-reduced-motion` 适配：减少动画时依然美观可用

---

## 1. 现状问题（为何“AI 味/不高级”）

1) **样式来源多且冲突**
- `controller-legacy-base.css`（深色 legacy）+ `controller-legacy-glass.css`（浅色覆盖）+ `theme.css`（再次覆盖）
- 造成：同一类控件在不同区域的边框/阴影/圆角/文字对比不一致，整体像“拼贴”

2) **图标体系不统一**
- emoji + 文字符号（◀ ▶ ↻ 等）混用，跨平台渲染差异大，容易显得“廉价/临时”

3) **组件语义弱**
- 缺乏统一的 Button/Input/Select/Popover/Toast 规范：尺寸、密度、状态、对齐、间距不一致

---

## 2. 目标视觉语言（North Star）

### 关键词

- Light / Bright
- Frosted Glass（毛玻璃但克制：可读性优先）
- Calm Tech（“科技感”来自秩序与细节，而不是高饱和与重渐变）

### 参考（不局限 Google）

- Apple HIG（玻璃分层、背景噪点、微高光、动效克制）
- Linear（排版与留白、信息层级）
- Arc（顶部命令条、分组操作）
- Stripe/Vercel（高级留白、色彩克制）
- Material 3（可用性与动效规范）

---

## 3. 信息架构（IA）与布局（允许改变）

### 3.1 顶部：Command Bar（命令条）

- **左侧（状态）**
  - 连接状态（dot + 文案）
  - 当前 URL（可点击编辑，Enter 提交 / Esc 取消）
  - FPS / 带宽（次级信息）
- **中间（Tabs）**
  - Tabs 滚动条 + 溢出菜单（列表/搜索/关闭其他）
  - 新建 Tab
- **右侧（动作组）**
  - 导航：后退/前进/刷新
  - 控制：控制开关/全屏
  - 危险：断开/释放（统一危险风格 + 二次确认）
  - 脚本：脚本库入口
  - 设置：设置入口（Popover/Drawer）

### 3.2 主体：Stage + Dock

- 左侧：远程画面舞台（最大化可视区域）
  - HUD（轻量信息层/快捷操作）：有操作出现，无操作自动淡出
- 右侧：Dock（工具侧栏，可折叠/可拖拽宽度/记忆）
  - AI 自动化（对话 + 脚本 + 定位器 + 执行）
  - 录制中心（开始/停止/状态/导入）
  - 脚本库（保存/搜索/分组/最近）
  - 日志与诊断（log/debug/筛选/导出）
  - 设置（传输/画质/AI 模型/分离模式）

---

## 4. 设计系统（Design Tokens）

> 原则：所有视觉参数（颜色/圆角/阴影/间距/动效）只从 tokens 来。

- 颜色 tokens（示例命名）
  - `--bg/aurora-*`：背景光晕层
  - `--surface-1/2/3`：玻璃/卡片/浮层
  - `--border-subtle/strong`
  - `--text/primary/secondary/tertiary`
  - `--accent/*`、`--success/*`、`--warn/*`、`--danger/*`
- 排版 tokens
  - 主字体 + 等宽字体（日志/调试）
  - 字号阶梯（10/12/13/14/16）
- 圆角 tokens
  - 10 / 14 / 18 三档为主
- 阴影与高光
  - elevation 4 档，含玻璃高光描边与内阴影
- 动效 tokens
  - duration：120/180/240ms
  - easing：standard/emphasized
  - `prefers-reduced-motion`：禁用位移/缩放，仅保留 opacity

---

## 5. 交互规范（UED）

### 5.1 状态机（必须显性表达）

- `Disconnected` / `Connecting` / `Connected` / `Degraded` / `Error`
- 每种状态必须有：
  - 主文案（原因/下一步）
  - 可操作按钮（连接/重试/切换模式/查看日志）
  - 反馈（Toast + 日志）

### 5.2 危险操作

- 断开：可撤销路径明确（重新连接）
- 释放：强二次确认 + 后果说明 + 执行中锁定按钮

### 5.3 表单/设置

- “已生效 / 待应用 / 与当前不同”的状态可视化
- 应用后给出反馈与下一步（必要时自动刷新状态）

---

## 6. 模块清单（必须完整具备）

> 以当前 React 版为真值，模块按可达性重组，不允许减少能力。

- 连接与投屏（WebRTC / MJPEG / Scrcpy）
- 远程控制（鼠标/键盘/滚轮/节流/坐标校准）
- URL 导航 + Back/Forward/Reload
- Tabs：list/switch/close/create + auto switch
- IME 中文输入辅助
- AI 自动化：对话、生成/停止、步骤编辑/拖拽、单步/全量执行、定位器管理、OCR/VLM OCR 重试
- 录制到脚本：开始/停止、实时 step 注入、enrichment
- 脚本库：保存/加载/重命名/删除/导出
- 日志与诊断：log/debug、筛选/搜索/复制/导出、自动滚动
- 统一 Toast/Tooltip/Dialog/Popover 系统

---

## 7. 工程实施策略（不考虑成本，确保 0 损失）

1) **先固化验收矩阵 + E2E 基线**（防遗漏）
2) 建立 tokens + primitives + icons（统一风格基座）
3) 先“换肤不换逻辑”：不改核心 stream/ai 能力，只替换呈现与交互壳
4) 再“组件化替换”：将依赖 DOM 拼接的 UI 逐步迁为 React 组件（保留必要 bridge API）
5) 全量回归：E2E + 视觉 diff + a11y + 长时间稳定性

