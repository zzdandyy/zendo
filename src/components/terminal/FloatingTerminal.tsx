import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useSessionStore, DEFAULT_ACCENT } from "../../stores/session-store";
import type { FloatingPaneInfo } from "../../stores/session-store";
import {
  suppressTerminalFits,
  resumeTerminalFits,
} from "../../stores/terminal-instances";
import { TERMINAL_MARGIN } from "../../lib/layout";
import { Terminal } from "./Terminal";

/** Accent colour presets (shared with PaneHeader). */
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

interface Props {
  tabId: string;
  info: FloatingPaneInfo;
}

type Corner = "br" | "bl" | "tr" | "tl";

interface Gesture {
  type: "drag" | "resize";
  sx: number; sy: number;
  ox: number; oy: number;       // original left / top
  ow: number; oh: number;       // original width / height
  bx: number; by: number;       // content-area left / top
  bw: number; bh: number;       // content-area width / height
  corner?: Corner;              // resize only
}

/** Get the terminal content area bounds (below tab bar, inside padding).
 *  Terminals sit inside `pt-2.5` (10px) within content-bounds. */
function getContentBounds() {
  const el = document.querySelector("[data-content-bounds]");
  if (!el) {
    return {
      left: TERMINAL_MARGIN + 2, top: TERMINAL_MARGIN * 2 + 28 + 2,
      width: window.innerWidth - TERMINAL_MARGIN * 2 - 4,
      height: window.innerHeight - TERMINAL_MARGIN * 3 - 28 - 4,
    };
  }
  const r = el.getBoundingClientRect();
  return { left: r.left + 2, top: r.top + TERMINAL_MARGIN + 2, width: r.width - 4, height: r.height - TERMINAL_MARGIN - 4 };
}

const MIN_W = 200;
const MIN_H = 120;

const CORNER_CURSORS: Record<Corner, string> = {
  br: "cursor-se-resize",
  bl: "cursor-sw-resize",
  tr: "cursor-ne-resize",
  tl: "cursor-nw-resize",
};

const CORNER_CLASSES: Record<Corner, string> = {
  br: "right-0 bottom-0",
  bl: "left-0 bottom-0",
  tr: "right-0 top-0",
  tl: "left-0 top-0",
};

