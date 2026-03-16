declare global {
  interface Window {
    toggleDock?: () => void;
    openDock?: (tabName?: string) => void;
    closeDock?: () => void;
    switchPanelTab?: (tabName: string) => void;
    __controllerDockLayoutInstalled?: boolean;
  }
}

const KEY_DOCK_OPEN = "ctl_dock_open";
const KEY_DOCK_W = "ctl_dock_w";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function getDockWidthLimits(mainContainer: HTMLElement | null) {
  const viewportW = document.documentElement.clientWidth || window.innerWidth || 1200;
  const containerRect = mainContainer?.getBoundingClientRect();
  const containerW = containerRect?.width ?? viewportW;

  const min = Math.max(260, Math.floor(viewportW * 0.15));
  const hardMax = Math.min(Math.floor(viewportW * 0.6), viewportW - 48);
  const max = Math.max(min, Math.min(hardMax, Math.floor(containerW - 48)));
  return { min, max };
}

function readDockOpen(): boolean {
  return true;
}

export function installDockLayoutModule() {
  if (window.__controllerDockLayoutInstalled) return;
  window.__controllerDockLayoutInstalled = true;

  const root = document.documentElement;
  const mainContainer = document.querySelector(".main-container") as HTMLElement | null;
  const resizeHandle = document.getElementById("dockResizeHandle") as HTMLElement | null;

  let dockOpen = readDockOpen();

  const applyDockState = () => {
    root.classList.toggle("ctl-dock-collapsed", !dockOpen);
    root.classList.toggle("ctl-dock-open", dockOpen);
    localStorage.setItem(KEY_DOCK_OPEN, dockOpen ? "1" : "0");
  };

  const applyDockWidth = (nextPx: number, persist = true) => {
    const { min, max } = getDockWidthLimits(mainContainer);
    const next = clamp(Math.round(nextPx), min, max);
    root.style.setProperty("--ctl-dock-w", `${next}px`);
    if (persist) localStorage.setItem(KEY_DOCK_W, String(next));
  };

  const savedW = Number.parseInt(localStorage.getItem(KEY_DOCK_W) || "", 10);
  if (Number.isFinite(savedW)) {
    applyDockWidth(savedW, false);
  }

  applyDockState();

  window.toggleDock = () => {
    dockOpen = true;
    applyDockState();
  };
  window.openDock = (tabName?: string) => {
    dockOpen = true;
    applyDockState();
    if (tabName) window.switchPanelTab?.(tabName);
  };
  window.closeDock = () => {
    dockOpen = true;
    applyDockState();
  };

  const clampDockWidthToLimits = () => {
    const raw = getComputedStyle(root).getPropertyValue("--ctl-dock-w").trim();
    const px = Number.parseFloat(raw.replace("px", ""));
    if (!Number.isFinite(px) || px <= 0) return;
    applyDockWidth(px, false);
  };
  window.addEventListener("resize", clampDockWidthToLimits);

  if (resizeHandle) {
    let dragging = false;
    let dragRightEdge = 0;
    let dragBaseW = 0;

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const next = dragRightEdge - e.clientX;
      applyDockWidth(next || dragBaseW, false);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("ctl-dock-resizing");
      document.body.style.cursor = "";

      const rawNow = getComputedStyle(root).getPropertyValue("--ctl-dock-w").trim();
      const pxNow = Number.parseFloat(rawNow.replace("px", ""));
      if (Number.isFinite(pxNow)) applyDockWidth(pxNow, true);

      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
      if (!dockOpen || e.button !== 0) return;
      e.preventDefault();

      const containerRect = mainContainer?.getBoundingClientRect();
      dragRightEdge = containerRect ? containerRect.right : window.innerWidth;
      const raw = getComputedStyle(root).getPropertyValue("--ctl-dock-w").trim();
      dragBaseW = Number.parseFloat(raw.replace("px", "")) || 360;
      dragging = true;

      root.classList.add("ctl-dock-resizing");
      document.body.style.cursor = "ew-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    resizeHandle.addEventListener("dblclick", () => {
      localStorage.removeItem(KEY_DOCK_W);
      root.style.removeProperty("--ctl-dock-w");
      clampDockWidthToLimits();
    });
  }
}
