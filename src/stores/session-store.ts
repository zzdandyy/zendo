import { create } from "zustand";
import type {
  Session,
  SessionId,
  HostConfig,
  ConnectionStatus,
  LayoutNode,
  SplitDirection,
} from "../types";
import { useTabStore } from "./tab-store";

// ─── Layout tree helpers ─────────────────────────────────────────────────────

function replacePane(
  node: LayoutNode,
  targetSessionId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (node.type === "pane") {
    return node.sessionId === targetSessionId ? replacement : node;
  }
  return {
    ...node,
    children: [
      replacePane(node.children[0], targetSessionId, replacement),
      replacePane(node.children[1], targetSessionId, replacement),
    ],
  };
}

function removePane(
  node: LayoutNode,
  targetSessionId: string,
): LayoutNode | null {
  if (node.type === "pane") {
    return node.sessionId === targetSessionId ? null : node;
  }
  const [left, right] = node.children;
  if (left.type === "pane" && left.sessionId === targetSessionId) return right;
  if (right.type === "pane" && right.sessionId === targetSessionId) return left;
  const newLeft = removePane(left, targetSessionId);
  const newRight = removePane(right, targetSessionId);
  if (newLeft === null) return right;
  if (newRight === null) return left;
  return { ...node, children: [newLeft, newRight] };
}

function updateRatioAtPath(
  node: LayoutNode,
  path: number[],
  ratio: number,
): LayoutNode {
  if (path.length === 0 && node.type === "split") {
    return { ...node, ratio };
  }
  if (node.type === "pane" || path.length === 0) return node;
  const [idx, ...rest] = path;
  const newChildren = [...node.children] as [LayoutNode, LayoutNode];
  newChildren[idx] = updateRatioAtPath(newChildren[idx], rest, ratio);
  return { ...node, children: newChildren };
}

/** Count total panes in a layout tree. */
export function countPanes(node: LayoutNode): number {
  if (node.type === "pane") return 1;
  return countPanes(node.children[0]) + countPanes(node.children[1]);
}

/** Get the top-level split direction (null if single pane). */
export function getTopDirection(node: LayoutNode): SplitDirection | null {
  if (node.type === "pane") return null;
  return node.direction;
}

/** Find which tab a session belongs to. */
function findTabForSession(
  tabs: Map<string, Tab>,
  sessionId: string,
): string | null {
  for (const [tabId, tab] of tabs) {
    if (containsSession(tab.layout, sessionId)) return tabId;
  }
  return null;
}

function containsSession(node: LayoutNode, sessionId: string): boolean {
  if (node.type === "pane") return node.sessionId === sessionId;
  return containsSession(node.children[0], sessionId) || containsSession(node.children[1], sessionId);
}

/** Generate the next "Workplace N" label. */
function nextWorkplaceLabel(tabs: Map<string, Tab>): string {
  let max = 0;
  for (const t of tabs.values()) {
    const m = t.label.match(/^Workplace (\d+)$/);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `Workplace ${max + 1}`;
}

/** Collect all session IDs from a layout tree. */
function collectSessionIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.sessionId];
  return [...collectSessionIds(node.children[0]), ...collectSessionIds(node.children[1])];
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Tab {
  layout: LayoutNode;
  label: string;
}

interface SessionState {
  sessions: Map<SessionId, Session>;
  activeSessionId: SessionId | null;
  /** Each tab owns its own layout tree. Tab ID = the first session's ID. */
  tabs: Map<string, Tab>;
  /** Which terminal tab is focused (used by PaneHeader / TerminalArea for split detection). */
  activeTerminalTabId: string | null;
  zoomedPaneId: string | null;
  /** Floating panes keyed by tabId. Each tab can have zero or more floating panes. */
  floatingPanes: Map<string, FloatingPaneInfo[]>;

  addSession: (id: SessionId, hostConfig: HostConfig, sessionType?: "ssh" | "local") => void;
  removeSession: (id: SessionId) => void;
  setActiveSession: (id: SessionId | null) => void;
  /** Called by tab-store when a terminal tab is activated. Sets activeSessionId from the layout tree. */
  focusTab: (tabId: string) => void;
  updateStatus: (id: SessionId, status: ConnectionStatus, message?: string) => void;
  splitPane: (direction: SplitDirection, targetSessionId: string, newSessionId: string) => void;
  unsplitPane: (sessionId: string) => void;
  updateSplitRatio: (tabId: string, path: number[], ratio: number) => void;
  toggleZoom: (sessionId: string) => void;
  /** Rename a session — updates the label in both the session entry and its owning tab. */
  renameSession: (sessionId: string, label: string) => void;
  /** Float a pane out of its layout tree into a standalone floating window. */
  floatPane: (sessionId: string) => void;
  /** Close and disconnect a floating pane. */
  removeFloatingPane: (sessionId: string) => Promise<void>;
  /** Update the position of a floating pane. */
  updateFloatingPosition: (tabId: string, sessionId: string, x: number, y: number) => void;
  /** Update the size of a floating pane. */
  updateFloatingSize: (tabId: string, sessionId: string, width: number, height: number) => void;
}

