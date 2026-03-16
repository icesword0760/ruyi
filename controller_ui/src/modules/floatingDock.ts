declare global {
  interface Window {
    toggleFloatingDock?: () => void;
    openFloatingDock?: () => void;
    closeFloatingDock?: () => void;
    __floatingDockInstalled?: boolean;
  }
}

const KEY_DOCK_X = "floating_dock_x";
const KEY_DOCK_Y = "floating_dock_y";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function installFloatingDockModule() {
  if (window.__floatingDockInstalled) return;
  window.__floatingDockInstalled = true;

  const dock = document.getElementById("floatingDock") as HTMLElement | null;
  const trigger = document.getElementById("floatingDockTrigger") as HTMLElement | null;
  const panel = document.getElementById("floatingDockPanel") as HTMLElement | null;
  if (!dock || !trigger || !panel) return;

  let isOpen = false;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dockStartX = 0;
  let dockStartY = 0;
  let hasMoved = false;

  const restorePosition = () => {
    const sx = localStorage.getItem(KEY_DOCK_X);
    const sy = localStorage.getItem(KEY_DOCK_Y);
    if (sx !== null && sy !== null) {
      const x = clamp(Number(sx), 0, window.innerWidth - 60);
      const y = clamp(Number(sy), 60, window.innerHeight - 20);
      dock.style.left = `${x}px`;
      dock.style.bottom = "auto";
      dock.style.top = `${y}px`;
    }
  };
  restorePosition();

  const persistPosition = () => {
    const rect = dock.getBoundingClientRect();
    localStorage.setItem(KEY_DOCK_X, String(Math.round(rect.left)));
    localStorage.setItem(KEY_DOCK_Y, String(Math.round(rect.top)));
  };

  const openDock = () => {
    if (isOpen) return;
    isOpen = true;
    panel.classList.add("show");
    requestAnimationFrame(() => {
      repositionPanel();
    });
  };

  const closeDock = () => {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove("show");
  };

  const toggleDock = () => {
    if (isOpen) closeDock();
    else openDock();
  };

  const repositionPanel = () => {
    if (!isOpen) return;
    const dockRect = dock.getBoundingClientRect();
    const panelW = panel.offsetWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let leftOffset = -panelW / 2 + 24;

    const panelLeft = dockRect.left + leftOffset;
    const panelRight = panelLeft + panelW;
    if (panelLeft < 8) leftOffset += 8 - panelLeft;
    if (panelRight > vw - 8) leftOffset -= panelRight - (vw - 8);

    panel.style.left = `${leftOffset}px`;
    panel.style.transform = "scale(1)";

    if (dockRect.top < vh / 2) {
      panel.style.bottom = "auto";
      panel.style.top = "calc(100% + 14px)";
    } else {
      panel.style.top = "auto";
      panel.style.bottom = "calc(100% + 14px)";
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = dock.getBoundingClientRect();
    dockStartX = rect.left;
    dockStartY = rect.top;
    trigger.setPointerCapture(e.pointerId);
    trigger.style.cursor = "grabbing";
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!hasMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    hasMoved = true;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const newX = clamp(dockStartX + dx, 0, vw - 60);
    const newY = clamp(dockStartY + dy, 0, vh - 60);
    dock.style.left = `${newX}px`;
    dock.style.top = `${newY}px`;
    dock.style.bottom = "auto";

    if (isOpen) repositionPanel();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    trigger.style.cursor = "";
    try {
      trigger.releasePointerCapture(e.pointerId);
    } catch {
      // noop
    }
    if (hasMoved) {
      persistPosition();
    } else {
      toggleDock();
    }
  };

  trigger.addEventListener("pointerdown", onPointerDown);
  trigger.addEventListener("pointermove", onPointerMove);
  trigger.addEventListener("pointerup", onPointerUp);
  trigger.addEventListener("pointercancel", onPointerUp);

  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    const target = e.target as Node;
    if (dock.contains(target)) return;
    closeDock();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeDock();
  });

  window.addEventListener("resize", () => {
    const rect = dock.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const newX = clamp(rect.left, 0, vw - 60);
    const newY = clamp(rect.top, 0, vh - 60);
    dock.style.left = `${newX}px`;
    dock.style.top = `${newY}px`;
    dock.style.bottom = "auto";
    if (isOpen) repositionPanel();
  });

  window.toggleFloatingDock = toggleDock;
  window.openFloatingDock = openDock;
  window.closeFloatingDock = closeDock;
}
