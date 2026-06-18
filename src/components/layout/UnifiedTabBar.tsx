import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  House,
  Maximize2,
  Pin,
  PinOff,
  Columns2,
  Rows2,
  TerminalSquare,
  FolderOpen,
  Cloud,
  ArrowLeftRight,
  Plus,
  HardDrive,
} from "lucide-react";
import { useTabStore, type UnifiedTab } from "../../stores/tab-store";
import { useSessionStore, countPanes, getTopDirection } from "../../stores/session-store";
import { useHostsStore } from "../../stores/hosts-store";
import { useS3Store } from "../../stores/s3-store";
import { ContextMenu } from "../shared/ContextMenu";

// ─── Icon mapping ───────────────────────────────────────────────────────────

function getTabIcon(tab: UnifiedTab): React.ElementType {
  if (tab.type === "terminal") return TerminalSquare;
  if (tab.type === "sftp") return FolderOpen;
  if (tab.type === "s3") return Cloud;
  if (tab.type === "transfer") return ArrowLeftRight;
  return TerminalSquare;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UnifiedTabBar() {
  const { t } = useTranslation();
  const tabOrder = useTabStore((s) => s.tabOrder);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const pinnedTabIds = useTabStore((s) => s.pinnedTabIds);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const removeTab = useTabStore((s) => s.removeTab);

  const sessions = useSessionStore((s) => s.sessions);
  const terminalTabs = useSessionStore((s) => s.tabs);
  const zoomedPaneId = useSessionStore((s) => s.zoomedPaneId);
  const hosts = useHostsStore((s) => s.hosts);
  const s3Connections = useS3Store((s) => s.connections);


  // ── ➕ popover ──────────────────────────────────────────────────────────
  const [popoverAnchor, setPopoverAnchor] = useState<DOMRect | null>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const togglePopover = useCallback(() => {
    if (popoverAnchor) {
      setPopoverAnchor(null);
    } else if (plusBtnRef.current) {
      // Ensure hosts and s3 connections are loaded
      void useHostsStore.getState().loadHosts();
      void useS3Store.getState().loadConnections();
      setPopoverAnchor(plusBtnRef.current.getBoundingClientRect());
    }
  }, [popoverAnchor]);

  // Click outside to close
  useEffect(() => {
    if (!popoverAnchor) return;
    const handler = (e: MouseEvent) => {
      if (
        plusBtnRef.current && !plusBtnRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setPopoverAnchor(null);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [popoverAnchor]);

  // ── Right-click context menu ────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    tab: UnifiedTab;
    x: number;
    y: number;
  } | null>(null);

  // ── Pin / unpin ────────────────────────────────────────────────────────
  const togglePin = useCallback((tabId: string, _tab: UnifiedTab) => {
    setContextMenu(null);
    const store = useTabStore.getState();
    if (store.pinnedTabIds.has(tabId)) {
      store.unpinTab(tabId);
    } else {
      store.pinTab(tabId);
    }
  }, []);

  // ── Inline rename ──────────────────────────────────────────────────────
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startRename = (tabId: string, currentLabel: string) => {
    setEditingTabId(tabId);
    setEditValue(currentLabel);
    setContextMenu(null);
  };

  const commitRename = (tabId: string) => {
    const newLabel = editValue.trim();
    if (newLabel) {
      useTabStore.getState().updateTabLabel(tabId, newLabel);
    }
    setEditingTabId(null);
  };

  const cancelRename = () => {
    setEditingTabId(null);
  };

  // ── Duplicate tab ──────────────────────────────────────────────────────
  const duplicateTab = useCallback(async (tabId: string, tab: UnifiedTab) => {
    setContextMenu(null);
    const { invoke } = await import("@tauri-apps/api/core");

    if (tab.type === "terminal") {
      const oldState = useSessionStore.getState();
      const termTab = oldState.tabs.get(tabId);
      if (!termTab) return;

      // Collect all session IDs from layout tree + floating panes
      const layoutIds = collectLayoutIds(termTab.layout);
      const floatingList = oldState.floatingPanes.get(tabId) ?? [];
      const allIds = [...layoutIds, ...floatingList.map((f) => f.sessionId)];

      // Map: old session ID → new session ID
      const idMap = new Map<string, string>();
      const newSessions = new Map(oldState.sessions);

      for (const sid of allIds) {
        const src = oldState.sessions.get(sid);
        if (!src) continue;
        const isLocal = src.sessionType === "local";
        const newId = isLocal
          ? await invoke<string>("local_terminal_create")
          : await invoke<string>("ssh_split_session", { sourceSessionId: sid });
        idMap.set(sid, newId);
        newSessions.set(newId, {
          id: newId,
          hostConfig: src.hostConfig,
          sessionType: src.sessionType,
          status: "Connected" as import("../../types").ConnectionStatus,
          label: src.label,
          accent: src.accent,
        });
      }

      // Deep-clone the layout tree with new IDs
      const newLayout = remapLayout(termTab.layout, idMap);

      // Build new floating pane list
      const newFloating: import("../../stores/session-store").FloatingPaneInfo[] = [];
      for (const fp of floatingList) {
        const newId = idMap.get(fp.sessionId);
        if (newId) {
          newFloating.push({ ...fp, sessionId: newId });
        }
      }

      // Use the first layout session ID as the tab ID
      const newTabId = idMap.get(layoutIds[0]);
      if (!newTabId) return;

      const newLabel = `${tab.label}${t('hosts:duplicateSuffix')}`;
      const newTabs = new Map(oldState.tabs);
      newTabs.set(newTabId, { layout: newLayout, label: newLabel });

      const newFloatingMap = new Map(oldState.floatingPanes);
      if (newFloating.length > 0) {
        newFloatingMap.set(newTabId, newFloating);
      }

      // Atomically update session-store
      useSessionStore.setState({
        sessions: newSessions,
        tabs: newTabs,
        floatingPanes: newFloatingMap,
        activeSessionId: newTabId,
      });

      // Add to tab-store
      useTabStore.getState().addTab({ type: "terminal", id: newTabId, label: newLabel });
    }
  }, []);

  // ── Connect saved host (for ➕ popover) ─────────────────────────────────
  const connectHost = useCallback(async (host: import("../../types").SavedHost) => {
    setPopoverAnchor(null);
    const { invoke } = await import("@tauri-apps/api/core");
    const attemptId = crypto.randomUUID();
    try {
      const sessionId = await invoke<string>("connect_saved_host", { hostId: host.id, attemptId });
      const hostConfig: import("../../types").HostConfig = {
        host: host.host,
        port: host.port,
        username: host.username,
        label: host.label,
        auth_method: { type: "password", password: "" },
      };
      useSessionStore.getState().addSession(sessionId, hostConfig);
      useTabStore.getState().addTab({ type: "terminal", id: sessionId, label: `${host.username}@${host.host}` });
    } catch (err) {
      console.error("Connect failed:", err);
    }
  }, []);

  const connectLocal = useCallback(async () => {
    setPopoverAnchor(null);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const sessionId = await invoke<string>("local_terminal_create");
      const hostConfig: import("../../types").HostConfig = {
        host: "localhost",
        port: 0,
        username: "",
        label: t('hosts:local.terminalLabel'),
        auth_method: { type: "password", password: "" },
      };
      useSessionStore.getState().addSession(sessionId, hostConfig, "local");
      useTabStore.getState().addTab({ type: "terminal", id: sessionId, label: t('hosts:local.terminalLabel') });
    } catch (err) {
      console.error("Local terminal failed:", err);
    }
  }, []);

  const connectS3 = useCallback(async (conn: { id: string; label: string }) => {
    setPopoverAnchor(null);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("s3_reconnect", { id: conn.id });
      useS3Store.getState().openSession(conn.id, conn.label);
      useTabStore.getState().addTab({ type: "s3", id: conn.id, label: conn.label });
    } catch (err) {
      console.error("S3 connect failed:", err);
    }
  }, []);

  const handleClose = async (tabId: string, tab: UnifiedTab, e: React.MouseEvent) => {
    e.stopPropagation();
    const { invoke } = await import("@tauri-apps/api/core");

    if (tab.type === "terminal") {
      const termTab = terminalTabs.get(tabId);
      if (termTab) {
        const sessionIds = collectLayoutIds(termTab.layout);
        for (const sid of sessionIds) {
          try { await invoke("ssh_disconnect", { sessionId: sid }); } catch { /* ok */ }
          useSessionStore.getState().removeSession(sid);
        }
      }
      // Also disconnect floating panes for this tab
      const fps = useSessionStore.getState().floatingPanes.get(tabId);
      if (fps) {
        for (const fp of fps) {
          try { await invoke("ssh_disconnect", { sessionId: fp.sessionId }); } catch { /* ok */ }
          useSessionStore.getState().removeSession(fp.sessionId);
        }
        // Clear floating panes for this tab
        useSessionStore.getState().floatingPanes.delete(tabId);
      }
    } else if (tab.type === "sftp") {
      try { await invoke("sftp_close", { sftpSessionId: tabId }); } catch { /* ok */ }
      const { useSftpStore } = await import("../../stores/sftp-store");
      useSftpStore.getState().closeSession(tabId);
    } else if (tab.type === "s3") {
      try { await invoke("s3_disconnect", { s3SessionId: tabId }); } catch { /* ok */ }
      const { useS3Store } = await import("../../stores/s3-store");
      useS3Store.getState().closeSession(tabId);
    }

    removeTab(tabId);
  };

  return (
    <div className="flex items-center h-[var(--tabbar-height)] no-select px-2 pt-2">
      {/* ── Home button (always visible, acts as pinned tab) ── */}
      <button
        type="button"
        data-testid="home-button"
        onClick={() => setActiveTab(null)}
        aria-label={t('common:tab.home')}
        title={t('common:tab.homeShortcut')}
        className={[
          "flex items-center justify-center w-[32px] h-[32px] shrink-0 rounded-md mr-1.5",
          "transition-[color,background-color] duration-[var(--duration-fast)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "text-text-secondary hover:text-text-primary hover:bg-bg-overlay/80 border border-transparent",
        ].join(" ")}
      >
        <House size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {/* ── Session tabs ── */}
      <div
        className="flex items-center gap-2.5 overflow-x-auto overflow-y-hidden flex-1 min-w-0"
        role="tablist"
        aria-label={t('common:tab.openSessions')}
      >
        {tabOrder.map((tabId) => {
          const tab = tabs.get(tabId);
          if (!tab) return null;

          const isActive = tabId === activeTabId;
          const Icon = getTabIcon(tab);

          // Terminal-specific metadata
          let statusDot: string | null = null;
          let paneCount = 1;
          let topDir: "horizontal" | "vertical" | null = null;
          let isZoomed = false;

          if (tab.type === "terminal") {
            const termTab = terminalTabs.get(tabId);
            if (termTab) {
              paneCount = countPanes(termTab.layout);
              topDir = getTopDirection(termTab.layout);
            }
            const firstSessionId = getFirstSessionIdFromTab(tabId);
            const firstSession = firstSessionId ? sessions.get(firstSessionId) : null;
            const status = firstSession?.status ?? "Disconnected";
            statusDot =
              status === "Connected"    ? "bg-status-connected" :
              status === "Connecting"   ? "bg-status-connecting motion-safe:animate-pulse" :
              status === "Error"        ? "bg-status-error" :
                                          "bg-status-disconnected";
            isZoomed = isActive && zoomedPaneId !== null;
          }

          return (
            <div
              key={tabId}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              data-testid={`tab-${tabId}`}
              data-tab-type={tab.type}
              data-tab-label={tab.label}
              onClick={() => setActiveTab(tabId)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId, tab, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveTab(tabId); } }}
              title={paneCount > 1 ? `${tab.label} (${t('common:tab.panes', { count: paneCount })})` : tab.label}
              className={[
                "group relative flex items-center gap-2 pl-2.5 pr-3.5 h-[32px] shrink-0 max-w-[220px]",
                "text-[length:var(--text-sm)] leading-none rounded-md cursor-pointer",
                "transition-[color,background-color] duration-[var(--duration-fast)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "bg-bg-overlay/80 text-text-secondary border border-border/60 hover:text-text-primary hover:bg-bg-overlay hover:border-border",
              ].join(" ")}
            >
              {/* Icon */}
              <Icon
                size={14}
                strokeWidth={1.8}
                className={[
                  "shrink-0",
                  tab.type === "terminal" && statusDot ? statusDot.replace("bg-", "text-") : "",
                  tab.type === "sftp" || tab.type === "s3" ? "text-status-connected" : "",
                ].join(" ")}
                aria-hidden="true"
              />

              {/* Label */}
              {editingTabId === tabId ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(tabId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tabId);
                    if (e.key === "Escape") cancelRename();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-bg-base border border-accent/40 rounded px-1 py-px text-[length:var(--text-sm)] leading-none outline-none text-text-primary"
                  style={{ maxWidth: "140px" }}
                />
              ) : (
                <span className={`truncate ${isActive ? "font-medium" : ""}`}>
                  {tab.label}
                </span>
              )}

              {/* Split indicator (terminal only) */}
              {tab.type === "terminal" && paneCount === 2 && topDir && (
                <span className="shrink-0 text-text-muted" aria-hidden="true">
                  {topDir === "horizontal" ? (
                    <Columns2 size={13} strokeWidth={1.8} />
                  ) : (
                    <Rows2 size={13} strokeWidth={1.8} />
                  )}
                </span>
              )}
              {tab.type === "terminal" && paneCount >= 3 && (
                <span className="flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-lg bg-bg-muted text-[10px] font-bold text-text-secondary tabular-nums leading-none shrink-0">
                  {paneCount}
                </span>
              )}

              {/* Pin indicator */}
              {pinnedTabIds.has(tabId) && (
                <span className="shrink-0 text-[length:var(--text-2xs)] text-text-muted" aria-hidden="true">
                  <Pin size={10} strokeWidth={2.5} />
                </span>
              )}

              {/* Zoom indicator */}
              {isZoomed && (
                <span className="shrink-0 text-accent" aria-hidden="true" title={t('common:tab.zoomedPane')}>
                  <Maximize2 size={11} strokeWidth={2} />
                </span>
              )}

              {/* Close button — all tabs are closeable */}
              <button
                data-testid={`tab-${tabId}-close`}
                onClick={(e) => void handleClose(tabId, tab, e)}
                className={[
                  "ml-auto p-0.5 -mr-1 rounded-lg shrink-0",
                  isActive
                    ? "text-accent/60 hover:text-accent hover:bg-accent/10"
                    : "text-text-muted hover:text-text-primary hover:bg-bg-muted",
                  "opacity-0 group-hover:opacity-100",
                  "transition-all duration-[var(--duration-fast)]",
                  "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ].join(" ")}
                aria-label={t('common:tab.close', { name: tab.label })}
                tabIndex={-1}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}

        {/* ── ➕ New tab button — inline after last tab ── */}
        <button
          ref={plusBtnRef}
          type="button"
          data-testid="new-tab-button"
          onClick={togglePopover}
          aria-label={t('common:tab.newTab')}
          title={t('common:tab.newTab')}
          className={[
            "flex items-center justify-center w-[32px] h-[32px] shrink-0 rounded-md",
            "transition-[color,background-color] duration-[var(--duration-fast)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "text-text-muted hover:text-text-primary hover:bg-bg-overlay/80 border border-transparent",
          ].join(" ")}
        >
          <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {/* ── ➕ Popover ── */}
      {popoverAnchor && (() => {
        const popoverW = 220;
        let left = popoverAnchor.left;
        if (left + popoverW > window.innerWidth - 8) {
          left = window.innerWidth - popoverW - 8;
        }
        if (left < 8) left = 8;
        return (
        <div
          ref={popoverRef}
          className="fixed z-50 min-w-[200px] max-w-[280px] rounded-lg border border-border bg-bg-surface shadow-lg py-1.5"
          style={{ top: popoverAnchor.bottom + 6, left }}
        >
          {/* Local Terminal */}
          <button
            type="button"
            onClick={connectLocal}
            className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
          >
            <TerminalSquare size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            <span className="truncate">{t('hosts:local.terminalLabel')}</span>
          </button>

          {/* Saved Hosts */}
          {hosts.length > 0 && (
            <>
              <div className="h-px bg-border/60 my-1 mx-2" />
              <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {t('hosts:server.heading')}
              </div>
              {hosts.map((host) => (
                <button
                  key={host.id}
                  type="button"
                  onClick={() => void connectHost(host)}
                  className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
                >
                  <HardDrive size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
                  <span className="truncate">{host.label || `${host.username}@${host.host}`}</span>
                </button>
              ))}
            </>
          )}

          {/* Cloud Storage */}
          {s3Connections.length > 0 && (
            <>
              <div className="h-px bg-border/60 my-1 mx-2" />
              <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {t('hosts:cloud.heading')}
              </div>
              {s3Connections.map((conn) => (
                <button
                  key={conn.id}
                  type="button"
                  onClick={() => void connectS3({ id: conn.id, label: conn.label })}
                  className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
                >
                  <Cloud size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
                  <span className="truncate">{conn.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
        );
      })()}

      {/* ── Right-click context menu ── */}
      {contextMenu && (() => {
        const isPinned = useTabStore.getState().pinnedTabIds.has(contextMenu.tabId);
        const canPin = contextMenu.tab.type === "terminal";
        return (
          <ContextMenu
            items={[
              {
                label: isPinned ? t('common:tab.unpin') : t('common:tab.pin'),
                icon: isPinned ? PinOff : Pin,
                onClick: () => togglePin(contextMenu.tabId, contextMenu.tab),
                disabled: !canPin,
              },
              {
                label: t('common:tab.rename'),
                onClick: () => startRename(contextMenu.tabId, contextMenu.tab.label),
              },
              {
                label: t('common:tab.duplicate'),
                onClick: () => { void duplicateTab(contextMenu.tabId, contextMenu.tab); },
                disabled: contextMenu.tab.type !== "terminal",
              },
            ]}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function collectLayoutIds(node: import("../../types").LayoutNode): string[] {
  if (node.type === "pane") return [node.sessionId];
  return [...collectLayoutIds(node.children[0]), ...collectLayoutIds(node.children[1])];
}

function remapLayout(
  node: import("../../types").LayoutNode,
  idMap: Map<string, string>,
): import("../../types").LayoutNode {
  if (node.type === "pane") {
    return { type: "pane", sessionId: idMap.get(node.sessionId) ?? node.sessionId };
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [remapLayout(node.children[0], idMap), remapLayout(node.children[1], idMap)],
  };
}

function getFirstSessionIdFromTab(tabId: string): string | null {
  const tab = useSessionStore.getState().tabs.get(tabId);
  if (!tab) return null;
  let node = tab.layout;
  while (node.type === "split") node = node.children[0];
  return node.sessionId;
}