export interface FloatingPaneInfo {
  sessionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,
  tabs: new Map(),
  activeTerminalTabId: null,
  zoomedPaneId: null,
  floatingPanes: new Map(),

  addSession: (id, hostConfig, sessionType) =>
    set((state) => {
      const label = sessionType === "local"
        ? "Local Terminal"
        : `${hostConfig.username}@${hostConfig.host}`;

      const sessions = new Map(state.sessions);
      sessions.set(id, {
        id,
        hostConfig,
        sessionType: sessionType ?? "ssh",
        status: "Connected",
        label,
      });

      // New connection = new layout tree entry
      const tabs = new Map(state.tabs);
      tabs.set(id, {
        layout: { type: "pane", sessionId: id },
        label,
      });

      return {
        sessions,
        activeSessionId: id,
        tabs,
        activeTerminalTabId: id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(id);

      const tabs = new Map(state.tabs);
      let activeTerminalTabId = state.activeTerminalTabId;

      // Find which tab this session belongs to
      const ownerTabId = findTabForSession(state.tabs, id);

      if (ownerTabId) {
        const tab = tabs.get(ownerTabId);
        if (tab) {
          if (ownerTabId === id && tab.layout.type === "pane") {
            // This session IS the tab and it's the only pane — remove the layout
            tabs.delete(ownerTabId);
            if (activeTerminalTabId === ownerTabId) {
              activeTerminalTabId = null;
            }
          } else {
            // Session is in a split — remove it from the tree
            const newLayout = removePane(tab.layout, id);
            if (newLayout) {
              tabs.set(ownerTabId, { ...tab, layout: newLayout });
            } else {
              tabs.delete(ownerTabId);
              if (activeTerminalTabId === ownerTabId) {
                activeTerminalTabId = null;
              }
            }
          }
        }
      }

      // Pick a new active session
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === id) {
        if (activeTerminalTabId) {
          const activeTab = tabs.get(activeTerminalTabId);
          if (activeTab) {
            const ids = collectSessionIds(activeTab.layout);
            activeSessionId = ids[0] ?? null;
          } else {
            activeSessionId = null;
          }
        } else {
          activeSessionId = null;
        }
      }

      return {
        sessions,
        activeSessionId,
        tabs,
        activeTerminalTabId,
        zoomedPaneId: state.zoomedPaneId === id ? null : state.zoomedPaneId,
      };
    }),

  setActiveSession: (id) =>
    set((state) => {
      if (!id) return { activeSessionId: null };
      const tabId = findTabForSession(state.tabs, id);
      return {
        activeSessionId: id,
        activeTerminalTabId: tabId ?? state.activeTerminalTabId,
      };
    }),

  focusTab: (tabId) =>
    set((state) => {
      const tab = state.tabs.get(tabId);
      if (!tab) return state;
      const ids = collectSessionIds(tab.layout);
      return {
        activeTerminalTabId: tabId,
        activeSessionId: ids[0] ?? state.activeSessionId,
      };
    }),