export function FloatingTerminal({ tabId, info }: Props) {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.sessions.get(info.sessionId));
  const isActive = useSessionStore((s) => s.activeSessionId === info.sessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const [pos, setPos] = useState({ x: info.x, y: info.y });
  const [size, setSize] = useState({ w: info.width, h: info.height });
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  // ── Inline rename ───────────────────────────────────────────────────────
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(() => {
    if (renaming || !session) return;
    setRenameValue(session.label);
    setRenaming(true);
  }, [session, renaming]);

  const commitRename = useCallback(() => {
    useSessionStore.getState().renameSession(info.sessionId, renameValue.trim());
    setRenaming(false);
  }, [info.sessionId, renameValue]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  useEffect(() => {
    if (renaming) {
      const el = renameInputRef.current;
      if (el) { el.focus(); el.select(); }
    }
  }, [renaming]);

  // ── Accent colour popover ────────────────────────────────────────────────
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
    useSessionStore.getState().setAccent(info.sessionId, color);
    setColorPopover(null);
  }, [info.sessionId]);

  const blurXterm = () => {
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && ae.closest(".xterm")) ae.blur();
  };

  // ── Drag (title bar) ──────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Don't start drag on interactive elements (buttons, inputs)
    if (target.closest("button, input")) return;
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    blurXterm();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bounds = getContentBounds();
    gesture.current = {
      type: "drag",
      sx: e.clientX, sy: e.clientY,
      ox: rect.left, oy: rect.top,
      ow: rect.width, oh: rect.height,
      bx: bounds.left, by: bounds.top,
      bw: bounds.width, bh: bounds.height,
    };
    if (rootRef.current) rootRef.current.style.willChange = "transform";
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.type !== "drag" || !rootRef.current) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    const nx = Math.max(g.bx, Math.min(g.bx + g.bw - g.ow, g.ox + dx));
    const ny = Math.max(g.by, Math.min(g.by + g.bh - g.oh, g.oy + dy));
    rootRef.current.style.transform = `translate(${nx - g.ox}px, ${ny - g.oy}px)`;
  }, []);

  const onDragEnd = useCallback(() => {
    const g = gesture.current;
    if (!g || g.type !== "drag") { gesture.current = null; return; }
    const rect = rootRef.current?.getBoundingClientRect();
    const nx = rect ? Math.round(rect.left) : g.ox;
    const ny = rect ? Math.round(rect.top) : g.oy;
    if (rootRef.current) {
      rootRef.current.style.transform = "";
      rootRef.current.style.willChange = "";
    }
    setPos({ x: nx, y: ny });
    useSessionStore.getState().updateFloatingPosition(tabId, info.sessionId, nx, ny);
    gesture.current = null;
  }, [tabId, info.sessionId]);

  // ── Resize (all four corners) ─────────────────────────────────────────
  const onResizeStart = useCallback((corner: Corner) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    blurXterm();
    const r = rootRef.current;
    if (!r) return;
    const rect = r.getBoundingClientRect();
    const bounds = getContentBounds();
    gesture.current = {
      type: "resize",
      corner,
      sx: e.clientX, sy: e.clientY,
      ox: rect.left, oy: rect.top,
      ow: rect.width, oh: rect.height,
      bx: bounds.left, by: bounds.top,
      bw: bounds.width, bh: bounds.height,
    };
    r.style.willChange = "width, height, left, top";
    suppressTerminalFits();
  }, []);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.type !== "resize" || !g.corner || !rootRef.current) return;
    const r = rootRef.current;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    const c = g.corner;

    // Which edges are anchored vs moved.
    const leftMoves = c === "tl" || c === "bl";
    const topMoves = c === "tl" || c === "tr";
    const rightMoves = c === "tr" || c === "br";
    const bottomMoves = c === "bl" || c === "br";

    let nw = g.ow;
    let nh = g.oh;
    let nx = g.ox;
    let ny = g.oy;

    if (leftMoves) {
      nw = g.ow - dx;
      if (nw >= MIN_W) { nx = g.ox + dx; } else { nw = MIN_W; nx = g.ox + g.ow - MIN_W; }
    } else if (rightMoves) {
      nw = Math.max(MIN_W, g.ow + dx);
    }

    if (topMoves) {
      nh = g.oh - dy;
      if (nh >= MIN_H) { ny = g.oy + dy; } else { nh = MIN_H; ny = g.oy + g.oh - MIN_H; }
    } else if (bottomMoves) {
      nh = Math.max(MIN_H, g.oh + dy);
    }

    // Clamp position and size to content area
    nx = Math.max(g.bx, Math.min(g.bx + g.bw - MIN_W, nx));
    ny = Math.max(g.by, Math.min(g.by + g.bh - MIN_H, ny));
    // Don't let the right/bottom edge push past the content area
    if (nx + nw > g.bx + g.bw) nw = g.bx + g.bw - nx;
    if (ny + nh > g.by + g.bh) nh = g.by + g.bh - ny;

    r.style.width = `${nw}px`;
    r.style.height = `${nh}px`;
    r.style.left = `${nx}px`;
    r.style.top = `${ny}px`;
  }, []);

  const onResizeEnd = useCallback(() => {
    const g = gesture.current;
    if (!g || g.type !== "resize") { gesture.current = null; return; }
    const r = rootRef.current;
    const nw = parseInt(r?.style.width || "", 10);
    const nh = parseInt(r?.style.height || "", 10);
    const nx = parseInt(r?.style.left || "", 10);
    const ny = parseInt(r?.style.top || "", 10);
    if (r) r.style.willChange = "";
    if (!isNaN(nw) && !isNaN(nh)) {
      setSize({ w: nw, h: nh });
      useSessionStore.getState().updateFloatingSize(tabId, info.sessionId, nw, nh);
    }
    if (!isNaN(nx) && !isNaN(ny)) {
      setPos({ x: nx, y: ny });
      useSessionStore.getState().updateFloatingPosition(tabId, info.sessionId, nx, ny);
    }
    gesture.current = null;
    resumeTerminalFits();
  }, [tabId, info.sessionId]);

  // ── Safety: pointer cancel / lost capture ────────────────────────────
  const onGestureCancel = useCallback(() => {
    if (!gesture.current) return;
    if (rootRef.current) rootRef.current.style.willChange = "";
    if (gesture.current?.type === "resize") resumeTerminalFits();
    gesture.current = null;
  }, []);

  // Sync initial position/size changes from store
  useEffect(() => {
    setPos({ x: info.x, y: info.y });
    setSize({ w: info.width, h: info.height });
  }, [info.x, info.y, info.width, info.height]);

  const handleClose = useCallback(() => {
    void useSessionStore.getState().removeFloatingPane(info.sessionId);
  }, [info.sessionId]);

  if (!session) return null;

  const accent = session.accent ?? "oklch(0.80 0 0)";

  return (
    <div
      ref={rootRef}
      className={[
        "fixed flex flex-col rounded-lg overflow-hidden shadow-2xl bg-bg-base",
        isActive ? "z-50" : "z-40",
        "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
        !isActive && "border border-border/60",
        isActive && "border-2",
      ].join(" ")}
      style={
        isActive
          ? { left: pos.x, top: pos.y, width: size.w, height: size.h, borderColor: accent }
          : { left: pos.x, top: pos.y, width: size.w, height: size.h }
      }
      onClick={() => {
        if (!isActive) setActiveSession(info.sessionId);
      }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center h-8 px-2.5 gap-2 shrink-0 cursor-move select-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onLostPointerCapture={onGestureCancel}
      >
        {/* Colour swatch */}
        <button
          ref={colorBtnRef}
          type="button"
          className="w-2.5 h-2.5 rounded-sm shrink-0 hover:scale-110 transition-transform cursor-pointer"
          style={{ backgroundColor: session.accent ?? DEFAULT_ACCENT }}
          title={t("terminal.pane.accentTitle")}
          aria-label={t("terminal.pane.accentAria")}
          onClick={toggleColorPopover}
          onPointerDown={(e) => e.stopPropagation()}
        />
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
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="text-[length:var(--text-sm)] font-mono leading-none text-text-secondary
              hover:text-text-primary transition-colors duration-[var(--duration-fast)]
              truncate min-w-0 cursor-pointer"
            title={t("terminal.pane.renameHint")}
            onClick={startRename}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {session.label || " "}
          </button>
        )}
        <button
          type="button"
          onClick={handleClose}
          className="ml-auto flex items-center justify-center w-4 h-4 rounded text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors"
          aria-label={t("terminal.floating.closeAria")}
        >
          <X size={11} strokeWidth={2} />
        </button>

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
              onPointerDown={(e) => e.stopPropagation()}
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
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 relative">
        <Terminal sessionId={info.sessionId} />
      </div>

      {/* Resize handles — all four corners */}
      {(["br", "bl", "tr", "tl"] as Corner[]).map((corner) => (
        <div
          key={corner}
          className={`absolute w-4 h-4 ${CORNER_CLASSES[corner]} ${CORNER_CURSORS[corner]}`}
          onPointerDown={onResizeStart(corner)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onLostPointerCapture={onGestureCancel}
        />
      ))}
    </div>
  );
}
