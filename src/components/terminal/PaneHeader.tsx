import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Rows2, X, Copy, SplitSquareVertical, PictureInPicture2, HardDrive, Monitor } from "lucide-react";
import { useSessionStore, DEFAULT_ACCENT } from "../../stores/session-store";
import { useTabStore } from "../../stores/tab-store";
import { useHostsStore } from "../../stores/hosts-store";
import type { SplitDirection } from "../../types";

/** Preset border colours (OKLCH). White is the default. */
const ACCENT_PRESETS = [
  { color: "oklch(0.80 0 0)", label: "White" },
  { color: "oklch(0.70 0.15 250)", label: "Blue" },
  { color: "oklch(0.70 0.15 277)", label: "Indigo" },
  { color: "oklch(0.70 0.15 300)", label: "Violet" },
  { color: "oklch(0.70 0.15 350)", label: "Pink" },
  { color: "oklch(0.70 0.15 25)", label: "Red" },
  { color: "oklch(0.70 0.15 70)", label: "Orange" },
  { color: "oklch(0.70 0.15 150)", label: "Green" },
  { color: "oklch(0.70 0.15 195)", label: "Teal" },
];

interface PaneHeaderProps {
  sessionId: string;
  /** The unified tab that owns this pane — needed to clean up the tab bar. */
  tabId: string;
}

