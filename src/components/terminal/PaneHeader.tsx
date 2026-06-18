import { useState, useRef, useEffect, useCallback } from "react";
import { Columns2, Rows2, X, Copy, SplitSquareVertical, PictureInPicture2, HardDrive, Monitor } from "lucide-react";
import { useSessionStore } from "../../stores/session-store";
import { useTabStore } from "../../stores/tab-store";
import { useHostsStore } from "../../stores/hosts-store";
import type { SplitDirection } from "../../types";

interface PaneHeaderProps {
  sessionId: string;
  /** The unified tab that owns this pane — needed to clean up the tab bar. */
  tabId: string;
}

export function PaneHeader({ sessionId, tabId }: PaneHeaderProps) {
  const session = useSessionStore((s) => s.sessions.get(sessionId));
  const isActive = useSessionStore((s) => s.activeSessionId === sessionId);
  const hasSplits = useSessionStore((s) => {
    const tid = s.activeTerminalTabId;
    if (!tid) return false;
    const tab = s.tabs.get(tid);
    return tab ? tab.layout.type === "split" : false;
  });
  const hosts = useHostsStore((s) => s.hosts);

  if (!session) return null;

  const isLocal = session.sessionType === "local";
  const status = session.status;
  const dotColor =
    status === "Connected"    ? "bg-status-connected" :
    status === "Connecting"   ? "bg-status-connecting motion-safe:animate-pulse" :
    status === "Error"        ? "bg-status-error" :
                                "bg-status-disconnected";

  // ── Split popover state ──────────────────────────────────────────────────
  const [splitPopover, setSplitPopover] = useState<DOMRect | null>(null);
  const [splitDir, setSplitDir] = useState<SplitDirection>("horizontal");
  const splitBtnRef = useRef<HTMLButtonElement>(null);
  const splitPopoverRef = useRef<HTMLDivElement>(null);

  const toggleSplitPopover = useCallback(() => {
    if (splitPopover) {
      setSplitPopover(null);
    } else if (splitBtnRef.current) {
      setSplitPopover(splitBtnRef.current.getBoundingClientRect());
    }
  }, [splitPopover]);

  useEffect(() => {
    if (!splitPopover) return;
    const handler = (e: MouseEvent) => {
      if (
        splitBtnRef.current && !splitBtnRef.current.contains(e.target as Node) &&
        splitPopoverRef.current && !splitPopoverRef.current.contains(e.target as Node)
      ) {
        setSplitPopover(null);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [splitPopover]);

  // ── Split actions ────────────────────────────────────────────────────────
  const doSplit = useCallback(async (kind: "fork" | "local" | "host", hostId?: string) => {
    setSplitPopover(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let newId: string;

      if (kind === "fork") {
        newId = isLocal
          ? await invoke<string>("local_terminal_create")
          : await invoke<string>("ssh_split_session", { sourceSessionId: sessionId });
      } else if (kind === "local") {
        newId = await invoke<string>("local_terminal_create");
      } else if (kind === "host" && hostId) {
        const attemptId = crypto.randomUUID();
        newId = await invoke<string>("connect_saved_host", { hostId, attemptId });
        const host = hosts.find((h) => h.id === hostId);
        if (host) {
          const hostConfig: import("../../types").HostConfig = {
            host: host.host,
            port: host.port,
            username: host.username,
            label: host.label,
            auth_method: { type: "password", password: "" },
          };
          // Manually add session (avoid addSession which creates a tab entry)
          useSessionStore.setState((s) => {
            const sessions = new Map(s.sessions);
            sessions.set(newId, {
              id: newId,
              hostConfig,
              sessionType: "ssh" as const,
              status: "Connected" as const,
              label: `${host.username}@${host.host}`,
            });
            return { sessions };
          });
          useSessionStore.getState().splitPane(splitDir, sessionId, newId);
          return;
        }
      } else {
        return;
      }

      useSessionStore.getState().splitPane(splitDir, sessionId, newId);
    } catch (err) {
      console.error("Split failed:", err);
    }
  }, [sessionId, isLocal, splitDir, hosts]);

  const handleClose = () => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ssh_disconnect", { sessionId });
      } catch { /* already disconnected */ }

      const store = useSessionStore.getState();
      if (hasSplits) {
        store.unsplitPane(sessionId);
      }
      store.removeSession(sessionId);

      if (!useSessionStore.getState().tabs.get(tabId)) {
        useTabStore.getState().removeTab(tabId);
      }
    })();
  };

  const btnClass =
    "inline-flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-bg-muted transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div
      className={[
        "flex items-center h-8 px-2.5 gap-2.5 shrink-0 no-select",
        "border-b transition-colors duration-[var(--duration-fast)]",
        isActive
          ? "bg-bg-surface/80 border-border/60"
          : "bg-bg-surface/40 border-border/30",
      ].join(" ")}
    >
      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

      {/* Host label */}
      <span
        className={[
          "text-[11px] font-mono truncate flex-1 min-w-0 leading-none",
          isActive ? "text-text-primary" : "text-text-muted",
        ].join(" ")}
        title={session.label}
      >
        {isLocal ? "Local" : session.hostConfig.host}
      </span>

      {/* Action buttons — visible on hover or when active */}
        <div
          className={[
            "flex items-center gap-0.5 transition-opacity duration-[var(--duration-fast)]",
            isActive ? "opacity-60 group-hover/pane:opacity-100" : "opacity-0 group-hover/pane:opacity-100",
          ].join(" ")}
        >
          {/* Float — only available in split */}
          {hasSplits && (
            <button
              type="button"
              onClick={() => useSessionStore.getState().floatPane(sessionId)}
              className={btnClass}
              aria-label="Float pane"
              title="Float pane"
            >
              <PictureInPicture2 size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}

          {/* Split button */}
          <button
            ref={splitBtnRef}
            type="button"
            onClick={toggleSplitPopover}
            className={btnClass}
            aria-label="Split pane"
            title="Split pane"
          >
            <SplitSquareVertical size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>

          {/* Close pane */}
          {hasSplits && (
            <button type="button" onClick={handleClose}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Close pane" title="Close pane (⌘W)">
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>

      {/* ── Split popover ── */}
      {splitPopover && (() => {
        // Clamp within viewport
        const popoverWidth = 220;
        let left = splitPopover.left;
        if (left + popoverWidth > window.innerWidth - 8) {
          left = window.innerWidth - popoverWidth - 8;
        }
        if (left < 8) left = 8;
        let top = splitPopover.bottom + 4;
        // If too close to bottom, flip above
        const estimatedHeight = 280;
        if (top + estimatedHeight > window.innerHeight - 8) {
          top = splitPopover.top - estimatedHeight - 4;
        }

        return (
        <div
          ref={splitPopoverRef}
          className="fixed z-50 min-w-[200px] max-w-[260px] rounded-lg border border-border bg-bg-surface shadow-lg py-1.5"
          style={{ top, left }}
        >
          {/* Direction toggle */}
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mr-1">
              Direction
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSplitDir("horizontal"); }}
              className={[
                "flex items-center justify-center w-7 h-6 rounded",
                splitDir === "horizontal"
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-overlay",
              ].join(" ")}
              title="Horizontal split"
            >
              <Columns2 size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSplitDir("vertical"); }}
              className={[
                "flex items-center justify-center w-7 h-6 rounded",
                splitDir === "vertical"
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-overlay",
              ].join(" ")}
              title="Vertical split"
            >
              <Rows2 size={14} strokeWidth={1.8} />
            </button>
          </div>

          <div className="h-px bg-border/60 my-1 mx-2" />

          {/* Fork session */}
          <button
            type="button"
            onClick={() => void doSplit("fork")}
            className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
          >
            <Copy size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            <span>Fork session</span>
          </button>

          {/* Local terminal */}
          <button
            type="button"
            onClick={() => void doSplit("local")}
            className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
          >
            <Monitor size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            <span>Local terminal</span>
          </button>

          {/* Saved Hosts */}
          {hosts.length > 0 && (
            <>
              <div className="h-px bg-border/60 my-1 mx-2" />
              <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Saved Hosts
              </div>
              {hosts.slice(0, 8).map((host) => (
                <button
                  key={host.id}
                  type="button"
                  onClick={() => void doSplit("host", host.id)}
                  className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
                >
                  <HardDrive size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
                  <span className="truncate">{host.label || `${host.username}@${host.host}`}</span>
                </button>
              ))}
            </>
          )}
        </div>
        );
      })()}
    </div>
  );
}
