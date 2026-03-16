import { create } from "zustand";

export type ControllerTab = {
  targetId: string;
  title?: string;
  url?: string;
};

export type ControllerStats = {
  fpsText: string;
  bandwidthText: string;
};

type ControllerState = {
  connected: boolean;
  statusText: string;
  currentUrl: string;
  controlEnabled: boolean;
  stats: ControllerStats;
  tabs: ControllerTab[];
  activeTabId: string | null;

  setConnected: (connected: boolean) => void;
  setStatusText: (text: string) => void;
  setCurrentUrl: (url: string) => void;
  setControlEnabled: (enabled: boolean) => void;
  setStats: (stats: Partial<ControllerStats>) => void;
  setTabs: (tabs: ControllerTab[], activeTabId?: string | null) => void;
  setActiveTabId: (targetId: string | null) => void;
};

export const useControllerStore = create<ControllerState>((set) => ({
  connected: false,
  statusText: "未连接",
  currentUrl: "-",
  controlEnabled: false,
  stats: { fpsText: "-", bandwidthText: "-" },
  tabs: [],
  activeTabId: null,

  setConnected: (connected) => set({ connected }),
  setStatusText: (statusText) => set({ statusText }),
  setCurrentUrl: (currentUrl) => set({ currentUrl: currentUrl || "-" }),
  setControlEnabled: (controlEnabled) => set({ controlEnabled }),
  setStats: (stats) => set((s) => ({ stats: { ...s.stats, ...stats } })),
  setTabs: (tabs, activeTabId) =>
    set((s) => ({
      tabs,
      activeTabId: activeTabId === undefined ? s.activeTabId : activeTabId,
    })),
  setActiveTabId: (activeTabId) => set({ activeTabId }),
}));

