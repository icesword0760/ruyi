// @ts-nocheck

import { MJPEGEventEncoder } from "./mjpegEventEncoder";
import { H264StreamProtocol } from "./h264StreamProtocol";
import { StreamPlayerManager } from "./streamPlayerManager";
import { RemoteControlManager } from "./remoteControlManager";
import { useControllerStore } from "../store/controllerStore";

function ensureElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function safeText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function stripLeadingLogEmoji(message: string) {
  const original = String(message ?? "");
  if (!original) return { message: original, inferredType: null as string | null };

  const trimmed = original.trimStart();
  const leading = original.slice(0, original.length - trimmed.length);

  const rules: Array<{ re: RegExp; type: string | null }> = [
    { re: /^✅\s*/u, type: "success" },
    { re: /^❌\s*/u, type: "error" },
    { re: /^⚠️?\s*/u, type: "warning" },
    { re: /^ℹ️?\s*/u, type: "info" },
    { re: /^🔴\s*/u, type: "success" },
    { re: /^⏹️?\s*/u, type: "info" },
    { re: /^▶️?\s*/u, type: "info" },
    { re: /^🔄\s*/u, type: "info" },
    { re: /^🔗\s*/u, type: "info" },
    { re: /^🔌\s*/u, type: "info" },
    { re: /^📺\s*/u, type: "info" },
    { re: /^📍\s*/u, type: "info" },
    { re: /^📊\s*/u, type: "info" },
    { re: /^📥\s*/u, type: "info" },
    { re: /^🚀\s*/u, type: "info" },
    { re: /^🎬\s*/u, type: "info" },
    { re: /^🆕\s*/u, type: "info" },
    { re: /^🔧\s*/u, type: "info" },
    { re: /^🔤\s*/u, type: "info" },
    { re: /^✏️?\s*/u, type: "info" },
    { re: /^💾\s*/u, type: "success" },
    { re: /^📂\s*/u, type: "info" },
    { re: /^📤\s*/u, type: "info" },
    { re: /^🗑️?\s*/u, type: "info" },
    { re: /^🤖\s*/u, type: "info" },
    { re: /^💡\s*/u, type: "info" },
  ];

  for (const { re, type } of rules) {
    if (re.test(trimmed)) {
      return { message: leading + trimmed.replace(re, ""), inferredType: type };
    }
  }
  return { message: original, inferredType: null as string | null };
}

