import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Copy,
  Download,
  Eraser,
  Folder,
  Keyboard,
  Maximize2,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  RefreshCcw,
  Save,
  ScrollText,
  Send,
  Settings2,
  Trash2,
  ExternalLink,
  PanelRightClose,
  Unplug,
  X,
} from "lucide-react";

type LegacyFn = (...args: unknown[]) => unknown;

function useLoopTypewriter(text: string) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    if (reducedMotion) {
      setValue(text);
      return;
    }

    let index = 0;
    let deleting = false;
    let timer: number | undefined;

    const step = () => {
      if (!deleting) {
        index = Math.min(text.length, index + 1);
        setValue(text.slice(0, index));
        if (index >= text.length) {
          deleting = true;
          timer = window.setTimeout(step, 3000);
        } else {
          timer = window.setTimeout(step, 55);
        }
        return;
      }

      index = Math.max(0, index - 1);
      setValue(text.slice(0, index));
      if (index <= 0) {
        deleting = false;
        timer = window.setTimeout(step, 600);
      } else {
        timer = window.setTimeout(step, 22);
      }
    };

    timer = window.setTimeout(step, 300);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [text]);

  return value;
}

function callLegacy(name: string, ...args: unknown[]) {
  const fn = (window as unknown as Record<string, unknown>)[name] as LegacyFn | undefined;
  if (typeof fn === "function") return fn(...args);
}

function toggleEl(id: string, triggerEl?: EventTarget | null) {
  const el = document.getElementById(id);
  if (!el) return;
  const isShowing = el.classList.contains("show");
  if (isShowing) {
    el.classList.remove("show");
    return;
  }
  el.classList.add("show");
  const closeOnOutsideClick = (e: MouseEvent) => {
    // If the click came from the trigger element itself, ignore — it will
    // handle toggling off via the direct onClick handler.
    if (triggerEl && (triggerEl as Node).contains?.(e.target as Node)) return;
    if (!el.contains(e.target as Node)) {
      el.classList.remove("show");
      document.removeEventListener("click", closeOnOutsideClick, true);
    }
  };
  requestAnimationFrame(() =>
    document.addEventListener("click", closeOnOutsideClick, true),
  );
}

