import { useRef, useCallback } from "react";
import type { SplitNode } from "../../types";
import { useSessionStore } from "../../stores/session-store";
import {
  suppressTerminalFits,
  resumeTerminalFits,
} from "../../stores/terminal-instances";
import { SplitHandle } from "./SplitHandle";
import { TerminalArea } from "./TerminalArea";


interface SplitContainerProps {
  node: SplitNode;
  path: number[];
  tabId: string;
}

export function SplitContainer({ node, path, tabId }: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const childARef = useRef<HTMLDivElement>(null);
  const childBRef = useRef<HTMLDivElement>(null);
  const updateSplitRatio = useSessionStore((s) => s.updateSplitRatio);
  const isZoomed = useSessionStore((s) => s.zoomedPaneId !== null);

  const isHorizontal = node.direction === "horizontal";

  const ratioRef = useRef(node.ratio);
  ratioRef.current = node.ratio;

  // ── Drag start: suppress terminal fits ──────────────────────────────
  const handleResizeStart = useCallback(() => {
    // Blur any focused xterm textarea — focused xterm runs heavy per-frame
    // work during resize, dominating the frame budget.
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && ae.closest(".xterm")) ae.blur();
    suppressTerminalFits();
  }, []);

  // ── Drag move: direct DOM flex manipulation (no React render) ───────
  const handleResize = useCallback(
    (delta: number) => {
      const container = containerRef.current;
      const a = childARef.current;
      const b = childBRef.current;
      if (!container || !a || !b) return;

      const total = isHorizontal ? container.offsetWidth : container.offsetHeight;
      if (total === 0) return;

      const ratioDelta = delta / total;
      const clamped = Math.max(0.15, Math.min(0.85, ratioRef.current + ratioDelta));
      ratioRef.current = clamped;

      a.style.flex = `${clamped} 1 0%`;
      b.style.flex = `${1 - clamped} 1 0%`;
    },
    [isHorizontal],
  );

  // ── Drag end: commit ratio + flush pending terminal fits ────────────
  const handleResizeEnd = useCallback(() => {
    const a = childARef.current;
    if (!a) return;

    const flexValue = parseFloat(a.style.flex);
    if (isNaN(flexValue) || flexValue <= 0 || flexValue >= 1) return;

    updateSplitRatio(tabId, path, flexValue);
    resumeTerminalFits();
  }, [tabId, path, updateSplitRatio, node]);

  return (
    <div
      ref={containerRef}
      data-testid="split-container"
      data-split-direction={node.direction}
      data-zoomed={isZoomed}
      className={`flex h-full w-full gap-0 overflow-visible ${isHorizontal ? "flex-row" : "flex-col"}`}
    >
      <div
        ref={childARef}
        style={{ flex: `${node.ratio} 1 0%` }}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <TerminalArea node={node.children[0]} path={[...path, 0]} tabId={tabId} />
      </div>
      {!isZoomed && (
        <SplitHandle
          direction={node.direction}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}
      <div
        ref={childBRef}
        style={{ flex: `${1 - node.ratio} 1 0%` }}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <TerminalArea node={node.children[1]} path={[...path, 1]} tabId={tabId} />
      </div>
    </div>
  );
}