export function initStreamCore() {
  if (window.__controllerNewAppInitialized) return;

  // Mark early to avoid double-init if React strict mode remounts.
  window.__controllerNewAppInitialized = true;

  // -----------------------------
  // Capture helper (AI enrichment)
  // -----------------------------
  window.captureMjpegFrame = function captureMjpegFrame() {
    const img =
      (typeof streamPlayerManager !== "undefined" && streamPlayerManager?.mjpegImage) || (document.getElementById("remoteImage") as any);
    if (!img) {
      console.warn("[captureMjpegFrame] img 元素未找到");
      return null;
    }
    if (!img.src) {
      console.warn("[captureMjpegFrame] img.src 为空");
      return null;
    }
    if (!img.naturalWidth) {
      console.warn("[captureMjpegFrame] img.naturalWidth=0, 帧未加载");
      return null;
    }
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const b64 = c.toDataURL("image/jpeg", 0.9).split(",")[1];
      console.log(
        `[captureMjpegFrame] 成功: ${img.naturalWidth}x${img.naturalHeight}, ${(b64.length / 1024).toFixed(0)}KB`,
      );
      return b64;
    } catch (e) {
      console.error("[captureMjpegFrame] canvas 绘制失败:", e);
      return null;
    }
  };

  // -----------------------------
  // Stream stats (FPS/BW EWMA)
  // -----------------------------
  streamStats = {
    _timer: null,
    _lastFrameTime: 0,
    _recentBytes: [],
    _recentTimes: [],
    _windowMs: 3000,
    _ewmaFps: 0,
    _ewmaBw: 0,
    _alpha: 0.3,

    recordFrame(byteLength: number) {
      const now = performance.now();
      this._lastFrameTime = now;
      this._recentTimes.push(now);
      this._recentBytes.push(byteLength);
      this._prune(now);
    },

    _prune(now: number) {
      const cutoff = now - this._windowMs;
      while (this._recentTimes.length && this._recentTimes[0] < cutoff) {
        this._recentTimes.shift();
        this._recentBytes.shift();
      }
    },

    _calcInstantFps() {
      const now = performance.now();
      this._prune(now);
      const n = this._recentTimes.length;
      if (n < 2) {
        if (!this._lastFrameTime || now - this._lastFrameTime > this._windowMs) return 0;
        return this._ewmaFps;
      }
      const span = this._recentTimes[n - 1] - this._recentTimes[0];
      return span > 0 ? ((n - 1) / span) * 1000 : 0;
    },

    _calcInstantBw() {
      const now = performance.now();
      this._prune(now);
      if (!this._recentBytes.length) {
        if (!this._lastFrameTime || now - this._lastFrameTime > this._windowMs) return 0;
        return this._ewmaBw;
      }
      const total = this._recentBytes.reduce((s: number, b: number) => s + b, 0);
      const span = Math.min(this._windowMs, now - (this._recentTimes[0] || now)) || this._windowMs;
      return (total / (span / 1000)) * 8;
    },

    reset() {
      this._recentTimes.length = 0;
      this._recentBytes.length = 0;
      this._ewmaFps = 0;
      this._ewmaBw = 0;
      this._lastFrameTime = 0;
    },

    startUiRefresh() {
      if (this._timer) return;
      this._timer = setInterval(() => this._refreshUi(), 500);
    },

    stopUiRefresh() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      safeText("fps", "-");
      safeText("bandwidth", "-");
      useControllerStore.getState().setStats({ fpsText: "-", bandwidthText: "-" });
    },

    _refreshUi() {
      const instantFps = this._calcInstantFps();
      const instantBw = this._calcInstantBw();

      this._ewmaFps = this._ewmaFps === 0 ? instantFps : this._alpha * instantFps + (1 - this._alpha) * this._ewmaFps;
      this._ewmaBw = this._ewmaBw === 0 ? instantBw : this._alpha * instantBw + (1 - this._alpha) * this._ewmaBw;

      if (this._ewmaFps < 0.3) this._ewmaFps = 0;
      if (this._ewmaBw < 100) this._ewmaBw = 0;

      const fpsEl = document.getElementById("fps");
      const bwEl = document.getElementById("bandwidth");
      const fpsText = this._ewmaFps > 0 ? this._ewmaFps.toFixed(1) : "0";
      const bandwidthText = this._ewmaBw > 0 ? this._formatBw(this._ewmaBw) : "0 Kbps";
      if (fpsEl) fpsEl.textContent = fpsText;
      if (bwEl) bwEl.textContent = bandwidthText;
      useControllerStore.getState().setStats({ fpsText, bandwidthText });
    },

    _formatBw(bps: number) {
      if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " Mbps";
      if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " Kbps";
      return bps.toFixed(0) + " bps";
    },
  };

  // -----------------------------
  // Default helpers (stubbable)
  // -----------------------------
  if (!window.postJSON) {
    window.postJSON = async (url: string, body?: any) => {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        let message = "请求失败";
        try {
          const error = await response.json();
          if (error?.error) message = error.error;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      return response.json();
    };
  }

  if (!window.addLog) {
    window.addLog = (message: string, category = "INFO", type = "info") => {
      const logContent = document.getElementById("logContent");
      if (!logContent) return;

      const timeStr = formatTime();
      const stripped = stripLeadingLogEmoji(message);
      const inferredType = stripped.inferredType;
      const nextType = String(type || "info").toLowerCase();
      const effectiveType = nextType === "info" && inferredType ? inferredType : nextType;

      const logEntry = document.createElement("div");
      logEntry.className = `log-entry ${effectiveType}`;

      const timeEl = document.createElement("span");
      timeEl.className = "log-time";
      timeEl.textContent = timeStr;

      const catEl = document.createElement("span");
      catEl.className = "log-category";
      catEl.textContent = `[${category}]`;

      const msgEl = document.createElement("span");
      msgEl.textContent = stripped.message;

      logEntry.appendChild(timeEl);
      logEntry.appendChild(catEl);
      logEntry.appendChild(msgEl);
      logContent.appendChild(logEntry);

      try {
        logEntries.push({ time: timeStr, category, message: stripped.message, type: effectiveType });
        while (logEntries.length > 500) logEntries.shift();
      } catch {
        // ignore
      }

      if (autoScroll) logContent.scrollTop = logContent.scrollHeight;
    };
  }

  if (!window.clearLogs) {
    window.clearLogs = () => {
      const logContent = document.getElementById("logContent");
      if (logContent) logContent.innerHTML = "";
      try {
        logEntries = [];
      } catch {
        // ignore
      }
      window.addLog?.("日志已清空", "系统", "info");
    };
  }

  if (!window.downloadLogs) {
    window.downloadLogs = () => {
      try {
        const content = (logEntries || [])
          .map((e: any) => `${e.time || ""} [${e.category || ""}] ${e.message || ""}`)
          .join("\n");
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `webrtc-logs-${new Date().toISOString()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        window.addLog?.("日志已导出", "系统", "success");
      } catch (err) {
        window.addLog?.("日志导出失败: " + String(err), "系统", "error");
      }
    };
  }

  if (!window.toggleAutoScroll) {
    window.toggleAutoScroll = () => {
      try {
        autoScroll = !autoScroll;
      } catch {
        // ignore
      }
      const btn = document.getElementById("autoScrollBtn");
      if (btn) btn.textContent = `自动滚动: ${autoScroll ? "开" : "关"}`;
      window.addLog?.(`自动滚动已${autoScroll ? "开启" : "关闭"}`, "系统", "info");
    };
  }

  if (!window.addDebugLog) {
    window.addDebugLog = (message: string, type = "info") => {
      const now = new Date();
      const time =
        now.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
        "." +
        String(now.getMilliseconds()).padStart(3, "0");
      const debugContent = document.getElementById("debugLogContent");
      if (!debugContent) return;

      const kind = String(type || "info").toLowerCase();

      const logEntry = document.createElement("div");
      logEntry.className = "log-entry debug";
      if (kind === "success" || kind === "warning" || kind === "error") logEntry.classList.add(kind);
      else logEntry.classList.add("info");
      logEntry.dataset.debugType = kind;

      const timeEl = document.createElement("span");
      timeEl.className = "log-time";
      timeEl.textContent = time;

      const catEl = document.createElement("span");
      catEl.className = "log-category";
      catEl.textContent = `[${kind.toUpperCase()}]`;

      const msgEl = document.createElement("span");
      msgEl.textContent = stripLeadingLogEmoji(String(message ?? "")).message;

      logEntry.appendChild(timeEl);
      logEntry.appendChild(catEl);
      logEntry.appendChild(msgEl);
      debugContent.appendChild(logEntry);

      while (debugContent.children.length > 200) {
        debugContent.removeChild(debugContent.firstChild!);
      }
      if (autoScroll) debugContent.scrollTop = debugContent.scrollHeight;
    };
  }

  if (!window.clearDebugLog) {
    window.clearDebugLog = () => {
      const debugContent = document.getElementById("debugLogContent");
      if (debugContent) debugContent.innerHTML = "";
      window.addDebugLog?.("日志已清空", "info");
    };
  }

  if (!window.updateStats) {
    window.updateStats = (stats: any) => {
      if (stats?.resolution) safeText("statResolution", String(stats.resolution));
      if (stats?.fps !== undefined && stats?.fps !== null) safeText("statFPS", String(stats.fps) + " fps");
      if (stats?.bitrate) safeText("statBitrate", (Number(stats.bitrate) / 1000000).toFixed(1) + " Mbps");
      if (stats?.connection) safeText("statConnection", String(stats.connection));
      if (stats?.quality !== undefined && stats?.quality !== null) safeText("statQuality", String(stats.quality));
      if (stats?.codec) safeText("statCodec", String(stats.codec));
    };
  }

  // -----------------------------
  // UI helpers
  // -----------------------------
  window.updateStatus = function updateStatus(text: string, active = false) {
    safeText("statusText", text);
    useControllerStore.getState().setStatusText(text);
    useControllerStore.getState().setConnected(!!active);

    const shortText = active && text.startsWith("已连接") ? "已连接" : text;
    const infoStatus = document.getElementById("infoStatus");
    if (infoStatus) {
      infoStatus.textContent = shortText;
      infoStatus.title = text !== shortText ? text : "";
      infoStatus.classList.toggle("psb-conn", !!active);
      infoStatus.classList.toggle("psb-disconn", !active);
    }

    const statusDot = document.getElementById("statusDot");
    if (statusDot) statusDot.classList.toggle("active", !!active);

    const logType = active ? "success" : text.includes("失败") || text.includes("错误") ? "error" : "info";
    window.addLog?.(`连接状态: ${text}`, "WebRTC", logType);
    window.updateStats?.({ connection: text });
  };

  window.setPanelConnected = function setPanelConnected(connected: boolean) {
    useControllerStore.getState().setConnected(!!connected);
    const psb = document.getElementById("panelStatusBar");
    if (!psb) return;
    psb.classList.toggle("psb-disconnected", !connected);
    psb.classList.toggle("psb-connected", !!connected);
    if (!connected) {
      ["infoRoomId", "psbTransport", "debugPort", "fps", "bandwidth"].forEach((id) => safeText(id, "-"));
      const roomEl = document.getElementById("infoRoomId");
      if (roomEl) (roomEl as HTMLElement).title = "-";
      useControllerStore.getState().setCurrentUrl("-");
      useControllerStore.getState().setStats({ fpsText: "-", bandwidthText: "-" });
    }
  };

  // -----------------------------
  // StreamPlayerManager
  // -----------------------------
  async function initStreamPlayerManager() {
    const container = document.querySelector(".video-container") as HTMLElement | null;
    if (!container) throw new Error("video-container元素不存在");
    if (!streamPlayerManager) {
      streamPlayerManager = new StreamPlayerManager(container);
      console.log("✅ StreamPlayerManager已初始化", {
        container: container.className,
        capabilities: streamPlayerManager.capabilities,
      });
      const recommended = streamPlayerManager.getRecommendedMode();
      console.log(`💡 推荐模式: ${recommended.mode} (${recommended.reason})`);
    }
    return streamPlayerManager;
  }

  // Expose for legacy callers / debugging.
  (window as any).initStreamPlayerManager = initStreamPlayerManager;

  // -----------------------------
  // Panel tab switching (AI uses this for record-to-script UX)
  // -----------------------------
  window.switchPanelTab = function switchPanelTab(tabName: string) {
    const root = document.documentElement;
    const logDrawer = document.getElementById("logPanelTab");

    const setLogDrawerOpen = (open: boolean) => {
      root.classList.toggle("ctl-log-open", open);
      if (logDrawer) {
        logDrawer.classList.toggle("active", open);
        logDrawer.setAttribute("aria-hidden", open ? "false" : "true");
      }
    };

    if (tabName === "log") {
      setLogDrawerOpen(true);
      return;
    }
    if (tabName === "ai") {
      setLogDrawerOpen(false);
      return;
    }

    // Legacy fallback: keep old behavior if any other tab exists.
    document.querySelectorAll(".panel-tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".panel-content").forEach((content) => content.classList.remove("active"));
    // Only match panel tabs (avoid accidentally matching settings tabs which also use `data-tab="ai"`).
    const tabBtn = document.querySelector(`.panel-tab[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.classList.add("active");
    const panel = document.getElementById(`${tabName}PanelTab`);
    if (panel) panel.classList.add("active");
  };

  // -----------------------------
  // Polling
  // -----------------------------
  window.startStatusPolling = function startStatusPolling() {
    window.stopStatusPolling?.();
    window.refreshStatus?.().catch(() => {});
    statusTimer = setInterval(() => window.refreshStatus?.().catch(() => {}), 5000);
  };

  window.stopStatusPolling = function stopStatusPolling() {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  };

  window.startTabsPolling = function startTabsPolling() {
    window.stopTabsPolling?.();
    tabsPollingInterval = setInterval(() => {
      if (isConnected) window.refreshTabs?.();
    }, 3000);
  };

  window.stopTabsPolling = function stopTabsPolling() {
    if (tabsPollingInterval) {
      clearInterval(tabsPollingInterval);
      tabsPollingInterval = null;
    }
  };

  window.startTransportModePolling = function startTransportModePolling() {
    window.stopTransportModePolling?.();
    void updateTransportModeTag();
    transportModePollingInterval = setInterval(updateTransportModeTag, 2000);
  };

  window.stopTransportModePolling = function stopTransportModePolling() {
    if (transportModePollingInterval) {
      clearInterval(transportModePollingInterval);
      transportModePollingInterval = null;
    }
  };

  async function updateTransportModeTag() {
    try {
      const response = await fetch("/api/session/transport_mode");
      const data = await response.json();
      const psbTransport = document.getElementById("psbTransport");
      if (data.mode === "mjpeg") {
        if (psbTransport) psbTransport.textContent = `MJPEG(${data.mjpeg_clients}客户端)`;
      } else if (data.mode === "webrtc") {
        if (psbTransport) psbTransport.textContent = "WebRTC(VP8)";
      } else {
        if (psbTransport) psbTransport.textContent = "-";
      }
    } catch (error) {
      console.error("Failed to fetch transport mode:", error);
    }
  }

  // Bandwidth polling is legacy no-op (client-side streamStats drives header).
  window.startBandwidthPolling = function startBandwidthPolling() {};
  window.stopBandwidthPolling = function stopBandwidthPolling() {};

  window.startCaptureModePolling = function startCaptureModePolling() {
    window.stopCaptureModePolling?.();
    captureModeTimer = setInterval(async () => {
      try {
        const resp = await fetch("/api/session/capture_mode");
        const data = await resp.json();
        const badge = document.getElementById("captureModeBadge") as HTMLElement | null;
        const valueEl = document.getElementById("captureModeValue");
        const detailEl = document.getElementById("captureModeDetail");
        if (badge) badge.style.display = "block";
        if (valueEl) valueEl.textContent = data.mode || "未知";
        if (detailEl) detailEl.textContent = data.detail || "";
      } catch (err) {
        console.error("Failed to fetch capture mode:", err);
      }
    }, 1000);
  };

  window.stopCaptureModePolling = function stopCaptureModePolling() {
    if (captureModeTimer) {
      clearInterval(captureModeTimer);
      captureModeTimer = null;
    }
  };

  // -----------------------------
  // Settings / status
  // -----------------------------
  window.setCurrentUrl = window.setCurrentUrl || ((url: string) => {
    const el = document.getElementById("infoRoomId");
    if (!el) return;
    const u = url || "-";
    el.textContent = u;
    (el as HTMLElement).title = u;
    useControllerStore.getState().setCurrentUrl(u);
  });

  window.refreshStatus = async function refreshStatus() {
    const resp = await fetch("/api/session/status");
    if (!resp.ok) return;
    const status = await resp.json();
    window.setCurrentUrl?.(status.currentUrl);
    safeText("debugPort", String(status.remoteDebuggingPort ?? "-"));

    // Sync backend resolution hints for control coordinate mapping.
    if (status.viewportWidth && status.viewportHeight) {
      window.backendResolution = { width: status.viewportWidth, height: status.viewportHeight };
    }
  };

  window.syncBackendResolution = async function syncBackendResolution() {
    try {
      const response = await fetch("/api/session/status");
      const status = await response.json();
      if (status.viewportWidth && status.viewportHeight) {
        window.backendResolution = { width: status.viewportWidth, height: status.viewportHeight };
        console.log(`🔄 [分辨率同步] 已更新: ${status.viewportWidth}x${status.viewportHeight}`);
        return true;
      }
    } catch (err) {
      console.error("Failed to sync backend resolution:", err);
    }
    return false;
  };

  window.applySettings = async function applySettings() {
    const fps = parseInt((document.getElementById("fpsSelect") as HTMLSelectElement | null)?.value || "30", 10);
    const quality = parseInt((document.getElementById("qualitySelect") as HTMLSelectElement | null)?.value || "98", 10);
    const resolution = (document.getElementById("resolutionSelect") as HTMLSelectElement | null)?.value || "1920x1080";
    const [width, height] = resolution.split("x").map((v) => parseInt(v, 10));

    try {
      localStorage.setItem("ctl_fps", String(fps));
      localStorage.setItem("ctl_quality", String(quality));
      localStorage.setItem("ctl_resolution", resolution);

      window.addLog?.(`应用设置: ${fps}fps, 质量${quality}, 分辨率${resolution}`, "设置", "info");

      window.backendResolution = { width, height };
      console.log(`🔧 [分辨率] 更新全局变量: ${width}x${height}`);

      const transportMode = (document.getElementById("transportModeSelect") as HTMLSelectElement | null)?.value || "mjpeg";
      localStorage.setItem("ctl_transport_mode", transportMode);
      const encoding_mode = transportMode === "scrcpy" ? "h264" : "mjpeg";

      await window.postJSON?.("/api/session/settings", { fps, quality, width, height, encoding_mode });
      window.updateStats?.({ fps, quality, resolution });
      window.addLog?.(`✅ 设置已应用: 分辨率${resolution}, ${fps}fps, 质量${quality}`, "设置", "success");

      setTimeout(() => window.syncBackendResolution?.(), 500);
    } catch (err: any) {
      window.addLog?.(`❌ 设置失败: ${err?.message || String(err)}`, "设置", "error");
      console.error("Failed to apply settings:", err);
    }
  };

  // -----------------------------
  // AI model defaults (legacy helper used by aiCore)
  // -----------------------------
  const AI_MODELS = [
    { value: "Qwen/Qwen3-VL-235B-A22B-Instruct", label: "Qwen3-VL" },
    { value: "Qwen/Qwen3-VL-235B-A22B-Thinking", label: "Qwen3-VL-Think" },
    { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { value: "doubao-seed-1-8-251228", label: "豆包 Seed" },
    { value: "ui-tars-1.5-7b", label: "UI-TARS 1.5 (本地)" },
  ];

  function selectModel(value: string) {
    const sel = document.getElementById("aiModelSelect") as HTMLSelectElement | null;
    if (sel) sel.value = value;
    localStorage.setItem("ai_model", value);
    const settingsSel = document.getElementById("settingsAiModelSelect") as HTMLSelectElement | null;
    if (settingsSel) settingsSel.value = value;
  }

  (window as any).initModelBtn = function initModelBtn() {
    const saved = localStorage.getItem("ai_model");
    const model =
      AI_MODELS.find((m) => m.value === saved) ||
      AI_MODELS.find((m) => m.value === "doubao-seed-1-8-251228") ||
      AI_MODELS[0];
    if (model) selectModel(model.value);
  };

  // -----------------------------
  // Fullscreen
  // -----------------------------
  window.toggleFullscreenMode = function toggleFullscreenMode() {
    const fullscreenTarget = (document.querySelector(".video-container") as any) || (document.getElementById("root") as any) || (document.documentElement as any);

    if (!document.fullscreenElement) {
      if (fullscreenTarget.requestFullscreen) fullscreenTarget.requestFullscreen();
      else if (fullscreenTarget.webkitRequestFullscreen) fullscreenTarget.webkitRequestFullscreen();
      else if (fullscreenTarget.mozRequestFullScreen) fullscreenTarget.mozRequestFullScreen();
      else if (fullscreenTarget.msRequestFullscreen) fullscreenTarget.msRequestFullscreen();
      console.log("进入全屏模式");
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
      else if ((document as any).mozCancelFullScreen) (document as any).mozCancelFullScreen();
      else if ((document as any).msExitFullscreen) (document as any).msExitFullscreen();
      console.log("退出全屏模式");
    }

    setTimeout(() => window.syncBackendResolution?.(), 100);
  };

  async function handleFullscreenChange() {
    const isFullscreen = !!document.fullscreenElement;
    console.log(`🖥️ 全屏状态变化: ${isFullscreen ? "进入全屏" : "退出全屏"}`);
    document.documentElement.classList.toggle("ctl-is-fullscreen", isFullscreen);

    await new Promise((r) => setTimeout(r, 100));
    await window.syncBackendResolution?.();
    await new Promise((r) => setTimeout(r, 300));
    await window.syncBackendResolution?.();
    await new Promise((r) => setTimeout(r, 500));
    await window.syncBackendResolution?.();
    console.log("✅ 全屏切换同步完成");
  }

  document.addEventListener("fullscreenchange", () => void handleFullscreenChange());
  document.addEventListener("webkitfullscreenchange", () => void handleFullscreenChange());

  // -----------------------------
  // Remote control init
  // -----------------------------
  function initializeRemoteControl(videoElement: HTMLElement, options: any = {}) {
    console.log("🔧 [initializeRemoteControl] 开始初始化...");

    if (!remoteControl) remoteControl = new RemoteControlManager();
    remoteControl.initController(dataChannel, videoElement, options);
    remoteControl.toggleControl(true);
    controlEnabled = true;

    const status = document.getElementById("controlStatus");
    if (status) {
      status.textContent = "控制已启用";
      (status as HTMLElement).style.color = "";
    }
    const ctrlBtn = document.getElementById("controlToggleBtn");
    if (ctrlBtn) (ctrlBtn as HTMLElement).className = "ctl-more-item psb-ctrl-on";
  }

  // -----------------------------
  // WebRTC connect
  // -----------------------------
  const rtcConfig = { iceServers: [], iceCandidatePoolSize: 1 };

  async function waitForIceGatheringComplete(connection: RTCPeerConnection) {
    if (connection.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      function checkState() {
        if (connection.iceGatheringState === "complete") {
          connection.removeEventListener("icegatheringstatechange", checkState);
          resolve();
        }
      }
      connection.addEventListener("icegatheringstatechange", checkState);
    });
  }

  window.connect = async function connect() {
    if (isConnected) return;

    window.addLog?.("━━━━━━━━━━━━━━━━━━━━━━━━━━━", "WebRTC", "info");
    window.addLog?.("🔗 开始建立WebRTC连接...", "WebRTC", "info");
    window.addLog?.("📺 传输模式: WebRTC (VP8编码)", "WebRTC", "info");
    const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;
    if (connectBtn) connectBtn.disabled = true;
    window.updateStatus?.("正在建立WebRTC会话...", true);

    pc = new RTCPeerConnection(rtcConfig);
    pc.addTransceiver("video", { direction: "recvonly" });

    const remoteVideo = ensureElement("remoteVideo") as HTMLVideoElement;
    pc.ontrack = (event: any) => {
      window.addLog?.("接收到视频轨道", "视频流", "success");
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.style.display = "block";
      (ensureElement("remoteImage") as HTMLElement).style.display = "none";
      (ensureElement("placeholder") as HTMLElement).style.display = "none";
      safeText("infoResolution", "-");
      window.setPanelConnected?.(true);

      window.startCaptureModePolling?.();

      const playPromise = remoteVideo.play();
      if (playPromise) playPromise.catch(() => remoteVideo.play());

      remoteVideo.onloadedmetadata = () => {
        const resolution = `${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`;
        safeText("infoResolution", resolution || "-");
        window.addLog?.(`视频分辨率: ${resolution}`, "视频流", "success");
        window.updateStats?.({ resolution });
      };
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc!.iceConnectionState;
      window.addLog?.(`ICE连接状态: ${state}`, "ICE", "info");
      if (state === "connected") {
        window.updateStatus?.("已连接", false);
        const reconnectBtn = document.getElementById("reconnectBtn") as HTMLElement | null;
        if (reconnectBtn) reconnectBtn.style.display = "none";
        window.addLog?.("ICE连接建立成功", "ICE", "success");
      } else if (state === "disconnected") {
        window.updateStatus?.("连接断开，尝试重连...", true);
        window.addLog?.("ICE连接断开，准备自动重连", "ICE", "warning");
        setTimeout(() => {
          if (pc && pc.iceConnectionState === "disconnected") {
            window.addLog?.("执行自动重连...", "ICE", "info");
            void window.reconnect?.();
          }
        }, 2000);
      } else if (state === "failed") {
        window.updateStatus?.("连接失败", false);
        const reconnectBtn = document.getElementById("reconnectBtn") as HTMLElement | null;
        if (reconnectBtn) reconnectBtn.style.display = "inline-block";
        window.addLog?.("ICE连接失败", "ICE", "error");
        window.alert?.('WebRTC 连接失败，请点击"重新连接"按钮或检查网络/防火墙设置');
      }
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === "connected") {
        window.updateStatus?.("已连接", true);
        isConnected = true;
        const disconnectBtn = document.getElementById("disconnectBtn") as HTMLButtonElement | null;
        if (disconnectBtn) disconnectBtn.disabled = false;
        const reconnectBtn = document.getElementById("reconnectBtn") as HTMLElement | null;
        if (reconnectBtn) reconnectBtn.style.display = "none";
        window.startStatusPolling?.();
        window.startTabsPolling?.();
        streamStats.reset();
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        window.updateStatus?.(pc.connectionState === "failed" ? "连接失败" : "连接断开", false);
        const reconnectBtn = document.getElementById("reconnectBtn") as HTMLElement | null;
        if (reconnectBtn) reconnectBtn.style.display = "inline-block";
      }
    };

    dataChannel = pc.createDataChannel("control", { ordered: true, maxRetransmits: 1 });
    dataChannel.onopen = () => initializeRemoteControl(remoteVideo);
    dataChannel.onclose = () => {
      if (remoteControl) remoteControl.toggleControl(false);
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      const answer = await window.postJSON?.("/api/webrtc/offer", pc.localDescription);
      await pc.setRemoteDescription(answer);

      await window.refreshStatus?.();
      await window.refreshTabs?.();
      await window.postJSON?.("/api/session/settings", {});
      window.startTransportModePolling?.();

      window.addLog?.("✅ WebRTC连接建立成功！", "WebRTC", "success");
      window.addLog?.("━━━━━━━━━━━━━━━━━━━━━━━━━━━", "WebRTC", "info");

      void window.syncBackendResolution?.();
    } catch (err: any) {
      window.addLog?.(`连接失败: ${err?.message || String(err)}`, "WebRTC", "error");
      window.alert?.(err?.message || String(err));
      await window.disconnect?.();
    }
  };

  window.reconnect = async function reconnect() {
    window.updateStatus?.("正在重连...", true);
    await window.disconnect?.();
    await new Promise((r) => setTimeout(r, 1000));
    await window.connect?.();
  };

  // -----------------------------
  // MJPEG / Scrcpy connect
  // -----------------------------
  window.disconnectMJPEG = function disconnectMJPEG() {
    try {
      if (mjpegSocket) {
        mjpegSocket.onopen = null;
        mjpegSocket.onmessage = null;
        mjpegSocket.onerror = null;
        mjpegSocket.onclose = null;
        mjpegSocket.close();
      }
    } catch {
      // ignore
    } finally {
      mjpegSocket = null;
    }
  };

  function handleH264Message(buffer: ArrayBuffer) {
    try {
      const { type, payload } = H264StreamProtocol.unpackMessage(buffer);
      if (type === 0x02) {
        if (streamPlayerManager && streamPlayerManager.currentPlayer) {
          streamPlayerManager.receiveInitData(payload);
        }
      } else if (type === 0x01) {
        const { h264Data, pts, isKeyframe } = H264StreamProtocol.unpackVideoFrame(buffer);
        h264FrameCount++;
        streamStats.recordFrame(h264Data.byteLength);
        h264LastFrameTime = Date.now();
        if (streamPlayerManager && streamPlayerManager.currentPlayer) {
          streamPlayerManager.receiveFrame(h264Data, pts, isKeyframe);
        }
      }
    } catch (error) {
      console.error("❌ 处理H.264消息失败:", error);
    }
  }

  // Recording state (legacy kept these in module scope; we keep them in this init closure).
  let isRecording = false;
  let recordingStartTime = 0;
  let currentSteps: any[] = [];
  let stepCounter = 0;
  let currentRecordingId: string | null = null;

  function addRecordingStepFromRemote(step: any) {
    const metadata = step?._metadata || {};
    const number = metadata.step_number || metadata.number || step?.number || stepCounter + 1;
    stepCounter = number;
    currentSteps.push(step);
    console.log(`📝 录制步骤 #${number}: ${metadata.description || step?.description || step?.type}`);
  }

  function handleRecordingMessage(message: any) {
    if (!message || typeof message !== "object") return;

    console.log("🎬 收到录制消息:", message.type, message);
    window.addDebugLog?.(`🎬 handleRecordingMessage: type=${message.type}`, "info");

    if (message.type === "RECORDING_STARTED") {
      isRecording = true;
      stepCounter = 0;
      currentSteps = [];
      recordingStartTime = Date.now();
      currentRecordingId = message.recording_id;
      console.log(`🔴 录制开始: recording_id=${message.recording_id}`);
      window.addLog?.("🔴 远程开始录制", "录制", "success");
      return;
    }

    if (message.type === "NEW_STEP") {
      const step = message.step;
      addRecordingStepFromRemote(step);

      // Sync to AI script editor if enabled.
      if (window.isRecordingToScript) {
        const scriptStep = window.recordingStepToScriptStep?.(step);
        if (scriptStep) {
          window.aiAddStepToScript?.(scriptStep);
          console.log(
            `[录制enrichment] 步骤: "${scriptStep.description}", coords:`,
            scriptStep.coordinates,
            ", locators:",
            Object.keys(scriptStep.locators || {}),
          );

          const serverFrame = step?._frame_base64;
          const frame = serverFrame || window.captureMjpegFrame?.();
          if (serverFrame) console.log(`[录制enrichment] 使用服务端帧快照 (${(serverFrame.length / 1024).toFixed(0)}KB)`);
          if (frame && scriptStep.coordinates) {
            console.log(`[录制enrichment] 开始异步 enrichment (frame=${(frame.length / 1024).toFixed(0)}KB)`);
            window.enrichRecordingStep?.(scriptStep, frame);
          } else if (!frame) {
            console.warn("[录制enrichment] MJPEG帧捕获失败，跳过 enrichment");
          } else {
            console.warn("[录制enrichment] 步骤无坐标，跳过 enrichment");
          }
        }
      }
      return;
    }

    if (message.type === "RECORDING_STOPPED") {
      isRecording = false;
      if (window.isRecordingToScript) {
        window.isRecordingToScript = false;
        window.updateRecordToScriptBtn?.();
        window.showToast?.("录制已完成", "success");
      }
      window.addLog?.(`⏹️ 远程停止录制，共 ${message.steps || currentSteps.length} 步骤`, "录制", "success");
    }
  }

  window.connectMJPEG = async function connectMJPEG() {
    if (mjpegSocket && mjpegSocket.readyState === WebSocket.OPEN) {
      window.addLog?.("MJPEG已连接", "MJPEG", "info");
      return;
    }

    window.addLog?.("正在建立MJPEG连接...", "MJPEG", "info");

    const wsUrl = "ws://" + window.location.hostname + ":5567";
    mjpegSocket = new WebSocket(wsUrl);
    mjpegSocket.binaryType = "arraybuffer";

    mjpegSocket.onopen = async () => {
      const selectedTransport = (document.getElementById("transportModeSelect") as HTMLSelectElement | null)?.value || "mjpeg";
      const isScrcpyMode = selectedTransport === "scrcpy";
      const modeToSet = isScrcpyMode ? "scrcpy" : selectedTransport;
      mjpegSocket!.send(JSON.stringify({ type: "switch_mode", mode: modeToSet }));

      if (USE_BINARY_EVENTS) {
        binaryEventEncoder = new MJPEGEventEncoder();
        (window as any).binaryEventEncoder = binaryEventEncoder;
        (window as any).USE_BINARY_EVENTS = USE_BINARY_EVENTS;
        window.addLog?.("✅ 二进制事件协议已启用（-70%带宽, -60%延迟）", "Optimizer", "success");
      } else {
        binaryEventEncoder = null;
        (window as any).binaryEventEncoder = null;
      }

      if (!streamPlayerManager) await initStreamPlayerManager();

      const finalMode = isScrcpyMode ? "h264" : "mjpeg";
      try {
        await streamPlayerManager.switchMode(finalMode);
        currentEncodingMode = finalMode;
        mjpegSocket!.send(JSON.stringify({ type: "switch_mode", mode: finalMode }));
      } catch (error: any) {
        console.error("❌ 播放器初始化失败:", error);
        currentEncodingMode = "mjpeg";
        await streamPlayerManager.switchMode("mjpeg");
        mjpegSocket!.send(JSON.stringify({ type: "switch_mode", mode: "mjpeg" }));
      }

      // Ensure CDP is up (legacy behavior).
      try {
        const statusResp = await fetch("/api/session/status");
        if (statusResp.ok) {
          const status = await statusResp.json();
          if (!status.chromeRunning || !status.sessionActive) {
            window.addLog?.("🚀 启动Chrome和CDP...", "系统", "info");
            const navResp = await fetch("/api/session/navigate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: status.defaultUrl || "https://testerhome.com/" }),
            });
            if (navResp.ok) window.addLog?.("✅ CDP已启动，开始推流", "系统", "success");
            else window.addLog?.("⚠️ CDP启动失败", "系统", "warning");
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            window.addLog?.("✅ CDP已就绪", "系统", "success");
          }
        }
      } catch (err: any) {
        console.error("启动CDP失败:", err);
        window.addLog?.("⚠️ CDP状态检查失败: " + (err?.message || String(err)), "系统", "warning");
      }

      window.addLog?.(`📊 等待接收${String(currentEncodingMode).toUpperCase()}帧...`, String(currentEncodingMode).toUpperCase(), "info");

      isConnected = true;
      currentTransportMode = isScrcpyMode ? "scrcpy" : "mjpeg";
      window.updateStatus?.(`已连接 (${isScrcpyMode ? "Scrcpy" : "MJPEG"})`, true);

      const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;
      const disconnectBtn = document.getElementById("disconnectBtn") as HTMLButtonElement | null;
      if (connectBtn) connectBtn.disabled = true;
      if (disconnectBtn) disconnectBtn.disabled = false;

      // Show player element and init control.
      (ensureElement("placeholder") as HTMLElement).style.display = "none";
      (ensureElement("remoteVideo") as HTMLElement).style.display = "none";
      const stats = document.getElementById("stats") as HTMLElement | null;
      if (stats) stats.style.display = "none";
      const playerElement = streamPlayerManager.getPlayerElement();
      if (playerElement) (playerElement as HTMLElement).style.display = "block";

      mjpegFrameCount = 0;
      mjpegLastFrameTime = Date.now();
      h264FrameCount = 0;
      h264LastFrameTime = Date.now();
      streamStats.reset();
      streamStats.startUiRefresh();

      const controlElement = playerElement || (document.getElementById("remoteImage") as any);
      initializeRemoteControl(controlElement, { useHttpApi: false, mjpegWebSocket: mjpegSocket });

      const infoOverlay = document.getElementById("infoOverlay") as HTMLElement | null;
      if (infoOverlay) infoOverlay.style.display = "none";
      const toolbar = document.getElementById("toolbar") as HTMLElement | null;
      if (toolbar) toolbar.style.display = "none";
      const captureModeBadge = document.getElementById("captureModeBadge") as HTMLElement | null;
      if (captureModeBadge) captureModeBadge.style.display = "none";
      const transportModeBadge = document.getElementById("transportModeBadge") as HTMLElement | null;
      if (transportModeBadge) transportModeBadge.style.display = "none";

      window.setPanelConnected?.(true);
      window.startStatusPolling?.();
      window.startTabsPolling?.();
      window.startTransportModePolling?.();
      window.startBandwidthPolling?.();
    };

    mjpegSocket.onmessage = (event: any) => {
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          window.addDebugLog?.(`📥 收到WebSocket消息: type=${message.type}`, "ws");
          if (message.type === "TAB_SWITCHED") {
            activeTabId = message.targetId;
            if (message.viewport?.width && message.viewport?.height) {
              window.backendResolution = { width: message.viewport.width, height: message.viewport.height };
            }
            window.addLog?.(
              `🔄 已切换到新标签页 (${message.targetId})，分辨率: ${message.viewport?.width}x${message.viewport?.height}`,
              "系统",
              "info",
            );
            void window.refreshTabs?.();
            return;
          }
          if (message.type === "TAB_CREATED") {
            window.addLog?.(`🆕 检测到新标签页: ${message.url}`, "系统", "info");
            setTimeout(async () => {
              try {
                await window.switchToTab?.(message.targetId);
                window.addLog?.("✅ 已自动切换到新标签页", "系统", "success");
              } catch (err) {
                console.error("自动切换到新标签页失败:", err);
                window.addLog?.(`⚠️ 自动切换失败: ${(err as any)?.message || String(err)}`, "系统", "warning");
              }
            }, 500);
            return;
          }
          if (message.type === "mode_switched") {
            window.addLog?.(`服务器模式: ${message.mode}`, "设置", "success");
            return;
          }
          handleRecordingMessage(message);
          return;
        } catch (e: any) {
          window.addDebugLog?.(`⚠️ WebSocket消息解析失败: ${e?.message || String(e)}`, "warning");
          // fallthrough for binary frames
        }
      }

      const data = new Uint8Array(event.data);
      if (data.length < 4) return;

      if (currentEncodingMode === "h264" && data.length >= H264StreamProtocol.HEADER_SIZE) {
        const view = new DataView(data.buffer);
        const magic = view.getUint32(0, false);
        if (magic === H264StreamProtocol.MAGIC) {
          handleH264Message(data.buffer);
          return;
        }
      }

      // MJPEG frame
      mjpegFrameCount++;
      streamStats.recordFrame(data.byteLength);
      if (streamPlayerManager && currentEncodingMode === "mjpeg") {
        const blob = new Blob([data], { type: "image/jpeg" });
        streamPlayerManager.receiveMJPEGFrame(blob);
      }
    };

    mjpegSocket.onerror = () => {
      window.addLog?.("❌ MJPEG连接错误", "MJPEG", "error");
    };

    mjpegSocket.onclose = () => {
      window.addLog?.("🔌 MJPEG连接已断开", "MJPEG", "warning");
      isConnected = false;
      window.updateStatus?.("未连接", false);
      window.stopStatusPolling?.();
      window.stopTabsPolling?.();
      window.stopTransportModePolling?.();
    };
  };

  // -----------------------------
  // IME helpers used by headerActions module
  // -----------------------------
  window.hideImeHelper = function hideImeHelper() {
    const popup = document.getElementById("imePopup");
    if (popup) popup.classList.remove("show");
  };

  window.updateImeCharCount = function updateImeCharCount() {
    const imeInput = document.getElementById("imeInput") as HTMLTextAreaElement | null;
    const charCount = document.getElementById("imeCharCount");
    if (imeInput && charCount) charCount.textContent = `${imeInput.value.length} 字符`;
  };

  // -----------------------------
  // Pagehide cleanup (release)
  // -----------------------------
  window.addEventListener("pagehide", () => {
    navigator.sendBeacon("/api/session/release", new Blob(["{}"], { type: "application/json" }));
  });

  // -----------------------------
  // Initialize runtime state
  // -----------------------------
  window.backendResolution = window.backendResolution || { width: 1920, height: 1080 };

  // Run init tasks after mount.
  void initStreamPlayerManager().catch((e) => console.error("[Init] StreamPlayerManager初始化失败:", e));
  void window.refreshStatus?.();

  // Auto-connect (disabled in parity tests).
  if (!window.__controllerE2E) {
    (async function autoConnect() {
      try {
        const transport = localStorage.getItem("ctl_transport_mode") || "mjpeg";
        const resolution = localStorage.getItem("ctl_resolution") || "1920x1080";
        const fps = localStorage.getItem("ctl_fps") || "30";
        const quality = localStorage.getItem("ctl_quality") || "98";

        (document.getElementById("transportModeSelect") as HTMLSelectElement | null)!.value = transport;
        (document.getElementById("resolutionSelect") as HTMLSelectElement | null)!.value = resolution;
        (document.getElementById("fpsSelect") as HTMLSelectElement | null)!.value = fps;
        (document.getElementById("qualitySelect") as HTMLSelectElement | null)!.value = quality;
        await window.applySettings?.();
        if (transport === "webrtc") {
          await window.connect?.();
        } else {
          await window.connectMJPEG?.();
        }
        currentTransportMode = transport;
        window.addLog?.(`✅ 自动连接 ${transport.toUpperCase()} ${resolution}`, "自动连接", "success");
        await new Promise((r) => setTimeout(r, 1500));
        await window.postJSON?.("/api/session/navigate", { url: "https://testerhome.com" });
        await window.refreshStatus?.();
        window.addLog?.("✅ 已导航到 testerhome.com", "自动连接", "success");
      } catch (e: any) {
        console.error("自动连接失败:", e);
        window.addLog?.("❌ 自动连接失败: " + (e?.message || String(e)), "自动连接", "error");
      }
    })();
  }
}
