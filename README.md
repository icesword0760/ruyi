<p align="center">
  <img src="assets/logo.png" width="96" alt="如意 Ruyi">
</p>

<h1 align="center">如意 Ruyi</h1>

<p align="center">
  <b>AI 浏览器自动化工作台</b><br>
  对着一台直播中的远程 Chrome 说一句话，它规划、定位、执行，并沉淀成每一步都能自愈的脚本。
</p>

<p align="center">
  <i>Talk to a live remote Chrome. Get self-healing browser automation you can replay in pytest.</i>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/python-3.9%2B-3776AB?logo=python&logoColor=white" alt="Python 3.9+">
  <img src="https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white" alt="Node 18+">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="macOS | Linux">
  <img src="https://img.shields.io/badge/status-技术验证%20Demo-orange" alt="技术验证 Demo">
</p>

<p align="center">
  <a href="#主要验证的技术">验证了什么</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#它能做什么">它能做什么</a> ·
  <a href="#适合谁">适合谁</a> ·
  <a href="#路线图">路线图</a> ·
  <a href="#开发者指南">开发者指南</a> ·
  <a href="README.en.md">English</a>
</p>

> **这是一个技术验证 Demo**，不是可直接投入生产的产品。它的目的是验证下面列出的投屏链路和 AI 自动化，能否在一条完整的用户流程里协同工作。
>
> 从源码运行；在 macOS 上开发与验证，Linux 与 Windows 附带启动脚本，尚未系统验证。需要一个视觉语言模型的 API（Qwen3-VL、豆包、GPT-4o、Claude、Gemini 均可），或一个本地模型。

<p align="center">
  <img src="assets/hero.gif" alt="输入「点击问答按钮」，AI 规划、定位、点击，页面跳转后步骤被记入脚本" width="100%">
</p>
<p align="center">
  <sub>输入「点击问答按钮」：AI 先规划，再在页面里定位到导航栏的「问答」并点击；页面跳转后，这一步被记入右侧脚本。画面来自本地演示环境，目标站点为 testerhome.com。</sub>
</p>

## 主要验证的技术

这个仓库的重点不在产品完成度，而在于下面这条投屏链路能不能在普通浏览器里跑出可用的延迟和画质。其余模块都是围绕它搭起来的。

### 投屏与远程控制链路（核心）

| 环节 | 验证内容 | 代码 |
|------|----------|------|
| 采集 | 通过 CDP `Page.startScreencast` 推送式取帧，`captureScreenshot` 轮询作兜底 | `headless/cdp_client.py` |
| 编码 | 三条路线对比：MJPEG 原始 JPEG 直传，不二次编码，画质与截图一致；给 aiortc 的 VP8 编码器打补丁，按文字和界面内容调码率与量化范围；H.264 硬件编码，VideoToolbox、NVENC、QSV、VAAPI 择优，libx264 兜底 | `headless/mjpeg_server.py`、`headless/encoder_patch.py`、`headless/h264_encoder.py` |
| 低延迟模式 | 仿 scrcpy 的一套做法：推送式截屏、PNG 无损输入、ultrafast 与 zerolatency、禁用 B 帧、固定 GOP，配一个自定义二进制帧协议（视频帧、SPS/PPS、控制、统计四种消息，带 PTS） | `headless/scrcpy_capture.py`、`headless/scrcpy_encoder.py`、`headless/h264_stream_protocol.py` |
| 传输 | WebRTC（aiortc，SDP 协商加 DataChannel）与 WebSocket 两条通道，统一流服务器按模式分发；附 TURN 部署脚本 | `headless/webrtc_bridge.py`、`headless/stream_server.py`、`setup_turn_china.sh` |
| 解码 | 浏览器侧按能力自动选择：`<img>` 逐帧渲染 MJPEG，MSE 把 H.264 注入 `<video>`，WebCodecs 解码后画到 `<canvas>`；播放器可以热切换 | `controller_ui/src/controller/streamPlayerManager.ts`、`h264MsePlayer.ts`、`h264WebCodecsPlayer.ts` |
| 输入回传 | 鼠标、滚轮、键盘共 9 种事件编码成紧凑的二进制帧，经 DataChannel 或 WebSocket 回传；服务端以 10 ms 窗口批处理，减少 CDP 往返；相对坐标换算与校准；IME 中文输入助手 | `controller_ui/src/controller/mjpegEventEncoder.ts`、`remoteControlManager.ts`、`headless/event_batch_processor.py` |
| 自适应 | 按画面变化在 30、15、5、1 fps 四档之间自动切换，静态画面省 CPU 和带宽；帧率、画质、分辨率可以在线调；FPS 与带宽实时统计 | `headless/adaptive_fps.py`、`controller_ui/src/controller/streamCore.ts` |

### 围绕投屏搭起来的其它验证

