import { create } from "zustand";
import type { PaneSource } from "./tab-store";

export type HomePage = "hosts" | "transfer" | "port-forwarding" | "settings";

interface UiState {
  quickConnectOpen: boolean;
  editingHostId: string | null;
  /** Which page is shown inside the Home panel. */
  homeActivePage: HomePage;
  /** When set, TransferPage uses this as its initial right pane source.
   *  Cleared after TransferPage reads it. */
  pendingTransferRight: PaneSource | null;
  /** Persisted left/right pane sources — survive Home panel navigation. */
  transferLeftSource: PaneSource;
  transferRightSource: PaneSource | null;

  setQuickConnectOpen: (open: boolean) => void;
  setEditingHostId: (id: string | null) => void;
  setHomePage: (page: HomePage) => void;
  setPendingTransferRight: (source: PaneSource | null) => void;
  setTransferLeftSource: (source: PaneSource) => void;
  setTransferRightSource: (source: PaneSource | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  quickConnectOpen: false,
  editingHostId: null,
  homeActivePage: "hosts",
  pendingTransferRight: null,
  transferLeftSource: { type: "local" },
  transferRightSource: null,

  setQuickConnectOpen: (open) =>
    set({ quickConnectOpen: open }),

  setEditingHostId: (id) =>
    set({ editingHostId: id }),

  setHomePage: (page) =>
    set({ homeActivePage: page }),

  setPendingTransferRight: (source) =>
    set({ pendingTransferRight: source }),

  setTransferLeftSource: (source) =>
    set({ transferLeftSource: source }),

  setTransferRightSource: (source) =>
    set({ transferRightSource: source }),
}));

// E2E test hook — lets WebDriver tests open the HostEditModal for a given
// host id without having to drive the right-click context menu (which is
// flaky in WebKitWebDriver). No production code reads this.
if (typeof window !== "undefined") {
  (window as unknown as { __e2eOpenHostEdit?: (id: string | null) => void })
    .__e2eOpenHostEdit = (id) => useUiStore.getState().setEditingHostId(id);
}
