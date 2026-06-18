import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTabStore } from "../../stores/tab-store";
import { useSessionStore } from "../../stores/session-store";
import { useTerminalSearchStore } from "../../stores/terminal-search-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUpdaterStore } from "../../stores/updater-store";
import { useUiStore } from "../../stores/ui-store";
import { useKeyboardShortcuts } from "../../hooks/use-keyboard-shortcuts";
import { useSshStatus } from "../../hooks/use-ssh-status";
import { useSftpTransfers } from "../../hooks/use-sftp-transfers";
import type { ShortcutDef } from "../../hooks/use-keyboard-shortcuts";
import type { PinnedLayoutNode } from "../../stores/tab-store";
import type { LayoutNode } from "../../types";
import { TerminalArea } from "../terminal";
import { FloatingTerminal } from "../terminal/FloatingTerminal";
import { UnifiedTabBar } from "./UnifiedTabBar";
import { HomePanel } from "./HomePanel";

import { HostEditModal } from "../dashboard";
import { NEW_HOST_ID } from "../dashboard/HostEditModal";
import { ExplorerPage } from "../sftp";

import { usePortForwardEvents } from "../../hooks/use-port-forward-events";
import { UpdateDialog } from "../updater/UpdateDialog";
import { Toaster } from "../shared/Toaster";

// ─── Pinned tab restore helpers ─────────────────────────────────────────────

/** Flatten a PinnedLayoutNode tree into an ordered list of pane descriptors. */
function flattenLayout(
  node: PinnedLayoutNode,
  out: { hostId?: string; label: string; accent?: string }[],
): void {
  if (node.type === "pane") {
    out.push({ hostId: node.hostId, label: node.label, accent: node.accent });
  } else {
    flattenLayout(node.children[0], out);
    flattenLayout(node.children[1], out);
  }
}

/** Create a single session from a pane descriptor. Returns the new session ID. */
async function createPinnedSession(
  invoke: typeof import("@tauri-apps/api/core").invoke,
  pd: { hostId?: string; label: string; accent?: string },
): Promise<string> {
  if (pd.hostId) {
    const attemptId = crypto.randomUUID();
    return await invoke<string>("connect_saved_host", { hostId: pd.hostId, attemptId });
  }
  return await invoke<string>("local_terminal_create");
}

/** Rebuild a LayoutNode tree from a PinnedLayoutNode, mapping pane indices → session IDs. */
function buildLayoutTree(
  node: PinnedLayoutNode,
  sessionIds: (string | null)[],
  nextIdx = { i: 0 },
): LayoutNode | null {
  if (node.type === "pane") {
    const sid = sessionIds[nextIdx.i++];
    if (!sid) return null;
    return { type: "pane", sessionId: sid };
  }
  const left = buildLayoutTree(node.children[0], sessionIds, nextIdx);
  const right = buildLayoutTree(node.children[1], sessionIds, nextIdx);
  if (!left || !right) return left ?? right;
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [left, right],
  };
}

