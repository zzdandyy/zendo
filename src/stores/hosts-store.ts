import { create } from "zustand";
import type { SavedHost } from "../types";

interface HostsState {
  hosts: SavedHost[];
  loading: boolean;
  error: string | null;

  loadHosts: () => Promise<void>;
  saveHost: (host: SavedHost) => Promise<void>;
  duplicateHost: (id: string) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
  reorderHosts: (newOrder: SavedHost[]) => Promise<void>;
}

export const useHostsStore = create<HostsState>((set, get) => ({
  hosts: [],
  loading: false,
  error: null,

  loadHosts: async () => {
    set({ loading: true, error: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const hosts = await invoke<SavedHost[]>("list_hosts");
      set({ hosts });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to load hosts";
      set({ error: msg });
    } finally {
      set({ loading: false });
    }
  },

  saveHost: async (host) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_host", { host });
    const hosts = await invoke<SavedHost[]>("list_hosts");
    set({ hosts });
  },

  duplicateHost: async (id) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const hosts = await invoke<SavedHost[]>("list_hosts");
    const orig = hosts.find((h) => h.id === id);
    if (!orig) throw new Error(`host not found: ${id}`);
    const now = new Date().toISOString();
    const duplicate: SavedHost = {
      ...orig,
      id: crypto.randomUUID(),
      label: `${orig.label || orig.host} (copy)`,
      created_at: now,
      updated_at: now,
      last_connected_at: null,
      connection_count: null,
    };
    await invoke("save_host", { host: duplicate });
    const updated = await invoke<SavedHost[]>("list_hosts");
    set({ hosts: updated });
  },

  deleteHost: async (id) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_host", { id });
    const hosts = await invoke<SavedHost[]>("list_hosts");
    set({ hosts });
  },

  // Optimistically apply a drag-and-drop reordering, then persist it. The UI
  // updates instantly (so the drag feels immediate) and the new order is sent
  // to the backend in the background. If the persist fails we roll back to the
  // previous order so the displayed state never diverges from what's stored.
  reorderHosts: async (newOrder) => {
    const previous = get().hosts;
    set({ hosts: newOrder });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reorder_hosts", { orderedIds: newOrder.map((h) => h.id) });
    } catch (err) {
      set({ hosts: previous });
      throw err;
    }
  },
}));

// E2E test hooks. Defined in bundled source (not in injected browser.execute
// callbacks) so the dynamic Tauri-API import resolves — a bare module specifier
// can't be resolved in code injected at runtime. No production code reads these.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __e2eDuplicateHost?: (id: string) => Promise<void>;
    __e2eBackupExport?: (password: string, path: string) => Promise<void>;
    __e2eBackupImport?: (password: string, path: string) => Promise<void>;
    __e2eFactoryReset?: () => Promise<void>;
    __e2eDataCounts?: () => Promise<{ hosts: number }>;
    __e2eHostOrder?: () => Promise<string[]>;
  };
  w.__e2eDuplicateHost = (id) => useHostsStore.getState().duplicateHost(id);
  // Persisted host order (labels) — lets the reorder E2E spec confirm the async
  // backend write landed before relaunching to verify it survives a restart.
  w.__e2eHostOrder = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const hosts = await invoke<SavedHost[]>("list_hosts");
    return hosts.map((h) => h.label);
  };
  w.__e2eBackupExport = async (password, path) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("backup_export", { password, path });
  };
  w.__e2eBackupImport = async (password, path) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("backup_import", { password, path });
  };
  w.__e2eFactoryReset = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("factory_reset");
  };
  w.__e2eDataCounts = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const hosts = await invoke<unknown[]>("list_hosts");
    return { hosts: hosts.length };
  };
}