- **CDP 驱动无头 Chrome**：导航、标签页、前进后退、脚本执行、截图、DOM 读取，全部走 DevTools 协议。
- **视觉语言模型做 GUI Agent**：Midscene 负责规划和定位，规划与定位可以交给不同模型；Qwen3-VL、豆包、GPT-4o、Claude、Gemini 和本地 UI-TARS 在同一界面上切换对比。
- **操作录制到脚本**：注入页面的录制脚本捕获事件，为每个目标生成 ARIA、testid、ID、文本、CSS、XPath 六种选择器并打稳定性分，连续输入与重复点击自动合并。
- **自愈定位与回放**：XPath、CSS、文本（DOM 或 OCR）、图像模板（Airtest）、归一化坐标、AI 定位、原始坐标，按优先级逐级降级；导出 pytest 加 allure，在 Playwright 里回放。
- **OCR 与图像匹配微服务**：RapidOCR 文字定位和 Airtest 模板匹配作为独立服务接入。

## 你是否也在这样工作

- 写 UI 自动化，一半时间花在找选择器上。页面改一次版，XPath 就红一片。
- 录制工具生成的脚本只认一种定位方式，回放失败只能重录。
- 想让 AI 替你操作浏览器，但它跑在你看不见的地方：点错了、点到哪、为什么点，都无从对证。
- 团队里既有人要一个看得见、能手动接管的界面，也有人要能进 CI 的 pytest。

如意把这四件事放进同一个页面：一台通过 WebRTC 或 MJPEG 直播到你浏览器里的 Chrome，一个能规划并执行的 AI，一份每一步都带六种定位策略的脚本，以及一键导出的 pytest。

## 它能做什么

### 1. 打开一台看得见、能接管的远程浏览器

远端的 Chrome 画面实时出现在你的浏览器里。你可以直接用鼠标键盘操作它，改地址、开标签页、前进后退，随时从 AI 手里接管。传输方式可以在 MJPEG 和 WebRTC H.264 之间切换，帧率、画质、分辨率都能调。

<p align="center"><img src="assets/live-browser.png" alt="远程浏览器的地址栏、标签页与连接状态" width="800"></p>
<p align="center"><sub>顶部是远端 Chrome 的地址栏与标签页，右侧弹层显示当前传输方式、帧率与带宽。</sub></p>

### 2. 对它说一句话

在右侧面板输入你想做的事，AI 会先给出规划，再在当前画面上定位目标，然后执行。每一步的推理都写在卡片里，你看得见它为什么这么点。

> 点击问答按钮

<p align="center"><img src="assets/say-it.png" alt="AI 依次给出规划、定位、点击，并确认页面已进入问答区" width="640"></p>
<p align="center"><sub>右侧面板里，AI 依次给出「规划 → 定位 → 点击」，再根据新截图确认页面已经进入问答区。</sub></p>

### 3. 或者，直接录下你的操作

点「录制」，然后在画面里像平时一样操作。每一次点击、输入都会被捕获成一条带元素描述的步骤，连续的输入会自动合并。

<p align="center"><img src="assets/record.png" alt="录制模式下每次点击都成为一条步骤" width="800"></p>
<p align="center"><sub>录制模式下在画面里点了导航栏的几个入口，每一次点击都成了一条带元素描述的步骤。</sub></p>

### 4. 每一步都有六种定位方式，失败自动切换

一条步骤同时保存 XPath、CSS、文本（DOM 或 OCR）、图像模板、归一化坐标和 AI 定位六种定位器，再加原始坐标兜底。回放时按优先级依次尝试，前一种失效就换下一种。优先级可以拖拽调整。

<p align="center"><img src="assets/locators.png" alt="编辑步骤对话框中的六种定位策略标签" width="560"></p>
<p align="center"><sub>编辑一条「点击 '社区'」步骤：XPath、CSS、文本/OCR、图像、坐标、AI 定位六个标签可以拖拽排序，回放时按这个顺序依次尝试。</sub></p>

### 5. 用你信得过的模型

AI 设置里可以切换引擎，选择定位模型，并把「规划」和「定位」交给不同的模型。界面内置了 Qwen3-VL、豆包 Seed、GPT-4o、Claude Sonnet、Gemini 等选项，也支持通过 LM Studio 接入本地的 UI-TARS。

<p align="center"><img src="assets/models.png" alt="AI 设置：引擎、定位模型与规划定位分离开关" width="600"></p>
<p align="center"><sub>AI 设置里可以切换引擎（Midscene 或本地 MAI-UI）、选择定位模型，并打开「规划与定位分离」。</sub></p>

### 6. 导出成 pytest，进 CI

脚本可以一键导出为 `test_<名称>.py`。导出的文件基于 `webrtc_healing` 引擎回放，每一步都带着上面那套定位器，自愈过程会作为 allure 附件记录下来。

```python
from webrtc_healing import execute_step
from webrtc_healing.conftest_template import *  # browser / page fixtures

@allure.epic('问答区巡检')
class TestQaCheck:
    @allure.story('click')
    @allure.title('顶部导航栏中的问答按钮')
    def test_01_click(self, page):
        step = {...}  # 动作、描述、六种定位器与优先级
        result = execute_step(page, step)
        assert result['success'], result.get('error')
```

```bash
pytest test_qa_check.py --alluredir=allure-results
allure serve allure-results
```

回放需要一台通过 CDP 暴露在 `127.0.0.1:9222` 的 Chrome，导出文件的末尾写了完整的运行说明。

