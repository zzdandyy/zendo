import { create } from "zustand";
import { useSessionStore } from "./session-store";
import { useSftpStore } from "./sftp-store";
import { useS3Store } from "./s3-store";

// ─── Types ──────────────────────────────────────────────────────────────────

export type UnifiedTab =
  | { type: "terminal"; id: string; label: string }
  | { type: "sftp"; id: string; label: string; transport?: "sftp" | "scp" }
  | { type: "s3"; id: string; label: string }
  | { type: "transfer"; id: string; label: string; left: PaneSource; right: PaneSource };

// ─── Pane source types (for dual-pane transfer view) ──────────────────────

export interface PaneSourceLocal { type: "local"; rootPath?: string }
export interface PaneSourceHost {
  type: "host";
  hostId: string;
  sessionId: string;
  sshSessionId: string;
  transport: "sftp" | "scp";
  label: string;
}
export interface PaneSourceS3 {
  type: "s3";
  connectionId: string;
  sessionId: string;
  label: string;
}
export type PaneSource = PaneSourceLocal | PaneSourceHost | PaneSourceS3;

export function getTabType(tab: UnifiedTab): string {
  return tab.type;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface TabState {
  tabs: Map<string, UnifiedTab>;
  tabOrder: string[];
  /** null = Home panel is shown instead of a tab. */
  activeTabId: string | null;

  addTab: (tab: UnifiedTab) => void;
  removeTab: (id: string) => void;
  /** Pass null to deactivate all tabs and show the Home panel. */
  setActiveTab: (id: string | null) => void;
  updateTabLabel: (id: string, label: string) => void;
  /** Swap a tab's ID in-place (used by SFTP sudo toggle when session reopens). */
  replaceTabId: (oldId: string, newId: string) => void;
}

export const useTabStore = create<TabState>((set) => ({
  tabs: new Map<string, UnifiedTab>(),
  tabOrder: [],
  activeTabId: null,

  addTab: (tab) =>
    set((state) => {
      const tabs = new Map(state.tabs);
      tabs.set(tab.id, tab);
      const tabOrder = state.tabOrder.includes(tab.id)
        ? state.tabOrder
        : [...state.tabOrder, tab.id];
      return { tabs, tabOrder, activeTabId: tab.id };
    }),

  removeTab: (id) =>
    set((state) => {
      const tabs = new Map(state.tabs);
      tabs.delete(id);
      const tabOrder = state.tabOrder.filter((t) => t !== id);

      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        // Activate the neighbour tab, or null (Home) if none left.
        const oldIdx = state.tabOrder.indexOf(id);
        const fallback = tabOrder[Math.min(oldIdx, tabOrder.length - 1)] ?? null;
        if (fallback) {
          activeTabId = fallback;
          syncDomainStores(tabs.get(fallback)!);
        } else {
          activeTabId = null;
        }
      }

      return { tabs, tabOrder, activeTabId };
    }),

  setActiveTab: (id) =>
    set((state) => {
      if (id === null) return { activeTabId: null };
      const tab = state.tabs.get(id);
      if (!tab) return state;
      syncDomainStores(tab);
      return { activeTabId: id };
    }),

  updateTabLabel: (id, label) =>
    set((state) => {
      const tab = state.tabs.get(id);
      if (!tab) return state;
      const tabs = new Map(state.tabs);
      tabs.set(id, { ...tab, label });
      return { tabs };
    }),

  replaceTabId: (oldId, newId) =>
    set((state) => {
      const tab = state.tabs.get(oldId);
      if (!tab) return state;
      const tabs = new Map(state.tabs);
      tabs.delete(oldId);
      tabs.set(newId, { ...tab, id: newId });
      const tabOrder = state.tabOrder.map((t) => (t === oldId ? newId : t));
      const activeTabId = state.activeTabId === oldId ? newId : state.activeTabId;
      return { tabs, tabOrder, activeTabId };
    }),
}));

// ─── Domain store sync ──────────────────────────────────────────────────────

function syncDomainStores(tab: UnifiedTab) {
  if (tab.type === "terminal") {
    useSessionStore.getState().focusTab(tab.id);
  } else if (tab.type === "sftp") {
    useSftpStore.getState().setActiveSftpSession(tab.id);
  } else if (tab.type === "s3") {
    useS3Store.getState().setActiveS3Session(tab.id);
  }
}
