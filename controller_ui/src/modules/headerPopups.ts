declare global {
  interface Window {
    toggleSettingsPopup?: () => void;
    switchSettingsTab?: (tabName: string) => void;
    setSettingsAiEngine?: (engine: "midscene" | "mai-ui") => void;
    syncModelFromSettings?: (value: string) => void;
    toggleSettingsMidscene?: () => void;
    toggleSettingsMaiUi?: () => void;
    syncMaiUiModelFromSettings?: (value: string) => void;
    toggleSettingsSplitMode?: () => void;
    syncPlanningModelFromSettings?: (value: string) => void;
    toggleImePopup?: () => void;
    aiToggleSplitMode?: (checked: boolean) => void;
    __controllerHeaderPopupsInstalled?: boolean;
  }
}

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

type AiEngine = "midscene" | "mai-ui";

function readAiEngine(): AiEngine {
  const raw = (localStorage.getItem("ai_engine") || "").toLowerCase();
  if (raw === "mai-ui" || raw === "maiui" || raw === "mai_ui" || raw === "mai") return "mai-ui";
  return "midscene";
}

function normalizeAiEngineState(): AiEngine {
  const engine = readAiEngine();
  localStorage.setItem("ai_engine", engine);
  localStorage.setItem("midscene_enabled", engine === "midscene" ? "1" : "0");
  localStorage.setItem("maiui_enabled", engine === "mai-ui" ? "1" : "0");
  if (engine === "midscene") {
    if (!localStorage.getItem("ai_model")) localStorage.setItem("ai_model", "doubao-seed-1-8-251228");
  } else {
    if (!localStorage.getItem("maiui_model")) localStorage.setItem("maiui_model", "mai-ui-8b@q8_0");
  }
  return engine;
}

function syncSettingsAiTab() {
  const engine = normalizeAiEngineState();

  document.querySelectorAll<HTMLElement>(".ai-engine-seg-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.engine || "") === engine);
  });

  const midsceneSection = getEl<HTMLElement>("settingsEngineMidsceneSection");
  if (midsceneSection) midsceneSection.classList.toggle("show", engine === "midscene");
  const maiuiSection = getEl<HTMLElement>("settingsEngineMaiUiSection");
  if (maiuiSection) maiuiSection.classList.toggle("show", engine === "mai-ui");

  if (engine === "midscene") {
    const aiModelSel = getEl<HTMLSelectElement>("aiModelSelect");
    const settingsSel = getEl<HTMLSelectElement>("settingsAiModelSelect");
    if (aiModelSel && settingsSel) settingsSel.value = aiModelSel.value;

    const splitOn = localStorage.getItem("ai_split_mode") === "1";
    const toggle = getEl<HTMLElement>("settingsSplitToggle");
    if (toggle) toggle.classList.toggle("active", splitOn);
    const planRow = getEl<HTMLElement>("settingsPlanningModelRow");
    if (planRow) planRow.classList.toggle("show", splitOn);

    const planModel = localStorage.getItem("ai_planning_model");
    const planSel = getEl<HTMLSelectElement>("settingsPlanningModelSelect");
    if (planSel && planModel) planSel.value = planModel;
  } else {
    getEl<HTMLElement>("settingsSplitToggle")?.classList.remove("active");
    getEl<HTMLElement>("settingsPlanningModelRow")?.classList.remove("show");

    const maiuiSel = getEl<HTMLSelectElement>("settingsMaiUiModelSelect");
    const savedMaiui = localStorage.getItem("maiui_model");
    if (maiuiSel && savedMaiui) maiuiSel.value = savedMaiui;
  }
}

function installClickOutsideHandler() {
  document.addEventListener("click", function onDocumentClick(e) {
    const target = e.target as Node;
    const popups = [
      { popup: "settingsPopup", btn: "settingsPopupBtn" },
      { popup: "imePopup", btn: "imePopupBtn" },
      { popup: "aiScriptSavedPanel", btn: "aiScriptSavedBtn" },
    ];
    popups.forEach(({ popup, btn }) => {
      const popupEl = getEl<HTMLElement>(popup);
      const buttonEl = getEl<HTMLElement>(btn);
      if (popupEl && buttonEl && !popupEl.contains(target) && !buttonEl.contains(target)) {
        popupEl.classList.remove("show");
      }
    });
  });
}