### 7. 面板可以拆出来

右侧面板可以拖宽、折叠，也可以弹成一个独立的小窗口放在任何地方，让远程画面占满整个屏幕。

<p align="center"><img src="assets/floating.png" alt="弹出为独立窗口的脚本面板" width="520"></p>
<p align="center"><sub>脚本面板被弹成了独立窗口，浮在远程画面之上。</sub></p>

## 适合谁

- **维护 UI 自动化的测试开发**：定位器一改版就失效，每次回放失败都要重录。
- **做网页 RPA 或数据采集的人**：需要一台看得见、能随时接管的浏览器，而不是一个黑盒。
- **研究 GUI Agent 的人**：想在同一套页面上，用同一条指令对比不同视觉模型的表现。
- **想把 AI 的操作沉淀下来的团队**：AI 点过的路径，导出后能在 CI 里稳定复现。

## 快速开始

需要：Python 3.9+、Node 18+、本机已安装 Google Chrome、一个视觉语言模型的 API Key（任意 OpenAI 兼容端点）。

```bash
git clone https://github.com/icesword0760/ruyi.git
cd ruyi

cp ai_service/.env.example ai_service/.env
# 打开 ai_service/.env，填入 OPENAI_API_KEY、OPENAI_BASE_URL 和 MIDSCENE_MODEL_NAME

./start.sh            # 安装依赖、构建控制台、启动全部服务
./start.sh --no-ocr   # 不需要 OCR 定位时可以跳过 OCR 服务
```

然后打开 <http://localhost:5566/controller>。

| 端口 | 服务 |
|------|------|
| 5566 | 控制台与 API（Flask） |
| 5567 | 视频流（MJPEG / H.264） |
| 9222 | 远端 Chrome 的 CDP 调试口 |
| 3100 | AI 服务（Node.js，Midscene） |
| 9788 | OCR 服务（可选） |

`.env` 中的其它项：`AI_API_KEY` / `AI_BASE_URL` / `AI_DEFAULT_MODEL` 用于任务规划，`DOUBAO_*` 用于豆包的独立端点，`LMSTUDIO_BASE_URL` 用于本地模型。首次启动 OCR 服务会下载识别模型。

Windows 用户可以使用 `start.bat`，但尚未系统验证。

## 路线图

以下都还没有做：

- 安装包或 Docker 镜像。目前只能从源码运行。
- Linux 与 Windows 的系统性验证。现有脚本能启动，但没有完整跑过测试。
- 自动化测试套件。早期用例已归档，当前仓库没有活跃的测试。
- macOS 之外的硬件 H.264 编码器。NVENC、QSV、VAAPI 的分支都在代码里，但没有在对应机器上验证过。
- pytest 之外的导出格式。

## 开发者指南

<details>
<summary><b>项目结构</b></summary>

```
server.py              Flask 主服务：WebRTC 协商、会话、录制、脚本、导出
config.py              端口、Chrome 路径、编码模式等配置
headless/              无头 Chrome 管理、CDP 客户端、WebRTC 桥、MJPEG/H.264 流、录制注入脚本
webrtc_healing/        可安装的自愈定位引擎（pip install -e .）：7 策略定位 + 步骤执行
ai_service/            Node 服务：Midscene 驱动的 AI 规划与定位，OCR 服务
controller_ui/         React + TypeScript + Vite 控制台，构建产物输出到 static/controller-app/
chrome_extension/      辅助扩展：导出页面 DOM、辅助定位
start.sh / start.bat   一键启动
```

</details>

<details>
<summary><b>架构</b></summary>

```
你的浏览器 ──WebRTC / MJPEG──▶ Flask (5566) + 流服务 (5567) ──CDP──▶ 无头 Chrome (9222)
      │                              │
      │  指令 / 录制 / 脚本            ├──HTTP──▶ AI 服务 (3100, Midscene) ──▶ 视觉语言模型
      ▼                              └──HTTP──▶ OCR 服务 (9788, 可选)
   控制台 (React)
```

- 控制端捕获鼠标键盘事件，经 DataChannel 或 WebSocket 发到 Flask，再由 CDP 注入远端 Chrome。
- AI 服务拿到当前截图与指令后，输出规划、定位与动作；每个动作回写成带六种定位器的步骤。
- `webrtc_healing` 在回放时按优先级依次尝试定位器，并记录自愈日志。

</details>

<details>
<summary><b>常用命令</b></summary>

```bash
python server.py                                   # 只启动 Flask
python ai_service/ocr_service.py                   # 只启动 OCR
cd ai_service && npm start                         # 只启动 AI 服务
cd controller_ui && npm run dev                    # 控制台前端开发模式
cd controller_ui && npm run build                  # 构建到 static/controller-app/
pip install -e .                                   # 以开发模式安装 webrtc_healing
```

</details>

## 反馈与协议

遇到问题或有想法，欢迎在 [Issues](https://github.com/icesword0760/ruyi/issues) 里说。

本项目以 [MIT 协议](LICENSE) 开源。如果它帮你省下了找选择器的时间，点个 Star 让更多人看到。
