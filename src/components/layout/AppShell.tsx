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

export function AppShell() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const accentHue = useSettingsStore((s) => s.accentHue);
  const accentCustom = useSettingsStore((s) => s.accentCustom);
  const interfaceFont = useSettingsStore((s) => s.interfaceFont);
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

  // Check for updates once on launch
  const settingsLoaded = useSettingsStore((s) => s.loaded);
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

  useSftpTransfers();
  usePortForwardEvents();

  const isHome = activeTabId === null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base no-select p-2 gap-2">
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Unified tab bar — Home button + terminal/SFTP/S3 tabs */}
        <UnifiedTabBar />

        {/* Content area */}
        <div className="flex-1 min-h-0 relative">
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
                      className={`absolute inset-0 px-2 pt-2 ${isVisible ? "z-10 visible" : "z-0 invisible"}`}
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
