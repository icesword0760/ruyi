declare global {
  interface Window {
    historyBack?: () => Promise<void>;
    historyForward?: () => Promise<void>;
    reloadPage?: () => Promise<void>;
    postJSON?: (url: string, body?: unknown) => Promise<any>;
    refreshStatus?: () => Promise<void>;
    setCurrentUrl?: (url: string) => void;
    __controllerNavigationActionsInstalled?: boolean;
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(err);
}

export function installNavigationActionsModule() {
  if (window.__controllerNavigationActionsInstalled) return;
  window.__controllerNavigationActionsInstalled = true;

  window.historyBack = async function historyBack() {
    try {
      const res = await window.postJSON?.("/api/session/back");
      if (res?.url) window.setCurrentUrl?.(res.url);
    } catch (err) {
      const msg = errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("操作失败", msg);
      else window.alert(msg);
    }
  };

  window.historyForward = async function historyForward() {
    try {
      const res = await window.postJSON?.("/api/session/forward");
      if (res?.url) window.setCurrentUrl?.(res.url);
    } catch (err) {
      const msg = errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("操作失败", msg);
      else window.alert(msg);
    }
  };

  window.reloadPage = async function reloadPage() {
    try {
      await window.postJSON?.("/api/session/reload");
      await window.refreshStatus?.();
    } catch (err) {
      const msg = errorMessage(err);
      window.showToast?.(msg, "error");
      if (window.showAlertDialog) void window.showAlertDialog("操作失败", msg);
      else window.alert(msg);
    }
  };
}
