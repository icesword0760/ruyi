declare global {
  interface Window {
    toggleControl?: () => void;
    toggleFullscreen?: () => void;
    applyAllSettings?: () => Promise<void>;
    switchTransportMode?: () => Promise<void>;
    createNewTab?: () => Promise<void>;
    disconnect?: () => void;
    releaseInstance?: () => Promise<void>;
    clearImeHelper?: () => void;
    sendImeText?: () => void;
    __controllerHeaderActionsInstalled?: boolean;
  }
}

import { useControllerStore } from "../store/controllerStore";

// Global state from legacy stream script (script-scope `let` bindings).
// We intentionally keep the same names so behavior matches legacy.
declare let pc: RTCPeerConnection | null;
declare let dataChannel: RTCDataChannel | null;
declare let remoteControl: any;
declare let controlEnabled: boolean;
declare let mjpegSocket: WebSocket | null;
declare let isConnected: boolean;
declare let currentTransportMode: string;
declare let streamPlayerManager: any;
declare const streamStats: { reset: () => void; stopUiRefresh: () => void };

// Global functions from legacy stream script.
declare function disconnectMJPEG(): void;
declare function stopStatusPolling(): void;
declare function stopTabsPolling(): void;
declare function stopTransportModePolling(): void;
declare function stopBandwidthPolling(): void;
declare function stopCaptureModePolling(): void;
declare function updateStatus(text: string, connected: boolean): void;
declare function setPanelConnected(connected: boolean): void;
declare function refreshStatus(): Promise<void>;
declare function addLog(message: string, category?: string, type?: string): void;
declare function postJSON(url: string, body?: unknown): Promise<any>;
declare function applySettings(): Promise<void>;
declare function connect(): Promise<void>;
declare function connectMJPEG(): Promise<void>;
declare function refreshTabs(): Promise<void>;
declare function switchToTab(targetId: string): Promise<void>;
declare function updateStats(stats: Record<string, unknown>): void;
declare function syncBackendResolution(): Promise<boolean>;
declare function updateImeCharCount(): void;
declare function hideImeHelper(): void;
declare function toggleFullscreenMode(): void;

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(err);
}