export function AppShell() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const accentHue = useSettingsStore((s) => s.accentHue);
  const accentCustom = useSettingsStore((s) => s.accentCustom);
  const interfaceFont = useSettingsStore((s) => s.interfaceFont);
  const interfaceFontSize = useSettingsStore((s) => s.interfaceFontSize);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const allTabs = useTabStore((s) => s.tabs);

  const terminalTabs = useSessionStore((s) => s.tabs);
  const floatingPanes = useSessionStore((s) => s.floatingPanes);

  const setEditingHostId = useUiStore((s) => s.setEditingHostId);

  const openNewHost = () => setEditingHostId(NEW_HOST_ID);

  const shortcuts = useMemo<ShortcutDef[]>(
    () => [
      {
        key: "b",
        meta: true,
        action: () => {
          // Toggle between Home and the last active tab
          if (useTabStore.getState().activeTabId !== null) {
            useTabStore.getState().setActiveTab(null);
          } else {
            // Go back to the most recent tab
            const { tabOrder, tabs } = useTabStore.getState();
            for (let i = tabOrder.length - 1; i >= 0; i--) {
              if (tabs.has(tabOrder[i])) {
                useTabStore.getState().setActiveTab(tabOrder[i]);
                return;
              }
            }
          }
        },
      },
      {
        key: "t",
        meta: true,
        action: openNewHost,
      },
      {
        key: "w",
        meta: true,
        action: () => {
          const { activeTabId, tabs, removeTab } = useTabStore.getState();
          if (!activeTabId) return;
          const tab = tabs.get(activeTabId);
          if (!tab) return;

          if (tab.type === "terminal") {
            const { activeSessionId, tabs: termTabs, zoomedPaneId, unsplitPane, removeSession } = useSessionStore.getState();
            if (!activeSessionId) return;

            // If zoomed, just unzoom
            if (zoomedPaneId) {
              useSessionStore.getState().toggleZoom(zoomedPaneId);
              return;
            }

            const termTab = termTabs.get(activeTabId);
            const isInSplit = termTab && termTab.layout.type === "split";

            void (async () => {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("ssh_disconnect", { sessionId: activeSessionId });
              } catch { /* already disconnected */ }

              if (isInSplit) {
                unsplitPane(activeSessionId);
              }
              removeSession(activeSessionId);

              // If that was the last pane, remove the unified tab
              const remaining = useSessionStore.getState().tabs.get(activeTabId);
              if (!remaining) {
                removeTab(activeTabId);
              }
            })();
          } else {
            void (async () => {
              const { invoke } = await import("@tauri-apps/api/core");
              if (tab.type === "sftp") {
                try { await invoke("sftp_close", { sftpSessionId: activeTabId }); } catch { /* ok */ }
                const { useSftpStore } = await import("../../stores/sftp-store");
                useSftpStore.getState().closeSession(activeTabId);
              } else if (tab.type === "s3") {
                try { await invoke("s3_disconnect", { s3SessionId: activeTabId }); } catch { /* ok */ }
                const { useS3Store } = await import("../../stores/s3-store");
                useS3Store.getState().closeSession(activeTabId);
              }
              removeTab(activeTabId);
            })();
          }
        },
      },
      // Tab switching: Cmd+1 through Cmd+9
      ...Array.from({ length: 9 }, (_, i) => ({
        key: String(i + 1),
        meta: true,
        action: () => {
          const { tabOrder, setActiveTab } = useTabStore.getState();
          if (tabOrder[i]) setActiveTab(tabOrder[i]);
        },
      })),
      {
        key: "[",
        meta: true,
        action: () => {
          const { tabOrder, activeTabId, setActiveTab } = useTabStore.getState();
          const idx = tabOrder.indexOf(activeTabId ?? "");
          if (idx > 0) setActiveTab(tabOrder[idx - 1]);
          else if (tabOrder.length > 0) setActiveTab(tabOrder[tabOrder.length - 1]);
        },
      },
      {
        key: "]",
        meta: true,
        action: () => {
          const { tabOrder, activeTabId, setActiveTab } = useTabStore.getState();
          const idx = tabOrder.indexOf(activeTabId ?? "");
          if (idx < tabOrder.length - 1) setActiveTab(tabOrder[idx + 1]);
          else if (tabOrder.length > 0) setActiveTab(tabOrder[0]);
        },
      },
      // ─── Terminal search ──────────────────────────────────────────
      {
        key: "f",
        meta: true,
        action: () => {
          const { activeSessionId } = useSessionStore.getState();
          if (!activeSessionId) return;
          useTerminalSearchStore.getState().openSearch(activeSessionId);
        },
        when: () => useTabStore.getState().tabs.get(useTabStore.getState().activeTabId ?? "")?.type === "terminal",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEditingHostId],
  );

  useKeyboardShortcuts(shortcuts);
  useSshStatus();

  // Load persisted settings on mount
  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
  }, []);

  const settingsLoaded = useSettingsStore((s) => s.loaded);

  // Restore pinned tabs after settings load
  const didRestorePinned = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || didRestorePinned.current) return;
    didRestorePinned.current = true;
    void (async () => {
      const settings = useSettingsStore.getState();
      const pinned = settings.pinnedTabs;
      if (pinned.length === 0) return;

      const { invoke } = await import("@tauri-apps/api/core");
      const { useHostsStore } = await import("../../stores/hosts-store");
      await useHostsStore.getState().loadHosts();

      const pinnedIds: string[] = [];

      for (const desc of pinned) {
        try {
          if (desc.type !== "terminal") continue;

          // Flatten the layout tree → list of pane descriptors with a path index
          const paneDescs: { hostId?: string; label: string; accent?: string }[] = [];
          flattenLayout(desc.layout, paneDescs);

          // Floating pane descriptors (preserve position/size)
          const fpDescs = desc.floatingPanes ?? [];

          // Create all sessions (layout + floating) in parallel
          const allDescs = [...paneDescs, ...fpDescs.map((f) => ({ hostId: f.hostId, label: f.label, accent: f.accent }))];
          const sessionResults = await Promise.allSettled(
            allDescs.map((pd) => createPinnedSession(invoke, pd)),
          );

          // Map index → new session ID
          const sessionIds: (string | null)[] = sessionResults.map((r) =>
            r.status === "fulfilled" ? r.value : null,
          );

          // Layout session IDs are the first paneDescs.length entries
          const layoutSessionIds = sessionIds.slice(0, paneDescs.length);
          const fpSessionIds = sessionIds.slice(paneDescs.length);

          // Must have at least the first pane (tabId holder)
          const tabId = layoutSessionIds[0];
          if (!tabId) continue;

          // Build a LayoutNode tree from the descriptor, mapping pane indices → session IDs
          const builtLayout = buildLayoutTree(desc.layout, layoutSessionIds);
          if (!builtLayout) continue;

          // Helper to build a HostConfig
          const buildHostConfig = (pd: { hostId?: string; label: string }) =>
            pd.hostId
              ? (() => {
                  const host = useHostsStore.getState().hosts.find((h) => h.id === pd.hostId);
                  return {
                    host: host?.host ?? "",
                    port: host?.port ?? 22,
                    username: host?.username ?? "",
                    label: host?.label ?? "",
                    auth_method: { type: "password" as const, password: "" },
                  } as import("../../types").HostConfig;
                })()
              : { host: "localhost", port: 0, username: "", label: pd.label || "Local Terminal", auth_method: { type: "password" as const, password: "" } } as import("../../types").HostConfig;

          // Collect all created sessions for restorePinnedTab (layout + floating)
          const storedSessions: Array<{ id: string; session: import("../../types").Session }> = [];
          for (let i = 0; i < allDescs.length; i++) {
            const sid = sessionIds[i];
            if (!sid) continue;
            const pd = allDescs[i];
            storedSessions.push({
              id: sid,
              session: {
                id: sid,
                hostConfig: buildHostConfig(pd),
                sessionType: pd.hostId ? "ssh" as const : "local" as const,
                status: "Connected" as const,
                label: pd.label,
                accent: pd.accent,
              },
            });
          }

          // Build FloatingPaneInfo array for restored floating panes
          const restoredFloating: import("../../stores/session-store").FloatingPaneInfo[] = [];
          for (let i = 0; i < fpDescs.length; i++) {
            const sid = fpSessionIds[i];
            if (!sid) continue;
            restoredFloating.push({
              sessionId: sid,
              x: fpDescs[i].x,
              y: fpDescs[i].y,
              width: fpDescs[i].width,
              height: fpDescs[i].height,
            });
          }

          useSessionStore.getState().restorePinnedTab(
            tabId, builtLayout, storedSessions, desc.label,
            restoredFloating.length > 0 ? restoredFloating : undefined,
          );
          useTabStore.getState().restoreTab({ type: "terminal", id: tabId, label: desc.label });
          pinnedIds.push(tabId);
        } catch {
          // Skip tabs that can't reconnect
        }
      }

      if (pinnedIds.length > 0) {
        useTabStore.getState().setPinnedTabIds(pinnedIds);
      }
    })();
  }, [settingsLoaded]);

  // Check for updates once on launch
  const didUpdateCheck = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || didUpdateCheck.current) return;
    didUpdateCheck.current = true;
    void useUpdaterStore.getState().loadAppVersion();
    void useUpdaterStore.getState().checkOnStartup();
  }, [settingsLoaded]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--accent-hue", String(accentHue));
  }, [accentHue]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--font-sans", interfaceFont);
    document.documentElement.dataset.interfaceFont = interfaceFont;
  }, [interfaceFont]);

  useLayoutEffect(() => {
    const base = interfaceFontSize;
    // Scale all text variables proportionally from base (15px = 1.0).
    // Ratios preserved from the original design scale.
    document.documentElement.style.setProperty("--text-2xs", `${Math.round(base * 0.73)}px`);
    document.documentElement.style.setProperty("--text-xs",  `${Math.round(base * 0.80)}px`);
    document.documentElement.style.setProperty("--text-sm",  `${Math.round(base * 0.93)}px`);
    document.documentElement.style.setProperty("--text-base", `${base}px`);
    document.documentElement.style.setProperty("--text-lg",  `${Math.round(base * 1.13)}px`);
  }, [interfaceFontSize]);

  useLayoutEffect(() => {
    const st = document.documentElement.style;
    const props = ["--color-accent", "--color-accent-hover", "--color-accent-muted", "--color-border-focus", "--color-ring"];
    if (!accentCustom) {
      props.forEach((prop) => st.removeProperty(prop));
      delete document.documentElement.dataset.accentCustom;
      return;
    }
    const { l, c, h } = accentCustom;
    st.setProperty("--color-accent", `oklch(${l} ${c} ${h})`);
    st.setProperty("--color-accent-hover", `oklch(${Math.max(0, l - 0.05)} ${c} ${h})`);
    st.setProperty("--color-accent-muted", `oklch(${l} ${c} ${h} / 0.15)`);
    st.setProperty("--color-border-focus", `oklch(${l} ${c} ${h})`);
    st.setProperty("--color-ring", `oklch(${l} ${c} ${h} / 0.40)`);
    document.documentElement.dataset.accentCustom = `${l} ${c} ${h}`;
  }, [accentCustom]);

  // Block native context menu (cut/copy/paste) on all text inputs
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useSftpTransfers();
  usePortForwardEvents();

  const isHome = activeTabId === null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base no-select p-2.5 gap-2.5">
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Unified tab bar — Home button + terminal/SFTP/S3 tabs */}
        <UnifiedTabBar />

        {/* Content area */}
        <div className="flex-1 min-h-0 relative" data-content-bounds>
          {isHome ? (
            <HomePanel />
          ) : (
            <div className="absolute inset-0">
              {/* Terminal tabs — keep all mounted to preserve scrollback */}
              {Array.from(allTabs.entries())
                .filter(([, tab]) => tab.type === "terminal")
                .map(([tabId]) => {
                  const termTab = terminalTabs.get(tabId);
                  if (!termTab) return null;
                  const isVisible = tabId === activeTabId;
                  return (
                    <div
                      key={tabId}
                      className={`absolute inset-0 pt-2.5 ${isVisible ? "z-10 visible" : "z-0 invisible"}`}
                    >
                      <TerminalArea node={termTab.layout} tabId={tabId} />
                    </div>
                  );
                })}

              {/* Explorer (SFTP/S3) tabs — keep all mounted */}
              {Array.from(allTabs.entries())
                .filter(([, tab]) => tab.type === "sftp" || tab.type === "s3")
                .map(([tabId, tab]) => {
                  const isVisible = tabId === activeTabId;
                  return (
                    <div
                      key={tabId}
                      className={`absolute inset-0 ${isVisible ? "z-10 visible" : "z-0 invisible"}`}
                    >
                      {tab.type === "sftp" ? (
                        <ExplorerPage
                          sftpSessionId={tabId}
                          transport={tab.transport ?? "sftp"}
                          isActive={isVisible}
                        />
                      ) : (
                        <ExplorerPage s3SessionId={tabId} isActive={isVisible} />
                      )}
                    </div>
                  );
                })}

            </div>
          )}
        </div>
      </div>

      {/* Floating panes for current tab (rendered above everything) */}
      {activeTabId && floatingPanes.get(activeTabId)?.map((fp) => (
        <FloatingTerminal key={fp.sessionId} tabId={activeTabId} info={fp} />
      ))}

      {/* Host modal (new + edit) */}
      <HostEditModal />

      {/* Update-available popup */}
      <UpdateDialog />

      {/* Transient notifications (errors, etc.) */}
      <Toaster />
    </div>
  );
}
