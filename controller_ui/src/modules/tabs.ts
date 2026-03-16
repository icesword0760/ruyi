declare global {
  interface Window {
    refreshTabs?: () => Promise<void>;
    renderTabs?: () => void;
    switchToTab?: (targetId: string) => Promise<void>;
    closeTab?: (targetId: string) => Promise<void>;
    postJSON?: (url: string, body?: unknown) => Promise<any>;
    refreshStatus?: () => Promise<void>;
    __controllerTabsInstalled?: boolean;
  }
}

import { useControllerStore } from "../store/controllerStore";

declare let isConnected: boolean;
declare let currentTabs: Array<{ targetId: string; title?: string; url?: string }>;
declare let activeTabId: string | null;

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(err);
}

export function installTabsModule() {
  if (window.__controllerTabsInstalled) return;
  window.__controllerTabsInstalled = true;

  window.refreshTabs = async function refreshTabs() {
    if (!isConnected) return;

    try {
      const response = await fetch("/api/tabs/list");
      const data = await response.json();
      currentTabs = data.tabs || [];
      useControllerStore.getState().setTabs(currentTabs, activeTabId);

      const headerTabs = document.getElementById("headerTabs") as HTMLElement | null;
      const oldTabsBar = document.getElementById("tabsBar") as HTMLElement | null;
      if (currentTabs.length > 0) {
        if (headerTabs) headerTabs.style.display = "flex";
        if (oldTabsBar) oldTabsBar.style.display = "none";
        window.renderTabs?.();
      } else {
        if (headerTabs) headerTabs.style.display = "none";
        if (oldTabsBar) oldTabsBar.style.display = "none";
      }
    } catch (err) {
      console.error("Failed to refresh tabs:", err);
    }
  };

  window.renderTabs = function renderTabs() {
    const tabsList =
      (document.getElementById("headerTabsList") as HTMLElement | null) ||
      (document.getElementById("tabsList") as HTMLElement | null);
    if (!tabsList) return;
    tabsList.innerHTML = "";

    currentTabs.forEach((tab) => {
      const tabEl = document.createElement("div");
      tabEl.className = "header-tab" + (tab.targetId === activeTabId ? " active" : "");
      tabEl.onclick = () => window.switchToTab?.(tab.targetId);
      tabEl.title = tab.url || "";

      const title = document.createElement("span");
      title.className = "header-tab-title";
      title.textContent = tab.title || "Untitled";

      tabEl.appendChild(title);

      if (currentTabs.length > 1) {
        const closeBtn = document.createElement("button");
        closeBtn.className = "header-tab-close";
        closeBtn.textContent = "×";
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          window.closeTab?.(tab.targetId);
        };
        tabEl.appendChild(closeBtn);
      }

      tabsList.appendChild(tabEl);
    });
  };

  window.switchToTab = async function switchToTab(targetId: string) {
    try {
      await window.postJSON?.("/api/tabs/switch", { targetId });
      activeTabId = targetId;
      useControllerStore.getState().setActiveTabId(targetId);
      await window.refreshTabs?.();
      await window.refreshStatus?.();
    } catch (err) {
      const msg = "切换标签页失败: " + errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("切换失败", msg);
      else window.alert(msg);
    }
  };

  window.closeTab = async function closeTab(targetId: string) {
    if (currentTabs.length <= 1) {
      const msg = "不能关闭最后一个标签页";
      window.showToast?.(msg, "warn");
      if (window.showAlertDialog) void window.showAlertDialog("提示", msg);
      else window.alert(msg);
      return;
    }

    try {
      await window.postJSON?.("/api/tabs/close", { targetId });
      await window.refreshTabs?.();
    } catch (err) {
      const msg = "关闭标签页失败: " + errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("关闭失败", msg);
      else window.alert(msg);
    }
  };
}