export function installHeaderActionsModule() {
  if (window.__controllerHeaderActionsInstalled) return;
  window.__controllerHeaderActionsInstalled = true;

  window.toggleControl = function toggleControl() {
    if (!remoteControl) return;
    controlEnabled = !controlEnabled;
    remoteControl.toggleControl(controlEnabled);
    useControllerStore.getState().setControlEnabled(!!controlEnabled);
    const statusEl = document.getElementById("controlStatus");
    if (statusEl) {
      statusEl.textContent = controlEnabled ? "控制已启用" : "控制已禁用";
      (statusEl as HTMLElement).style.color = "";
    }
    const ctrlBtn = document.getElementById("controlToggleBtn");
    if (ctrlBtn) ctrlBtn.className = controlEnabled ? "ctl-more-item psb-ctrl-on" : "ctl-more-item psb-ctrl-off";
    const ctrlBadge = document.getElementById("controlBadge");
    if (ctrlBadge) {
      ctrlBadge.textContent = controlEnabled ? "开" : "关";
      ctrlBadge.className = controlEnabled ? "ctl-badge ctl-badge--success ctl-more-item-badge" : "ctl-badge ctl-badge--default ctl-more-item-badge";
    }
  };

  window.toggleFullscreen = function toggleFullscreen() {
    toggleFullscreenMode();
  };

  window.disconnect = function disconnect() {
    console.log("🔌 开始断开连接...");

    // Disconnect WebRTC
    if (pc) {
      pc.close();
      pc = null;
    }

    // Disconnect MJPEG/Scrcpy WebSocket
    if (mjpegSocket) {
      disconnectMJPEG();
    }

    dataChannel = null;
    controlEnabled = false;
    useControllerStore.getState().setControlEnabled(false);
    isConnected = false;
    stopStatusPolling();
    stopTabsPolling();
    stopTransportModePolling();
    stopBandwidthPolling();
    streamStats.reset();
    streamStats.stopUiRefresh();
    updateStatus("未连接", false);

    // 🔥 隐藏所有播放元素（包括H.264的canvas/video）
    const remoteVideo = document.getElementById("remoteVideo") as HTMLElement | null;
    if (remoteVideo) remoteVideo.style.display = "none";
    const remoteImage = document.getElementById("remoteImage") as HTMLElement | null;
    if (remoteImage) remoteImage.style.display = "none";

    // 隐藏H.264元素
    const h264Canvas = document.getElementById("h264Canvas") as HTMLElement | null;
    if (h264Canvas) h264Canvas.style.display = "none";
    const h264Video = document.getElementById("h264Video") as HTMLElement | null;
    if (h264Video) h264Video.style.display = "none";

    const placeholder = document.getElementById("placeholder") as HTMLElement | null;
    if (placeholder) placeholder.style.display = "block";
    const infoOverlay = document.getElementById("infoOverlay") as HTMLElement | null;
    if (infoOverlay) infoOverlay.style.display = "none";
    const toolbar = document.getElementById("toolbar") as HTMLElement | null;
    if (toolbar) toolbar.style.display = "none";
    const stats = document.getElementById("stats") as HTMLElement | null;
    if (stats) stats.style.display = "none";
    const captureModeBadge = document.getElementById("captureModeBadge") as HTMLElement | null;
    if (captureModeBadge) captureModeBadge.style.display = "none";
    const transportModeBadge = document.getElementById("transportModeBadge") as HTMLElement | null;
    if (transportModeBadge) transportModeBadge.style.display = "none";
    setPanelConnected(false);

    const tabsBar = document.getElementById("tabsBar") as HTMLElement | null;
    if (tabsBar) tabsBar.style.display = "none";
    const headerTabs = document.getElementById("headerTabs") as HTMLElement | null;
    if (headerTabs) headerTabs.style.display = "none";

    const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;
    if (connectBtn) connectBtn.disabled = false;
    const disconnectBtn = document.getElementById("disconnectBtn") as HTMLButtonElement | null;
    if (disconnectBtn) disconnectBtn.disabled = true;

    // 停止投屏模式监控
    stopCaptureModePolling();
    const reconnectBtn = document.getElementById("reconnectBtn") as HTMLElement | null;
    if (reconnectBtn) reconnectBtn.style.display = "none";

    console.log("✅ 断开连接完成");
  };

  window.releaseInstance = async function releaseInstance() {
    const ok = window.showConfirmDialog
      ? await window.showConfirmDialog("释放实例？", "这将关闭 Chrome 进程并清理所有资源。", "danger", "释放", "取消")
      : confirm("确定要释放实例吗？这将关闭Chrome进程并清理所有资源。");
    if (!ok) return;

    console.log("🗑️ 开始释放实例...");
    addLog("正在释放实例...", "系统", "info");

    try {
      // 🔥 先清理StreamPlayerManager
      if (streamPlayerManager) {
        try {
          await streamPlayerManager.destroyCurrentPlayer();
          streamPlayerManager = null; // 完全重置
          console.log("✅ StreamPlayerManager已清理");
        } catch (e) {
          console.warn("StreamPlayerManager清理失败:", e);
        }
      }

      // 断开连接
      window.disconnect?.();

      // 重置服务器端
      await postJSON("/api/session/reset");

      // 清理所有播放元素
      const remoteImage = document.getElementById("remoteImage") as HTMLImageElement | null;
      if (remoteImage && remoteImage.src && remoteImage.src.startsWith("blob:")) {
        URL.revokeObjectURL(remoteImage.src);
        remoteImage.src = "";
      }

      addLog("✅ 实例已释放", "系统", "success");
      console.log("✅ 实例释放成功");
    } catch (err) {
      console.error("释放实例失败:", err);
      addLog(`❌ 释放失败: ${errorMessage(err)}`, "系统", "error");
      const msg = "释放实例失败: " + errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("释放失败", msg);
      else alert(msg);
    } finally {
      await refreshStatus();
    }
  };

  window.applyAllSettings = async function applyAllSettings() {
    await applySettings();
    const selectedMode = (document.getElementById("transportModeSelect") as HTMLSelectElement | null)?.value;
    if (selectedMode && selectedMode !== currentTransportMode) {
      await window.switchTransportMode?.();
    }
  };

  window.switchTransportMode = async function switchTransportMode() {
    const selectedMode = (document.getElementById("transportModeSelect") as HTMLSelectElement | null)?.value;
    if (!selectedMode) return;

    const modeNames: Record<string, string> = {
      webrtc: "WebRTC (VP8编码)",
      mjpeg: "MJPEG (原始JPEG)",
      scrcpy: "Scrcpy (H.264高性能)",
    };

    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "传输", "info");
    addLog(`🔄 开始切换传输模式`, "传输", "info");
    addLog(`📍 当前模式: ${modeNames[currentTransportMode] || currentTransportMode}`, "传输", "info");
    addLog(`📍 目标模式: ${modeNames[selectedMode]}`, "传输", "info");

    if (selectedMode === currentTransportMode) {
      addLog(`⚠️ 已经是${modeNames[selectedMode]}模式，无需切换`, "传输", "warning");
      return;
    }

    // Disconnect current mode
    if (isConnected) {
      addLog(`🔌 断开当前连接...`, "传输", "info");
      if (currentTransportMode === "webrtc") {
        window.disconnect?.();
        addLog(`✅ WebRTC已断开`, "传输", "success");
      } else {
        // MJPEG和Scrcpy都使用相同的WebSocket连接
        disconnectMJPEG();
        addLog(`✅ ${modeNames[currentTransportMode]}已断开`, "传输", "success");
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Connect new mode
    addLog(`🔗 建立新连接...`, "传输", "info");
    if (selectedMode === "webrtc") {
      await connect();
      addLog(`✅ 已切换到WebRTC模式 (VP8编码, 15Mbps)`, "传输", "success");
    } else if (selectedMode === "scrcpy") {
      // Scrcpy模式：先连接MJPEG WebSocket，然后切换到H.264编码
      await connectMJPEG();
      // connectMJPEG内部会根据模式自动切换到H.264
      currentTransportMode = "scrcpy";
      addLog(`✅ 已切换到Scrcpy模式 (H.264编码, 延迟~65ms, 带宽~8Mbps)`, "Scrcpy", "success");
    } else {
      // MJPEG模式
      await connectMJPEG();
      addLog(`✅ 已切换到MJPEG模式 (原始JPEG, 质量98)`, "传输", "success");
    }
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "传输", "info");
  };

  window.createNewTab = async function createNewTab() {
    const url = window.showPromptDialog
      ? await window.showPromptDialog("新建标签页", {
          message: "请输入新标签页的 URL",
          defaultValue: "https://www.baidu.com",
          placeholder: "https://example.com",
        })
      : prompt("请输入新标签页的 URL:", "https://www.baidu.com");
    if (!url) return;

    try {
      const result = await postJSON("/api/tabs/create", { url });
      if (result?.targetId) {
        await refreshTabs();
        await switchToTab(result.targetId);
      }
    } catch (err) {
      const msg = "创建标签页失败: " + errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("创建失败", msg);
      else alert(msg);
    }
  };

  window.clearImeHelper = function clearImeHelper() {
    const imeInput = document.getElementById("imeInput") as HTMLTextAreaElement | null;
    if (imeInput) imeInput.value = "";
    updateImeCharCount();
    hideImeHelper();
  };

  window.sendImeText = function sendImeText() {
    const imeInput = document.getElementById("imeInput") as HTMLTextAreaElement | null;
    const text = imeInput ? imeInput.value : "";
    if (!text) return;

    if (remoteControl && remoteControl.isControlEnabled) {
      console.log("✓ 从辅助框发送文本:", text);
      remoteControl.sendEvent({
        type: "keydown",
        key: text,
        code: "",
        keyCode: 0,
        timestamp: Date.now(),
      });
      if (imeInput) imeInput.value = "";
      updateImeCharCount();
    } else {
      console.warn("⚠️ 远程控制未就绪，无法发送文本");
    }
  };
}