export function ControllerLayout() {
  const auroraRef = useRef<HTMLCanvasElement>(null);
  const emptyHintText =
    "在下方输入框输入自然语言操作浏览器，或者点击录制按钮进行录制";
  const emptyHintTyped = useLoopTypewriter(emptyHintText);

  useEffect(() => {
    let destroy: (() => void) | undefined;
    import("./aurora").then(({ initAurora, destroyAurora }) => {
      initAurora(auroraRef.current);
      destroy = destroyAurora;
    });
    const focusTimer = window.setTimeout(() => {
      document.getElementById("aiChatInput")?.focus();
    }, 300);
    return () => { destroy?.(); window.clearTimeout(focusTimer); };
  }, []);

  return (
    <div className="ctl-app main-container">
      <canvas ref={auroraRef} className="ctl-aurora-canvas" />
      {/* ── Toolbar (full width) ── */}
      <div className="ctl-toolbar-shell">
      <div className="ctl-toolbar">
          <div className="ctl-toolbar-section ctl-toolbar-left">
            <div className="ctl-toolbar-status" id="panelStatusBar">
              <div className="ctl-status-dot" id="statusDot" />
              <span className="ctl-toolbar-status-text" id="infoStatus">未连接</span>
            </div>

            <div className="ctl-toolbar-nav">
              <button className="ctl-icon-btn ctl-icon-btn--sm" onClick={() => callLegacy("historyBack")} title="后退" aria-label="后退">
                <ArrowLeft className="ctl-icon" />
              </button>
              <button className="ctl-icon-btn ctl-icon-btn--sm" onClick={() => callLegacy("historyForward")} title="前进" aria-label="前进">
                <ArrowRight className="ctl-icon" />
              </button>
              <button className="ctl-icon-btn ctl-icon-btn--sm" onClick={() => callLegacy("reloadPage")} title="刷新" aria-label="刷新">
                <RefreshCcw className="ctl-icon--sm" />
              </button>
            </div>
          </div>

          <div className="ctl-toolbar-section ctl-toolbar-center">
            <div className="ctl-url-bar" id="urlBarWrap">
              <span className="ctl-url-bar-text" id="infoRoomId" title="-" onClick={() => callLegacy("startUrlEdit")}>-</span>
              <input
                className="ctl-url-bar-input"
                id="urlEditInput"
                style={{ display: "none" }}
                ref={(el) => {
                  if (!el) return;
                  if (el.dataset.controllerLegacyBound === "1") return;
                  el.dataset.controllerLegacyBound = "1";
                  el.addEventListener("blur", () => callLegacy("cancelUrlEdit"));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") callLegacy("commitUrlEdit");
                  else if (event.key === "Escape") callLegacy("cancelUrlEdit");
                }}
              />
            </div>

            <div className="ctl-toolbar-tabs header-tabs" id="headerTabs" style={{ display: "none" }}>
              <div className="ctl-toolbar-tabs-list" id="headerTabsList" />
              <button className="ctl-icon-btn ctl-icon-btn--sm" onClick={() => callLegacy("createNewTab")} title="新建标签页">
                <Plus className="ctl-icon--sm" />
              </button>
            </div>
          </div>

          <div className="ctl-toolbar-section ctl-toolbar-right">
            <div style={{ position: "relative" }}>
              <button className="ctl-icon-btn" id="imePopupBtn" onClick={() => callLegacy("toggleImePopup")} title="中文输入辅助">
                <Keyboard className="ctl-icon" />
              </button>
              <div className="ctl-popup ctl-popup--down ctl-popup--right" id="imePopup">
                <div className="ctl-popup-title">中文输入辅助</div>
                <textarea className="ctl-textarea" id="imeInput" placeholder="输入中文，按Enter发送..." rows={3} />
                <div className="ctl-popup-footer">
                  <span className="ctl-popup-hint" id="imeCharCount">0 字符</span>
                  <div className="ctl-popup-actions">
                    <button className="ctl-btn ctl-btn--sm ctl-btn--ghost" onClick={() => callLegacy("clearImeHelper")}>清空</button>
                    <button className="ctl-btn ctl-btn--sm ctl-btn--primary" onClick={() => callLegacy("sendImeText")}>发送</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="ctl-divider" />

            <button className="ctl-icon-btn ctl-icon-btn--sm" id="toolbarCollapseBtn" onClick={() => callLegacy("toggleToolbarCollapse")} title="收起工具栏" aria-label="收起工具栏">
              <ChevronUp className="ctl-icon--sm" />
            </button>

            <div style={{ position: "relative" }}>
              <button className="ctl-icon-btn" id="settingsPopupBtn" onClick={() => callLegacy("toggleSettingsPopup")} title="设置">
                <Settings2 className="ctl-icon" />
              </button>
              <div className="ctl-popup ctl-popup--down ctl-popup--right ctl-settings-popup settings-popup settings-tabbed" id="settingsPopup">
                <div className="settings-tabs">
                  <button className="settings-tab active" data-tab="quality" onClick={() => callLegacy("switchSettingsTab", "quality")}>画质设置</button>
                  <button className="settings-tab" data-tab="ai" onClick={() => callLegacy("switchSettingsTab", "ai")}>AI设置</button>
                </div>
                <div className="settings-tab-content active" id="settingsTabQuality">
                  <div className="ctl-settings-row">
                    <label>传输</label>
                    <select className="ctl-select" id="transportModeSelect" defaultValue="mjpeg">
                      <option value="webrtc">WebRTC</option>
                      <option value="mjpeg">MJPEG</option>
                      <option value="scrcpy">Scrcpy (H.264)</option>
                    </select>
                  </div>
                  <div className="ctl-settings-row">
                    <label>帧率</label>
                    <select className="ctl-select" id="fpsSelect" defaultValue="30">
                      <option value="10">10fps</option>
                      <option value="20">20fps</option>
                      <option value="30">30fps</option>
                      <option value="60">60fps</option>
                    </select>
                  </div>
                  <div className="ctl-settings-row">
                    <label>画质</label>
                    <select className="ctl-select" id="qualitySelect" defaultValue="98">
                      <option value="70">70</option>
                      <option value="85">85</option>
                      <option value="95">95</option>
                      <option value="98">98</option>
                    </select>
                  </div>
                  <div className="ctl-settings-row">
                    <label>分辨率</label>
                    <select className="ctl-select" id="resolutionSelect" defaultValue="1920x1080">
                      <option value="1920x1080">1080p</option>
                      <option value="2560x1440">2K</option>
                      <option value="3840x2160">4K</option>
                    </select>
                  </div>
                  <div className="ctl-settings-actions">
                    <button className="ctl-btn ctl-btn--sm" onClick={() => { void callLegacy("applyAllSettings"); callLegacy("toggleSettingsPopup"); }}>应用</button>
                    <button className="ctl-btn ctl-btn--sm" onClick={() => { void callLegacy("switchTransportMode"); callLegacy("toggleSettingsPopup"); }}>切换模式</button>
                  </div>
                </div>
                <div className="settings-tab-content" id="settingsTabAi">
                  <div className="ctl-settings-row">
                    <label>AI引擎</label>
                    <div className="ai-engine-seg" role="radiogroup" aria-label="AI引擎">
                      <button
                        type="button"
                        className="ai-engine-seg-btn"
                        data-engine="midscene"
                        onClick={() => callLegacy("setSettingsAiEngine", "midscene")}
                      >
                        Midscene
                      </button>
                      <button
                        type="button"
                        className="ai-engine-seg-btn"
                        data-engine="mai-ui"
                        onClick={() => callLegacy("setSettingsAiEngine", "mai-ui")}
                      >
                        MAI-UI
                      </button>
                    </div>
                  </div>

                  <div className="settings-midscene-section" id="settingsEngineMidsceneSection">
                    <div className="ctl-settings-row">
                      <label>定位模型</label>
                      <select className="ctl-select" id="settingsAiModelSelect" defaultValue="doubao-seed-1-8-251228" onChange={(event) => callLegacy("syncModelFromSettings", event.currentTarget.value)}>
                        <option value="Qwen/Qwen3-VL-235B-A22B-Instruct">Qwen3-VL</option>
                        <option value="Qwen/Qwen3-VL-235B-A22B-Thinking">Qwen3-VL-Think</option>
                        <option value="google/gemini-3-pro-preview">Gemini 3 Pro</option>
                        <option value="doubao-seed-1-8-251228">豆包 Seed</option>
                        <option value="ui-tars-1.5-7b">UI-TARS 1.5 (本地)</option>
                      </select>
                    </div>
                    <div className="ctl-settings-row">
                      <label>分离模式</label>
                      <button className="settings-split-toggle ctl-toggle" id="settingsSplitToggle" onClick={() => callLegacy("toggleSettingsSplitMode")} title="规划和定位使用不同模型" />
                      <span className="ctl-settings-label">规划与定位分离</span>
                    </div>
                    <div className="ctl-settings-row settings-planning-model-row" id="settingsPlanningModelRow">
                      <label>规划模型</label>
                      <select className="ctl-select" id="settingsPlanningModelSelect" onChange={(event) => callLegacy("syncPlanningModelFromSettings", event.currentTarget.value)}>
                        <option value="Qwen/Qwen3-VL-235B-A22B-Instruct">Qwen3-VL</option>
                        <option value="Qwen/Qwen3-VL-235B-A22B-Thinking">Qwen3-VL-Think</option>
                        <option value="google/gemini-3-pro-preview">Gemini 3 Pro</option>
                        <option value="doubao-seed-1-8-251228">豆包 Seed</option>
                        <option value="ui-tars-1.5-7b">UI-TARS 1.5 (本地)</option>
                        <option value="openai/gpt-4o">GPT-4o</option>
                        <option value="anthropic/claude-sonnet-4">Claude Sonnet 4</option>
                        <option value="anthropic/claude-sonnet-4.5">Claude Sonnet 4.5</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-maiui-section" id="settingsEngineMaiUiSection">
                    <div className="ctl-settings-row">
                      <label>模型</label>
                      <select className="ctl-select" id="settingsMaiUiModelSelect" defaultValue="mai-ui-8b@q8_0" onChange={(event) => callLegacy("syncMaiUiModelFromSettings", event.currentTarget.value)}>
                        <option value="mai-ui-8b@q8_0">MAI-UI 8B (本地)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button className="ctl-icon-btn" onClick={() => callLegacy("switchPanelTab", "log")} title="打开日志面板" aria-label="打开日志面板">
              <ScrollText className="ctl-icon" />
            </button>

            <button className="ctl-icon-btn" onClick={() => callLegacy("toggleFullscreen")} title="全屏" aria-label="全屏">
              <Maximize2 className="ctl-icon" />
            </button>

            <div style={{ position: "relative" }}>
              <button className="ctl-icon-btn" id="toolbarMoreBtn" onClick={(e) => toggleEl("toolbarMoreMenu", e.currentTarget)} title="更多">
                <MoreHorizontal className="ctl-icon" />
              </button>
              <div className="ctl-popup ctl-popup--down ctl-popup--right ctl-more-menu" id="toolbarMoreMenu">
                <button className="ctl-more-item" id="controlToggleBtn" onClick={() => { callLegacy("toggleControl"); toggleEl("toolbarMoreMenu"); }}>
                  <MousePointer2 className="ctl-icon" />
                  <span className="ctl-more-item-text" id="controlStatus">控制</span>
                  <span className="ctl-badge ctl-badge--success ctl-more-item-badge" id="controlBadge">开</span>
                </button>
                <div className="ctl-more-divider" />
                <div className="ctl-more-info">
                  <span className="ctl-more-info-label">投屏模式</span>
                  <span className="ctl-more-info-value" id="captureModeValue">初始化中</span>
                </div>
                <div className="ctl-more-info">
                  <span className="ctl-more-info-label">传输</span>
                  <span className="ctl-more-info-value" id="psbTransport">-</span>
                </div>
                <div className="ctl-more-info">
                  <span className="ctl-more-info-label">FPS</span>
                  <span className="ctl-more-info-value"><span id="fps">-</span></span>
                </div>
                <div className="ctl-more-info">
                  <span className="ctl-more-info-label">带宽</span>
                  <span className="ctl-more-info-value"><span id="bandwidth">-</span></span>
                </div>
                <div className="ctl-more-info">
                  <span className="ctl-more-info-label">分辨率</span>
                  <span className="ctl-more-info-value" id="infoResolution">-</span>
                </div>
                <div className="ctl-more-divider" />
                <button className="ctl-more-item" onClick={() => { callLegacy("downloadLogs"); toggleEl("toolbarMoreMenu"); }}>
                  <Download className="ctl-icon" />
                  <span className="ctl-more-item-text">导出日志</span>
                </button>
                <div className="ctl-more-divider" />
                <button className="ctl-more-item ctl-more-item--danger" onClick={() => { callLegacy("disconnect"); toggleEl("toolbarMoreMenu"); }}>
                  <Unplug className="ctl-icon" />
                  <span className="ctl-more-item-text">断开连接</span>
                </button>
                <button className="ctl-more-item ctl-more-item--danger" onClick={() => { callLegacy("releaseInstance"); toggleEl("toolbarMoreMenu"); }}>
                  <Trash2 className="ctl-icon" />
                  <span className="ctl-more-item-text">释放实例</span>
                </button>
              </div>
            </div>
          </div>

          <div className="ctl-toolbar-glow" />
      </div>
      </div>{/* end ctl-toolbar-shell */}

      <button className="ctl-toolbar-pulltab" id="toolbarPullTab" onClick={() => callLegacy("toggleToolbarCollapse")} title="展开工具栏" aria-label="展开工具栏">
        <svg className="ctl-pulltab-rope" viewBox="0 0 14 60" aria-hidden="true">
          <path id="toolbarPullTabRopePath" d="M7 0 L7 15" />
          <circle id="toolbarPullTabKnot" cx="7" cy="19" r="2.5" />
        </svg>
      </button>

      {/* ═══ Body row (stage + resize + AI panel) ═══ */}
      <div className="ctl-body-row">

      {/* ════════════════════════════════════════
          Stage Column (video + log)
          ════════════════════════════════════════ */}
      <div className="ctl-stage-col left-panel">
        {/* ── Stage (video area) ── */}
        <div className="ctl-stage">
          <div className="video-container">
            <div className="placeholder" id="placeholder">
              <div className="ctl-placeholder-spinner" />
              <div className="ctl-placeholder-text">正在启动浏览器...</div>
              <div className="ctl-placeholder-sub">首次加载可能需要几秒钟</div>
            </div>
            <video id="remoteVideo" autoPlay playsInline style={{ display: "none" }} />
            <img id="remoteImage" style={{ display: "none" }} alt="" />

            <div className="info-overlay" id="infoOverlay" style={{ display: "none" }} />
            <div className="toolbar" id="toolbar" style={{ display: "none" }} />
            <div className="stats" id="stats" style={{ display: "none" }} />

            <div id="captureModeBadge" style={{ display: "none" }}>
              <div className="capture-mode-title">投屏模式</div>
              <div className="capture-mode-value" />
              <div className="capture-mode-detail" id="captureModeDetail">正在检测...</div>
            </div>
            <div id="transportModeBadge" style={{ display: "none" }}>
              <span id="transportModeText" style={{ display: "none" }}>传输: -</span>
            </div>
          </div>
        </div>

        {/* ── Log Drawer (overlays stage) ── */}
        <div className="ctl-log-drawer" id="logPanelTab" role="dialog" aria-label="日志与诊断" aria-hidden="true">
          <div className="log-panel">
            <div className="log-panel-header">
              <div className="log-panel-title">日志与诊断</div>
              <div className="log-panel-actions">
                <button className="ctl-btn ctl-btn--sm ctl-btn--ghost ctl-focus-ring" id="autoScrollBtn" onClick={() => callLegacy("toggleAutoScroll")} title="切换自动滚动" type="button">
                  自动滚动: 开
                </button>
                <button className="ctl-icon-btn ctl-icon-btn--sm ctl-focus-ring" onClick={() => callLegacy("clearLogs")} title="清空日志">
                  <Eraser className="ctl-icon--sm" />
                </button>
                <button className="ctl-icon-btn ctl-icon-btn--sm ctl-focus-ring" onClick={() => callLegacy("downloadLogs")} title="导出日志">
                  <Download className="ctl-icon--sm" />
                </button>
                <button className="ctl-icon-btn ctl-icon-btn--sm ctl-focus-ring" type="button" onClick={() => callLegacy("switchPanelTab", "ai")} title="关闭日志">
                  <X className="ctl-icon--sm" />
                </button>
              </div>
            </div>
            <div className="log-panel-controls">
              <div className="log-view-tabs" role="tablist" aria-label="日志视图">
                <button className="log-view-tab active ctl-focus-ring" data-log-view="main" role="tab" onClick={() => callLegacy("switchLogView", "main")}>Logs</button>
                <button className="log-view-tab ctl-focus-ring" data-log-view="debug" role="tab" onClick={() => callLegacy("switchLogView", "debug")}>Debug</button>
              </div>
              <div className="log-filter-row">
                <div className="log-filter-chips" aria-label="日志筛选">
                  <button className="log-filter-chip active ctl-focus-ring" data-log-filter="all" onClick={() => callLegacy("setLogFilter", "all")}>全部</button>
                  <button className="log-filter-chip ctl-focus-ring" data-log-filter="info" onClick={() => callLegacy("setLogFilter", "info")}>Info</button>
                  <button className="log-filter-chip ctl-focus-ring" data-log-filter="success" onClick={() => callLegacy("setLogFilter", "success")}>Success</button>
                  <button className="log-filter-chip ctl-focus-ring" data-log-filter="warning" onClick={() => callLegacy("setLogFilter", "warning")}>Warn</button>
                  <button className="log-filter-chip ctl-focus-ring" data-log-filter="error" onClick={() => callLegacy("setLogFilter", "error")}>Error</button>
                  <button className="log-filter-chip ctl-focus-ring" data-log-filter="debug" onClick={() => callLegacy("setLogFilter", "debug")}>Debug</button>
                </div>
                <input className="ctl-input ctl-focus-ring log-search" placeholder="搜索日志…" onInput={(e) => callLegacy("setLogSearchQuery", (e.currentTarget as HTMLInputElement).value)} />
              </div>
            </div>
            <div className="log-panel-body">
              <div className="log-content" id="logContent" />
              <div className="log-content" id="debugLogContent" style={{ display: "none" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Resize handle (drag to resize AI panel) */}
      <div
        className="ctl-panel-resize"
        id="dockResizeHandle"
        role="separator"
        aria-orientation="vertical"
        title="拖拽调整 AI 面板宽度（双击重置）"
      />

      {/* ════════════════════════════════════════
          AI Panel (full height, right side)
          ════════════════════════════════════════ */}
      <div className="ctl-panel right-panel" id="dockPanel">
        {/* Record button (top-left of AI panel) */}
        <button
          className="ctl-btn ctl-btn--xs ctl-panel-record-btn"
          id="aiRecordToScriptBtn"
          onClick={() => callLegacy("aiToggleRecordToScript")}
          title="录制步骤到编辑区"
          type="button"
        >
          <CircleDot className="ctl-icon--xs" />
          录制
        </button>

        <div className="ctl-panel-body right-panel-scroll">
          <div style={{ display: "none" }}>
            <input type="text" id="navigateInput" />
            <button id="connectBtn" />
            <button id="reconnectBtn" />
            <button id="disconnectBtn" />
            <button id="navigateBtn" />
            <div id="controlPanelTab" />
            <div id="recorderPanelTab" />
            <div id="tabsBar" />
            <div id="tabsList" />
            <canvas id="h264Canvas" />
            <video id="h264Video" />
            <span id="statResolution" />
            <span id="statFPS" />
            <span id="statBitrate" />
            <span id="statConnection" />
            <span id="statQuality" />
            <span id="statCodec" />
            <span id="totalFrames" />
            <span id="avgFrameSize" />
            <span id="debugPort" />
            <span id="statusText">未连接</span>
            <select
              id="aiModelSelect"
              defaultValue="doubao-seed-1-8-251228"
              onChange={(event) => localStorage.setItem("ai_model", event.currentTarget.value)}
            >
              <option value="Qwen/Qwen3-VL-235B-A22B-Instruct">Qwen3-VL</option>
              <option value="Qwen/Qwen3-VL-235B-A22B-Thinking">Qwen3-VL-Think</option>
              <option value="google/gemini-3-pro-preview">Gemini 3 Pro</option>
              <option value="doubao-seed-1-8-251228">豆包 Seed</option>
              <option value="ui-tars-1.5-7b">UI-TARS 1.5 (本地)</option>
            </select>
          </div>

          <div className="panel-content active" id="aiPanelTab">
            <div className="ai-panel">
              <div className="ai-script-editor" id="aiScriptEditor">
                <div className="ctl-script-toolbar ai-script-header">
                  <div className="ctl-script-toolbar-left ai-script-header-actions">
                  </div>
                  <div className="ctl-script-toolbar-right">
                    <button className="ctl-icon-btn ctl-icon-btn--sm ai-script-header-btn ai-btn-copy" id="aiHeaderCopyBtn" onClick={() => callLegacy("aiCopySelectedSteps")} title="复制选中步骤">
                      <Copy className="ctl-icon--sm" />
                    </button>
                    <button className="ctl-icon-btn ctl-icon-btn--sm ai-script-header-btn ai-btn-save" id="aiHeaderSaveBtn" onClick={() => callLegacy("aiSaveScript")} title="保存脚本">
                      <Save className="ctl-icon--sm" />
                    </button>
                    <button className="ctl-icon-btn ctl-icon-btn--sm ai-script-header-btn ai-btn-clear" id="aiHeaderClearBtn" onClick={() => callLegacy("aiClearAllSteps")} title="清空">
                      <Trash2 className="ctl-icon--sm" />
                    </button>
                    <div style={{ position: "relative" }}>
                      <button className="ctl-icon-btn ctl-icon-btn--sm" id="aiScriptSavedBtn" onClick={() => callLegacy("aiToggleSavedScriptsPanel")} title="已保存的脚本">
                        <Folder className="ctl-icon--sm" />
                      </button>
                      <div className="ctl-popup ctl-popup--down ctl-popup--right ai-script-saved-panel" id="aiScriptSavedPanel" role="dialog" aria-label="已保存脚本">
                        <div className="ai-saved-scripts-list" id="aiSavedScriptsList" />
                      </div>
                    </div>
                    <button className="ctl-icon-btn ctl-icon-btn--sm" id="aiDetachBtn" type="button" onClick={() => callLegacy("aiToggleDetach")} title="分离面板">
                      <ExternalLink className="ctl-icon--sm ai-detach-icon ai-detach-icon--detach" />
                      <PanelRightClose className="ctl-icon--sm ai-detach-icon ai-detach-icon--attach" />
                    </button>
                  </div>
                </div>

                <input type="checkbox" id="aiSplitModeToggle" style={{ display: "none" }} />
                <div className="ai-script-split-row" id="aiScriptSplitRow">
                  <label htmlFor="aiPlanningModelSelect" title="规划模型负责任务拆解，定位模型负责元素识别">规划模型:</label>
                  <select className="ctl-select" id="aiPlanningModelSelect" title="选择规划模型" onChange={(event) => localStorage.setItem("ai_planning_model", event.currentTarget.value)}>
                    <option value="Qwen/Qwen3-VL-235B-A22B-Instruct">Qwen3-VL</option>
                    <option value="Qwen/Qwen3-VL-235B-A22B-Thinking">Qwen3-VL-Think</option>
                    <option value="google/gemini-3-pro-preview">Gemini 3 Pro</option>
                    <option value="doubao-seed-1-8-251228">豆包 Seed</option>
                    <option value="ui-tars-1.5-7b">UI-TARS 1.5 (本地)</option>
                    <option value="openai/gpt-4o">GPT-4o</option>
                    <option value="anthropic/claude-sonnet-4">Claude Sonnet 4</option>
                    <option value="anthropic/claude-sonnet-4.5">Claude Sonnet 4.5</option>
                  </select>
                </div>

                <div className="ai-script-steps-container" id="aiScriptStepsContainer">
                  <div className="ai-script-steps" id="aiScriptSteps" />
                  <div className="ai-script-empty" id="aiScriptEmpty">
                    <div className="ai-empty-hero-title">行随言动，知意代劳</div>
                    <div className="ai-script-empty-title">
                      <MousePointer2 className="ai-script-empty-icon" />
                      <span>暂无步骤</span>
                    </div>
                    <span className="ai-script-empty-sub ai-empty-typewriter" aria-label={emptyHintText}>
                      <span className="ai-empty-typewriter__text">
                        {emptyHintTyped}<span className="ai-tw-cursor" aria-hidden="true" />
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="ai-convo-wrap" id="aiConvoWrap">
                <div className="ai-input-area">
                  <div className="ai-input-wrapper" id="aiInputWrapper">
                    <div className="ai-convo-drag-handle" id="aiConvoDragHandle">
                      <div className="ai-convo-drag-bar" />
                    </div>
                    <div className="ai-chat-messages ai-convo-history" id="aiChatMessages" style={{ display: "none" }} />
                    <div className="ai-input-row">
                      <textarea
                        className="ai-input"
                        id="aiChatInput"
                        placeholder="输入指令，回车发送"
                        rows={1}
                        onKeyDown={(event) => callLegacy("aiHandleInputKeydown", (event as any).nativeEvent ?? event)}
                        onInput={(event) => callLegacy("aiAutoResizeInput", event.currentTarget)}
                      />
                    </div>
                    <div className="ai-action-bar">
                      <div className="ai-action-left">
                        <button
                          className="ctl-btn ctl-btn--xs ai-action-run-btn"
                          id="aiActionRunBtn"
                          onClick={() => callLegacy("aiToggleExecution")}
                          title="全部执行"
                        >
                          <Play className="ctl-icon--xs" />
                          执行
                        </button>
                      </div>
                      <div className="ai-action-right">
                        <button className="ai-convo-collapse-btn" id="aiConvoCollapseBtn" onClick={() => callLegacy("aiToggleConvoMaximize")} title="收起对话">
                          <ChevronDown className="ai-convo-collapse-icon" />
                        </button>
                        <button className="ai-send-btn ai-send-btn--sm" id="aiSendBtn" onClick={() => callLegacy("aiSendMessage")} title="发送">
                          <Send className="ctl-icon--sm" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>{/* ctl-body-row */}

      <div id="floatingDock" style={{ display: "none" }}>
        <button id="floatingDockTrigger" />
        <div id="floatingDockPanel" />
      </div>
    </div>
  );
}