export function PaneHeader({ sessionId, tabId }: PaneHeaderProps) {
  const { t } = useTranslation();
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

  // ── Split popover state ──────────────────────────────────────────────────
  const [splitPopover, setSplitPopover] = useState<DOMRect | null>(null);
  const [splitDir, setSplitDir] = useState<SplitDirection>("horizontal");
  const splitBtnRef = useRef<HTMLButtonElement>(null);
  const splitPopoverRef = useRef<HTMLDivElement>(null);

  // ── Inline rename state ─────────────────────────────────────────────────
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(() => {
    if (renaming) return;
    setRenameValue(session.label);
    setRenaming(true);
  }, [session.label, renaming]);

  const commitRename = useCallback(() => {
    useSessionStore.getState().renameSession(sessionId, renameValue.trim());
    setRenaming(false);
  }, [sessionId, renameValue]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  useEffect(() => {
    if (renaming) {
      const el = renameInputRef.current;
      if (el) { el.focus(); el.select(); }
    }
  }, [renaming]);

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

  // ── Accent colour popover ─────────────────────────────────────────────────
  const [colorPopover, setColorPopover] = useState<DOMRect | null>(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const colorPopoverRef = useRef<HTMLDivElement>(null);

  const toggleColorPopover = useCallback(() => {
    if (colorPopover) {
      setColorPopover(null);
    } else if (colorBtnRef.current) {
      setColorPopover(colorBtnRef.current.getBoundingClientRect());
    }
  }, [colorPopover]);

  useEffect(() => {
    if (!colorPopover) return;
    const handler = (e: MouseEvent) => {
      if (
        colorBtnRef.current && !colorBtnRef.current.contains(e.target as Node) &&
        colorPopoverRef.current && !colorPopoverRef.current.contains(e.target as Node)
      ) {
        setColorPopover(null);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [colorPopover]);

  const handleSetAccent = useCallback((color: string) => {
    useSessionStore.getState().setAccent(sessionId, color);
    setColorPopover(null);
  }, [sessionId]);

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
              accent: DEFAULT_ACCENT,
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
    <div className="flex items-center h-8 px-2.5 gap-2 shrink-0 no-select bg-bg-base">
      {/* Colour swatch — top-left, click to open accent picker */}
      <button
        ref={colorBtnRef}
        type="button"
        className="w-2.5 h-2.5 rounded-sm shrink-0 hover:scale-110 transition-transform cursor-pointer"
        style={{ backgroundColor: session.accent ?? DEFAULT_ACCENT }}
        title={t("terminal.pane.accentTitle")}
        aria-label={t("terminal.pane.accentAria")}
        onClick={toggleColorPopover}
      />

      {/* Name — left-aligned, click to rename */}
      {renaming ? (
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
            if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
          }}
          onBlur={commitRename}
          className="text-[length:var(--text-sm)] font-mono text-text-primary bg-bg-overlay border border-border-focus rounded px-2 py-0.5 min-w-[100px] outline-none leading-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          className="text-[length:var(--text-sm)] font-mono leading-none text-text-secondary
            hover:text-text-primary transition-colors duration-[var(--duration-fast)]
            truncate min-w-0 cursor-pointer"
          title={t("terminal.pane.renameHint")}
          onClick={startRename}
        >
          {session.label || " "}
        </button>
      )}

      {/* Action buttons — visible on hover or when active */}
        <div
          className={[
            "flex items-center gap-0.5 ml-auto transition-opacity duration-[var(--duration-fast)]",
            isActive ? "opacity-60 group-hover/pane:opacity-100" : "opacity-0 group-hover/pane:opacity-100",
          ].join(" ")}
        >
          {/* Float — only available in split */}
          {hasSplits && (
            <button
              type="button"
              onClick={() => useSessionStore.getState().floatPane(sessionId)}
              className={btnClass}
              aria-label={t("terminal.pane.floatAria")}
              title={t("terminal.pane.floatAria")}
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
            aria-label={t("terminal.pane.splitAria")}
            title={t("terminal.pane.splitAria")}
          >
            <SplitSquareVertical size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>

          {/* Close pane */}
          {hasSplits && (
            <button type="button" onClick={handleClose}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t("terminal.pane.closeAria")} title={t("terminal.pane.closeTitle")}>
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
              {t("terminal.pane.direction")}
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
              title={t("terminal.pane.horizontalSplit")}
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
              title={t("terminal.pane.verticalSplit")}
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
            <span>{t("terminal.pane.forkSession")}</span>
          </button>

          {/* Local terminal */}
          <button
            type="button"
            onClick={() => void doSplit("local")}
            className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
          >
            <Monitor size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            <span>{t("terminal.pane.localTerminal")}</span>
          </button>

          {/* Saved Hosts */}
          {hosts.length > 0 && (
            <>
              <div className="h-px bg-border/60 my-1 mx-2" />
              <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {t("terminal.pane.savedHosts")}
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

      {/* ── Accent popover ── */}
      {colorPopover && (() => {
        const popoverWidth = 220;
        let left = colorPopover.right - popoverWidth;
        if (left < 8) left = 8;
        if (left + popoverWidth > window.innerWidth - 8) {
          left = window.innerWidth - popoverWidth - 8;
        }
        let top = colorPopover.bottom + 4;
        const estimatedHeight = 120;
        if (top + estimatedHeight > window.innerHeight - 8) {
          top = colorPopover.top - estimatedHeight - 4;
        }

        const currentColor = session.accent ?? DEFAULT_ACCENT;

        return (
          <div
            ref={colorPopoverRef}
            className="fixed z-50 min-w-[200px] rounded-lg border border-border bg-bg-surface shadow-lg py-2 px-2"
            style={{ top, left }}
          >
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1.5 mb-1.5">
              {t("terminal.pane.accentTitle")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ACCENT_PRESETS.map((preset) => {
                const isSelected = currentColor === preset.color;
                return (
                  <button
                    key={preset.color}
                    type="button"
                    className={[
                      "w-6 h-6 rounded-full border-2 transition-transform duration-[var(--duration-fast)]",
                      isSelected
                        ? "border-text-primary scale-110"
                        : "border-transparent hover:scale-110",
                    ].join(" ")}
                    style={{ backgroundColor: preset.color }}
                    title={preset.label}
                    aria-label={preset.label}
                    onClick={() => handleSetAccent(preset.color)}
                  />
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