export function installHeaderPopupsModule() {
  if (window.__controllerHeaderPopupsInstalled) return;
  window.__controllerHeaderPopupsInstalled = true;

  installClickOutsideHandler();

  window.toggleSettingsPopup = function toggleSettingsPopup() {
    const popup = getEl<HTMLElement>("settingsPopup");
    if (popup) {
      const isShowing = popup.classList.toggle("show");
      if (isShowing) syncSettingsAiTab();
    }
    getEl<HTMLElement>("imePopup")?.classList.remove("show");
    getEl<HTMLElement>("aiScriptSavedPanel")?.classList.remove("show");
    getEl<HTMLElement>("aiScriptSavedBtn")?.classList.remove("active");
  };

  window.switchSettingsTab = function switchSettingsTab(tabName: string) {
    document.querySelectorAll<HTMLElement>(".settings-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    getEl<HTMLElement>("settingsTabQuality")?.classList.toggle("active", tabName === "quality");
    getEl<HTMLElement>("settingsTabAi")?.classList.toggle("active", tabName === "ai");
  };

  window.setSettingsAiEngine = function setSettingsAiEngine(engine: AiEngine) {
    localStorage.setItem("ai_engine", engine);
    normalizeAiEngineState();
    syncSettingsAiTab();
  };

  window.syncModelFromSettings = function syncModelFromSettings(value: string) {
    if (normalizeAiEngineState() !== "midscene") return;
    const aiModelSel = getEl<HTMLSelectElement>("aiModelSelect");
    if (aiModelSel) aiModelSel.value = value;
    localStorage.setItem("ai_model", value);
    const settingsSel = getEl<HTMLSelectElement>("settingsAiModelSelect");
    if (settingsSel) settingsSel.value = value;
  };

  window.toggleSettingsMidscene = function toggleSettingsMidscene() {
    window.setSettingsAiEngine?.("midscene");
  };

  window.toggleSettingsMaiUi = function toggleSettingsMaiUi() {
    window.setSettingsAiEngine?.("mai-ui");
  };

  window.syncMaiUiModelFromSettings = function syncMaiUiModelFromSettings(value: string) {
    if (normalizeAiEngineState() !== "mai-ui") return;
    localStorage.setItem("maiui_model", value);
    const sel = getEl<HTMLSelectElement>("settingsMaiUiModelSelect");
    if (sel) sel.value = value;
  };

  window.toggleSettingsSplitMode = function toggleSettingsSplitMode() {
    if (normalizeAiEngineState() !== "midscene") return;
    const toggle = getEl<HTMLElement>("settingsSplitToggle");
    if (!toggle) return;
    const isActive = toggle.classList.toggle("active");
    const planRow = getEl<HTMLElement>("settingsPlanningModelRow");
    if (planRow) planRow.classList.toggle("show", isActive);
    const hiddenToggle = getEl<HTMLInputElement>("aiSplitModeToggle");
    if (hiddenToggle) hiddenToggle.checked = isActive;
    window.aiToggleSplitMode?.(isActive);
  };

  window.syncPlanningModelFromSettings = function syncPlanningModelFromSettings(value: string) {
    if (normalizeAiEngineState() !== "midscene") return;
    const originalSel = getEl<HTMLSelectElement>("aiPlanningModelSelect");
    if (originalSel) originalSel.value = value;
    localStorage.setItem("ai_planning_model", value);
  };

  window.toggleImePopup = function toggleImePopup() {
    const popup = getEl<HTMLElement>("imePopup");
    if (popup) {
      popup.classList.toggle("show");
      if (popup.classList.contains("show")) {
        setTimeout(() => getEl<HTMLTextAreaElement>("imeInput")?.focus(), 50);
      }
    }
    getEl<HTMLElement>("settingsPopup")?.classList.remove("show");
    getEl<HTMLElement>("aiScriptSavedPanel")?.classList.remove("show");
    getEl<HTMLElement>("aiScriptSavedBtn")?.classList.remove("active");
  };
}
