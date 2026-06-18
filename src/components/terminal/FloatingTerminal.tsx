import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { useSessionStore } from "../../stores/session-store";
import type { FloatingPaneInfo } from "../../stores/session-store";
import { Terminal } from "./Terminal";

interface Props {
  tabId: string;
  info: FloatingPaneInfo;
}

export function FloatingTerminal({ tabId, info }: Props) {
  const session = useSessionStore((s) => s.sessions.get(info.sessionId));
  const [pos, setPos] = useState({ x: info.x, y: info.y });
  const [size, setSize] = useState({ w: info.width, h: info.height });
  const dragging = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizing = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Drag (title bar) ───────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  }, [pos]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.sx;
    const dy = e.clientY - dragging.current.sy;
    const nx = Math.max(0, Math.min(window.innerWidth - 200, dragging.current.ox + dx));
    const ny = Math.max(0, Math.min(window.innerHeight - 80, dragging.current.oy + dy));
    setPos({ x: nx, y: ny });
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragging.current) return;
    useSessionStore.getState().updateFloatingPosition(tabId, info.sessionId, pos.x, pos.y);
    dragging.current = null;
  }, [tabId, info.sessionId, pos]);

  // ── Resize (bottom-right handle) ───────────────────────────────────────
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizing.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };
  }, [size]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const dx = e.clientX - resizing.current.sx;
    const dy = e.clientY - resizing.current.sy;
    const nw = Math.max(200, resizing.current.ow + dx);
    const nh = Math.max(120, resizing.current.oh + dy);
    setSize({ w: nw, h: nh });
  }, []);

  const onResizeEnd = useCallback(() => {
    if (!resizing.current) return;
    useSessionStore.getState().updateFloatingSize(tabId, info.sessionId, size.w, size.h);
    resizing.current = null;
  }, [tabId, info.sessionId, size]);

  // Sync initial position/size changes from store
  useEffect(() => {
    setPos({ x: info.x, y: info.y });
    setSize({ w: info.width, h: info.height });
  }, [info.x, info.y, info.width, info.height]);

  const handleClose = useCallback(() => {
    void useSessionStore.getState().removeFloatingPane(info.sessionId);
  }, [info.sessionId]);

  if (!session) return null;

  const status = session.status;
  const dotColor =
    status === "Connected"    ? "bg-status-connected" :
    status === "Connecting"   ? "bg-status-connecting motion-safe:animate-pulse" :
    status === "Error"        ? "bg-status-error" :
                                "bg-status-disconnected";

  return (
    <div
      ref={rootRef}
      className="fixed z-40 flex flex-col rounded-lg border border-border/60 bg-bg-base shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center h-7 px-2.5 gap-2 shrink-0 bg-bg-surface/80 border-b border-border/40 cursor-move select-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-[11px] font-mono truncate flex-1 min-w-0 leading-none text-text-secondary">
          {session.sessionType === "local" ? "Local" : session.hostConfig.host}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="flex items-center justify-center w-4 h-4 rounded text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors"
          aria-label="Close floating pane"
        >
          <X size={11} strokeWidth={2} />
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 relative">
        <Terminal sessionId={info.sessionId} />
      </div>

      {/* Resize handle — bottom-right */}
      <div
        className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      >
        <svg
          width="12" height="12" viewBox="0 0 12 12"
          className="absolute right-0.5 bottom-0.5 text-text-muted/40"
        >
          <path d="M0 12 L12 0 L12 12 Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}
