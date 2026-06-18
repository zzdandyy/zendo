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

// ─── Pinned tab persistence types ─────────────────────────────────────────

export interface PinnedPaneDescriptor {
  /** undefined = local terminal; otherwise the saved host ID. */
  hostId?: string;
  label: string;
  /** Per-pane accent colour (OKLCH). */
  accent?: string;
}

export interface PinnedSplitDescriptor {
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PinnedLayoutNode, PinnedLayoutNode];
}

export type PinnedLayoutNode =
  | ({ type: "pane" } & PinnedPaneDescriptor)
  | ({ type: "split" } & PinnedSplitDescriptor);

export interface PinnedFloatingPaneDescriptor {
  hostId?: string;
  label: string;
  accent?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PinnedTabDescriptor {
  type: "terminal";
  layout: PinnedLayoutNode;
  /** Tab label (e.g. "Workplace 2" or the single session label). */
  label: string;
  /** Floating panes that were popped out of the layout tree. */
  floatingPanes?: PinnedFloatingPaneDescriptor[];
}

interface TabState {
  tabs: Map<string, UnifiedTab>;
  tabOrder: string[];
  /** null = Home panel is shown instead of a tab. */
  activeTabId: string | null;
  /** Tab IDs that are currently pinned. */
  pinnedTabIds: Set<string>;

  addTab: (tab: UnifiedTab) => void;
  /** Add a tab without activating it (used for pinned-tab restore). */
  restoreTab: (tab: UnifiedTab) => void;
  removeTab: (id: string) => void;
  /** Pass null to deactivate all tabs and show the Home panel. */
  setActiveTab: (id: string | null) => void;
  updateTabLabel: (id: string, label: string) => void;
  /** Swap a tab's ID in-place (used by SFTP sudo toggle when session reopens). */
  replaceTabId: (oldId: string, newId: string) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;
  /** Bulk-set pinned IDs (used on restore). */
  setPinnedTabIds: (ids: string[]) => void;
}

export const useTabStore = create<TabState>((set) => ({
  tabs: new Map<string, UnifiedTab>(),
  tabOrder: [],
  activeTabId: null,
  pinnedTabIds: new Set<string>(),

  addTab: (tab) =>
    set((state) => {
      const tabs = new Map(state.tabs);
      tabs.set(tab.id, tab);
      const tabOrder = state.tabOrder.includes(tab.id)
        ? state.tabOrder
        : [...state.tabOrder, tab.id];
      return { tabs, tabOrder, activeTabId: tab.id };
    }),

  restoreTab: (tab) =>
    set((state) => {
      const tabs = new Map(state.tabs);
      tabs.set(tab.id, tab);
      const tabOrder = state.tabOrder.includes(tab.id)
        ? state.tabOrder
        : [...state.tabOrder, tab.id];
      return { tabs, tabOrder };
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
      if (state.pinnedTabIds.has(id)) {
        void import("./pinned-sync").then((m) => m.syncPinnedTabs());
      }
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

  pinTab: (id) =>
    set((state) => {
      const s = new Set(state.pinnedTabIds);
      s.add(id);
      void import("./pinned-sync").then((m) => m.syncPinnedTabs());
      return { pinnedTabIds: s };
    }),

  unpinTab: (id) =>
    set((state) => {
      const s = new Set(state.pinnedTabIds);
      s.delete(id);
      void import("./pinned-sync").then((m) => m.syncPinnedTabs());
      return { pinnedTabIds: s };
    }),

  setPinnedTabIds: (ids) =>
    set({ pinnedTabIds: new Set(ids) }),
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