  updateStatus: (id, status, message) =>
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(id, { ...session, status, statusMessage: message });
      return { sessions };
    }),

  splitPane: (direction, targetSessionId, newSessionId) =>
    set((state) => {
      const tabId = findTabForSession(state.tabs, targetSessionId);
      if (!tabId) return state;
      const tab = state.tabs.get(tabId);
      if (!tab) return state;

      // Create the new session from the source (unless already created, e.g. by host split)
      const sessions = new Map(state.sessions);
      if (!sessions.has(newSessionId)) {
        const sourceSession = state.sessions.get(targetSessionId);
        if (sourceSession) {
          sessions.set(newSessionId, {
            id: newSessionId,
            hostConfig: sourceSession.hostConfig,
            sessionType: sourceSession.sessionType,
            status: "Connected",
            label: sourceSession.label,
          });
        }
      }

      const splitNode: LayoutNode = {
        type: "split",
        direction,
        ratio: 0.5,
        children: [
          { type: "pane", sessionId: targetSessionId },
          { type: "pane", sessionId: newSessionId },
        ],
      };

      const newLayout = replacePane(tab.layout, targetSessionId, splitNode);
      const tabs = new Map(state.tabs);

      // Auto-rename to "Workplace N" when first split is created
      let label = tab.label;
      if (tab.layout.type === "pane") {
        label = nextWorkplaceLabel(state.tabs);
        useTabStore.getState().updateTabLabel(tabId, label);
      }

      tabs.set(tabId, { ...tab, layout: newLayout, label });

      return { sessions, tabs, activeSessionId: newSessionId };
    }),

  unsplitPane: (sessionId) =>
    set((state) => {
      const tabId = findTabForSession(state.tabs, sessionId);
      if (!tabId) return state;
      const tab = state.tabs.get(tabId);
      if (!tab) return state;

      const newLayout = removePane(tab.layout, sessionId);
      if (!newLayout) return state;

      const tabs = new Map(state.tabs);
      tabs.set(tabId, { ...tab, layout: newLayout });
      return { tabs };
    }),

  updateSplitRatio: (tabId, path, ratio) =>
    set((state) => {
      const tab = state.tabs.get(tabId);
      if (!tab) return state;
      const newLayout = updateRatioAtPath(tab.layout, path, ratio);
      const tabs = new Map(state.tabs);
      tabs.set(tabId, { ...tab, layout: newLayout });
      return { tabs };
    }),

  toggleZoom: (sessionId) =>
    set((state) => ({
      zoomedPaneId: state.zoomedPaneId === sessionId ? null : sessionId,
      activeSessionId: sessionId,
    })),

  renameSession: (sessionId, label) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const sessions = new Map(state.sessions);
      sessions.set(sessionId, { ...session, label });

      // Also update the tab label if this session is the first in its owning tab
      const tabs = new Map(state.tabs);
      const ownerTabId = findTabForSession(state.tabs, sessionId);
      if (ownerTabId) {
        const tab = tabs.get(ownerTabId);
        if (tab) {
          tabs.set(ownerTabId, { ...tab, label });
        }
      }

      return { sessions, tabs };
    }),

  floatPane: (sessionId) =>
    set((state) => {
      const tabId = findTabForSession(state.tabs, sessionId);
      if (!tabId) return state;
      const tab = state.tabs.get(tabId);
      if (!tab) return state;

      // Must have at least one pane left in the layout
      if (tab.layout.type === "pane") return state;

      // Remove from layout tree (keep session alive)
      const newLayout = removePane(tab.layout, sessionId);
      if (!newLayout) return state;

      const tabs = new Map(state.tabs);
      tabs.set(tabId, { ...tab, layout: newLayout });

      // Add to floating panes
      const floatingPanes = new Map(state.floatingPanes);
      const existing = floatingPanes.get(tabId) ?? [];
      floatingPanes.set(tabId, [
        ...existing,
        {
          sessionId,
          x: Math.max(100, window.innerWidth / 2 - 200),
          y: Math.max(80, window.innerHeight / 2 - 150),
          width: 400,
          height: 300,
        },
      ]);

      return { tabs, floatingPanes };
    }),

  removeFloatingPane: async (sessionId) => {
    // Disconnect on the Rust side
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ssh_disconnect", { sessionId });
    } catch { /* already gone */ }

    set((state) => {
      // Remove from floatingPanes
      const floatingPanes = new Map(state.floatingPanes);
      for (const [tabId, list] of floatingPanes) {
        const filtered = list.filter((fp) => fp.sessionId !== sessionId);
        if (filtered.length === 0) {
          floatingPanes.delete(tabId);
        } else {
          floatingPanes.set(tabId, filtered);
        }
      }

      // Remove session and clean up tab if needed
      const sessions = new Map(state.sessions);
      sessions.delete(sessionId);

      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        if (state.activeTerminalTabId) {
          const activeTab = state.tabs.get(state.activeTerminalTabId);
          if (activeTab) {
            const ids = collectSessionIds(activeTab.layout);
            activeSessionId = ids[0] ?? null;
          } else {
            activeSessionId = null;
          }
        } else {
          activeSessionId = null;
        }
      }

      return {
        sessions,
        floatingPanes,
        activeSessionId,
        zoomedPaneId: state.zoomedPaneId === sessionId ? null : state.zoomedPaneId,
      };
    });
  },

  updateFloatingPosition: (tabId, sessionId, x, y) =>
    set((state) => {
      const floatingPanes = new Map(state.floatingPanes);
      const list = floatingPanes.get(tabId);
      if (!list) return state;
      floatingPanes.set(
        tabId,
        list.map((fp) => (fp.sessionId === sessionId ? { ...fp, x, y } : fp)),
      );
      return { floatingPanes };
    }),

  updateFloatingSize: (tabId, sessionId, width, height) =>
    set((state) => {
      const floatingPanes = new Map(state.floatingPanes);
      const list = floatingPanes.get(tabId);
      if (!list) return state;
      floatingPanes.set(
        tabId,
        list.map((fp) => (fp.sessionId === sessionId ? { ...fp, width: Math.max(200, width), height: Math.max(120, height) } : fp)),
      );
      return { floatingPanes };
    }),
}));
