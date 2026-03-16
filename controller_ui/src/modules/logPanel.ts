declare global {
  interface Window {
    switchLogView?: (view: "main" | "debug") => void;
    setLogFilter?: (filter: string) => void;
    setLogSearchQuery?: (query: string) => void;
    __applyLogFilters?: () => void;
    __controllerLogPanelInstalled?: boolean;
  }
}

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function normalize(s: string) {
  return (s || "").toLowerCase();
}

export function installLogPanelModule() {
  if (window.__controllerLogPanelInstalled) return;
  window.__controllerLogPanelInstalled = true;

  let view: "main" | "debug" = "main";
  let filter = "all";
  let query = "";

  function applyToContainer(container: HTMLElement | null) {
    if (!container) return;
    const entries = Array.from(container.querySelectorAll<HTMLElement>(".log-entry"));
    const q = normalize(query);
    entries.forEach((el) => {
      const type =
        el.classList.contains("success")
          ? "success"
          : el.classList.contains("warning")
            ? "warning"
            : el.classList.contains("error")
              ? "error"
              : el.classList.contains("debug")
                ? "debug"
                : "info";

      let visible = true;
      if (filter !== "all" && type !== filter) visible = false;
      if (visible && q) {
        const text = normalize(el.textContent || "");
        visible = text.includes(q);
      }
      el.style.display = visible ? "" : "none";
    });
  }

  function applyAll() {
    applyToContainer(getEl("logContent"));
    applyToContainer(getEl("debugLogContent"));
  }

  function setActiveButtons(selector: string, match: (el: HTMLElement) => boolean) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => el.classList.toggle("active", match(el)));
  }

  window.__applyLogFilters = applyAll;

  window.switchLogView = (next) => {
    view = next;
    const main = getEl("logContent");
    const dbg = getEl("debugLogContent");
    if (main) main.style.display = view === "main" ? "" : "none";
    if (dbg) dbg.style.display = view === "debug" ? "" : "none";
    setActiveButtons(".log-view-tab", (el) => el.dataset.logView === view);
    applyAll();
  };

  window.setLogFilter = (next) => {
    filter = next || "all";
    setActiveButtons(".log-filter-chip", (el) => (el.dataset.logFilter || "all") === filter);
    applyAll();
  };

  window.setLogSearchQuery = (next) => {
    query = next || "";
    applyAll();
  };

  // Initialize once DOM is ready.
  queueMicrotask(() => {
    window.switchLogView?.("main");
    window.setLogFilter?.("all");
  });
}

