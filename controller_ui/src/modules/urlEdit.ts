declare global {
  interface Window {
    startUrlEdit?: () => void;
    commitUrlEdit?: () => void;
    cancelUrlEdit?: () => void;
    setCurrentUrl?: (url: string) => void;
    postJSON?: (url: string, body?: unknown) => Promise<any>;
    refreshStatus?: () => Promise<void>;
    addLog?: (message: string, category?: string, type?: string) => void;
    __controllerUrlEditInstalled?: boolean;
  }
}

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return "https:" + trimmed;
  }
  return "https://" + trimmed;
}

export function installUrlEditModule() {
  if (window.__controllerUrlEditInstalled) return;
  window.__controllerUrlEditInstalled = true;

  let urlEditCommitted = false;

  window.setCurrentUrl = function setCurrentUrl(url: string) {
    const label = getEl<HTMLElement>("infoRoomId");
    if (!label) return;
    const value = url || "-";
    label.textContent = value;
    label.title = value;
  };

  window.startUrlEdit = function startUrlEdit() {
    const label = getEl<HTMLElement>("infoRoomId");
    const input = getEl<HTMLInputElement>("urlEditInput");
    if (!label || !input) return;
    urlEditCommitted = false;
    input.value = label.textContent === "-" ? "" : label.textContent ?? "";
    label.style.display = "none";
    input.style.display = "";
    input.focus();
    input.select();
  };

  window.commitUrlEdit = function commitUrlEdit() {
    urlEditCommitted = true;
    const label = getEl<HTMLElement>("infoRoomId");
    const input = getEl<HTMLInputElement>("urlEditInput");
    if (!input || !label) return;
    const url = normalizeUrl(input.value);
    input.style.display = "none";
    label.style.display = "";

    if (!url) return;

    window
      .postJSON?.("/api/session/navigate", { url })
      .then(() => {
        window.setCurrentUrl?.(url);
        window.refreshStatus?.();
        window.addLog?.(`导航到: ${url}`, "导航", "success");
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        window.addLog?.(`导航失败: ${message}`, "导航", "error");
      });
  };

  window.cancelUrlEdit = function cancelUrlEdit() {
    if (urlEditCommitted) return;
    const label = getEl<HTMLElement>("infoRoomId");
    const input = getEl<HTMLInputElement>("urlEditInput");
    if (input) input.style.display = "none";
    if (label) label.style.display = "";
  };
}

