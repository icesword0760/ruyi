declare global {
  interface Window {
    __videoFitInstalled?: boolean;
  }
}

const MIN_DOCK_W = 280;

export function installVideoFitModule() {
  if (window.__videoFitInstalled) return;
  window.__videoFitInstalled = true;

  const root = document.documentElement;
  const mainContainer = document.querySelector(".main-container") as HTMLElement | null;
  const leftPanel = document.querySelector(".left-panel") as HTMLElement | null;
  const rightPanel = document.querySelector(".right-panel") as HTMLElement | null;
  const video = document.getElementById("remoteVideo") as HTMLVideoElement | null;
  const image = document.getElementById("remoteImage") as HTMLImageElement | null;

  if (!mainContainer || !leftPanel || !rightPanel) return;

  let rafId = 0;

  function getMediaAR(): number | null {
    if (video && video.style.display !== "none" && video.videoWidth > 0) {
      return video.videoWidth / video.videoHeight;
    }
    if (image && image.style.display !== "none" && image.naturalWidth > 0) {
      return image.naturalWidth / image.naturalHeight;
    }
    return null;
  }

  function recalc() {
    if (root.classList.contains("ctl-panel-detached")) {
      leftPanel.style.maxWidth = "";
      leftPanel.style.flex = "";
      return;
    }

    const ar = getMediaAR();
    if (!ar) {
      leftPanel.style.maxWidth = "";
      leftPanel.style.flex = "";
      rightPanel.style.flex = "";
      rightPanel.style.minWidth = "";
      return;
    }

    // If user is resizing the dock, or has explicitly set a dock width, do not
    // override the right panel's flex sizing. Otherwise the drag-resize feels
    // "broken" after stream connects (because this module keeps forcing widths).
    const hasManualDockW = !!localStorage.getItem("ctl_dock_w");
    const isResizingDock = root.classList.contains("ctl-dock-resizing");
    if (hasManualDockW || isResizingDock) {
      leftPanel.style.maxWidth = "";
      leftPanel.style.flex = "";
      rightPanel.style.flex = "";
      rightPanel.style.minWidth = "";
      return;
    }

    const totalW = mainContainer.clientWidth;
    const stageEl = document.querySelector(".ctl-stage") as HTMLElement | null;
    const totalH = stageEl?.clientHeight ?? mainContainer.clientHeight;
    if (totalW <= 0 || totalH <= 0) return;

    const idealLeftW = Math.ceil(totalH * ar);

    const currentDockW =
      parseFloat(
        getComputedStyle(root).getPropertyValue("--ctl-dock-w")
      ) || 360;
    const currentLeftW = totalW - currentDockW;

    if (idealLeftW <= currentLeftW) {
      // Portrait-ish: video narrower than available. Constrain left, let right grow.
      leftPanel.style.flex = `0 0 ${idealLeftW}px`;
      leftPanel.style.maxWidth = `${idealLeftW}px`;
      rightPanel.style.flex = "1 1 auto";
      rightPanel.style.minWidth = `${currentDockW}px`;
    } else if (idealLeftW > totalW - MIN_DOCK_W) {
      // Very wide video: even minimum dock isn't enough. Use all available.
      leftPanel.style.flex = "1 1 0%";
      leftPanel.style.maxWidth = `${totalW - MIN_DOCK_W}px`;
      rightPanel.style.flex = `0 0 ${MIN_DOCK_W}px`;
      rightPanel.style.minWidth = `${MIN_DOCK_W}px`;
    } else {
      // Landscape: video needs more than current left panel. Shrink right panel.
      const neededDockW = totalW - idealLeftW;
      leftPanel.style.flex = `0 0 ${idealLeftW}px`;
      leftPanel.style.maxWidth = `${idealLeftW}px`;
      rightPanel.style.flex = `0 0 ${Math.round(neededDockW)}px`;
      rightPanel.style.minWidth = `${MIN_DOCK_W}px`;
    }
  }

  function scheduleRecalc() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(recalc);
  }

  video?.addEventListener("loadedmetadata", scheduleRecalc);
  video?.addEventListener("resize", scheduleRecalc);
  image?.addEventListener("load", scheduleRecalc);

  new ResizeObserver(scheduleRecalc).observe(mainContainer);

  const mo = new MutationObserver(scheduleRecalc);
  if (video) mo.observe(video, { attributes: true, attributeFilter: ["style"] });
  if (image) mo.observe(image, { attributes: true, attributeFilter: ["style"] });

  scheduleRecalc();
}
