/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

declare global {
  // Legacy global vars (declared as `var` in controller_ui/index.html for parity tests).
  var pc: RTCPeerConnection | null;
  var dataChannel: RTCDataChannel | null;
  var remoteControl: any;
  var controlEnabled: boolean;

  var mjpegSocket: WebSocket | null;
  var currentTransportMode: string;
  var currentEncodingMode: string;
  var isConnected: boolean;

  var binaryEventEncoder: any;
  var USE_BINARY_EVENTS: boolean;

  var currentTabs: any[];
  var activeTabId: string | null;

  var streamPlayerManager: any;
  var streamStats: any;

  var statusTimer: any;
  var transportModePollingInterval: any;
  var tabsPollingInterval: any;
  var bandwidthPollingInterval: any;
  var captureModeTimer: any;

  var autoScroll: boolean;
  var logEntries: any[];

  var mjpegFrameCount: number;
  var mjpegLastFrameTime: number;
  var h264FrameCount: number;
  var h264LastFrameTime: number;

  interface Window {
    __controllerE2E?: boolean;
    __controllerNewAppInitialized?: boolean;
    __controllerMigratedModules?: Record<string, boolean>;

    // Stream-side helpers.
    backendResolution?: { width: number; height: number };
    captureMjpegFrame?: () => string | null;

    // Common API helpers (tests stub these).
    postJSON?: (url: string, body?: any) => Promise<any>;
    addLog?: (message: string, category?: string, type?: string) => void;
    updateStats?: (stats: any) => void;
    refreshStatus?: () => Promise<void>;
    disconnectMJPEG?: () => void;
    stopStatusPolling?: () => void;
    stopTabsPolling?: () => void;
    stopTransportModePolling?: () => void;
    stopBandwidthPolling?: () => void;
    stopCaptureModePolling?: () => void;
    setPanelConnected?: (connected: boolean) => void;
    toggleFullscreenMode?: () => void;

    // Inline-handler globals referenced by static/controller.html (kept for parity).
    toggleSettingsPopup?: () => void;
    switchSettingsTab?: (tabName: string) => void;
    syncModelFromSettings?: (value: string) => void;
    toggleSettingsSplitMode?: () => void;
    syncPlanningModelFromSettings?: (value: string) => void;
    toggleImePopup?: () => void;
    clearImeHelper?: () => void;
    sendImeText?: () => void;
    historyBack?: () => Promise<void>;
    historyForward?: () => Promise<void>;
    reloadPage?: () => Promise<void>;
    toggleControl?: () => void;
    toggleFullscreen?: () => void;
    disconnect?: () => Promise<void> | void;
    releaseInstance?: () => Promise<void>;
    startUrlEdit?: () => void;
    commitUrlEdit?: () => void;
    cancelUrlEdit?: () => void;
    applySettings?: () => Promise<void>;
    applyAllSettings?: () => Promise<void>;
    switchTransportMode?: () => Promise<void>;

    // Tabs.
    refreshTabs?: () => Promise<void>;
    switchToTab?: (targetId: string) => Promise<void>;
    closeTab?: (targetId: string) => Promise<void>;
    createNewTab?: () => Promise<void>;

    // AI globals / bridge (tests expect these).
    showToast?: (message: string, kind?: string) => void;
    showAlertDialog?: (title: string, message?: string) => Promise<void>;
    showConfirmDialog?: (
      title: string,
      message?: string,
      variant?: "default" | "danger",
      confirmText?: string,
      cancelText?: string,
    ) => Promise<boolean>;
    showPromptDialog?: (
      title: string,
      opts?: { message?: string; defaultValue?: string; placeholder?: string; allowEmpty?: boolean },
    ) => Promise<string | null>;
    isRecordingToScript?: boolean;
    updateRecordToScriptBtn?: () => void;
    recordingStepToScriptStep?: (step: any) => any;
    enrichRecordingStep?: (scriptStep: any, frameBase64: string) => Promise<void> | void;

    aiSendMessage?: () => Promise<void> | void;
    aiStopGeneration?: () => void;
    aiHandleInputKeydown?: (event: KeyboardEvent) => void;
    aiAutoResizeInput?: (el: HTMLTextAreaElement) => void;
    aiToggleConvoMaximize?: () => void;
    aiToggleSavedScriptsPanel?: () => Promise<void> | void;
    aiCollapseScriptEditor?: () => void;
    aiToggleSplitMode?: (checked: boolean) => void;
    aiToggleRecordToScript?: () => Promise<void> | void;
    aiExecuteAllSteps?: () => Promise<void> | void;
    aiExecuteSingleStep?: (idx: number) => Promise<void> | void;
    aiSaveScript?: () => Promise<void> | void;
    aiClearAllSteps?: () => void;
    aiAddStepToScript?: (step: any, insertAfterIndex?: number) => void;
  }
}
