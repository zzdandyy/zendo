import { useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useTransferStore } from "../../stores/transfer-store";
import type { TransferEvent, TransferStatusValue } from "../../types";
import { getStatusString } from "../../utils/format";
import { TransferRow } from "./TransferRow";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortPriority(status: TransferStatusValue): number {
  const s = getStatusString(status);
  if (s === "InProgress") return 0;
  if (s === "Queued") return 1;
  return 2;
}

interface Stats {
  list: TransferEvent[];
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  cancelledCount: number;
}

function computeStats(transfers: Map<string, TransferEvent>): Stats {
  let activeCount = 0;
  let queuedCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  const list: TransferEvent[] = [];

  for (const t of transfers.values()) {
    list.push(t);
    const s = getStatusString(t.status);
    if (s === "InProgress") activeCount++;
    else if (s === "Queued") queuedCount++;
    else if (s === "Completed") completedCount++;
    else if (s === "Cancelled") cancelledCount++;
  }

  list.sort((a, b) => sortPriority(a.status) - sortPriority(b.status));
  return { list, activeCount, queuedCount, completedCount, cancelledCount };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TransferPopoverProps {
  /** Rect of the trigger button — used to anchor the popover */
  anchorRect: DOMRect | null;
  onClose: () => void;
}

export function TransferPopover({ anchorRect, onClose }: TransferPopoverProps) {
  const { t } = useTranslation();
  const transfers = useTransferStore((s) => s.transfers);
  const removeTransfer = useTransferStore((s) => s.removeTransfer);
  const clearFinished = useTransferStore((s) => s.clearFinished);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Clear terminal transfers when the popover opens.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (!prevOpen.current) { prevOpen.current = true; return; }
    clearFinished();
  }, [clearFinished]);

  const stats = useMemo(() => computeStats(transfers), [transfers]);
  const { list, activeCount, queuedCount, completedCount, cancelledCount } = stats;

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay attachment to avoid the triggering click from immediately closing
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  /** Which backend owns a transfer, inferred from its session-id field. */
  const protocolOf = useCallback((id: string): "s3" | "scp" | "sftp" | "cross" => {
    const t = transfers.get(id);
    if (t?.s3_session_id) return "s3";
    if (t?.scp_session_id) return "scp";
    if (t?.sftp_session_id === "__cross__") return "cross";
    return "sftp";
  }, [transfers]);

  const handleCancel = useCallback((id: string) => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const proto = protocolOf(id);
        if (proto === "cross") {
          await invoke("cross_cancel_transfer", { transferId: id });
        } else {
          await invoke(`${proto}_cancel_transfer`, { transferId: id });
        }
      } catch {
        removeTransfer(id);
      }
    })();
  }, [removeTransfer, protocolOf]);

  const handleRetry = useCallback((id: string) => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const proto = protocolOf(id);
        if (proto === "cross") {
          // Cross-pane transfers don't have a retry command — just dismiss.
          removeTransfer(id);
          return;
        }
        await invoke(`${proto}_retry_transfer`, { transferId: id });
      } catch { /* best-effort */ }
    })();
  }, [protocolOf, removeTransfer]);

  const handleDismiss = useCallback((id: string) => {
    removeTransfer(id);
  }, [removeTransfer]);

  // ─── Positioning ────────────────────────────────────────────────────────────

  // Anchor to the right of the trigger button, aligned to bottom,
  // clamped to stay within viewport bounds.
  const POPOVER_W = 340;
  const style: React.CSSProperties = {};
  if (anchorRect) {
    const gap = 8;
    let left = anchorRect.right + gap;
    if (left + POPOVER_W > window.innerWidth - gap) {
      left = window.innerWidth - POPOVER_W - gap;
    }
    left = Math.max(gap, left);
    style.position = "fixed";
    style.left = left;
    style.bottom = window.innerHeight - anchorRect.bottom;
    style.zIndex = 50;
  }

  // ─── Summary text ───────────────────────────────────────────────────────────

  const summaryParts: string[] = [];
  if (activeCount > 0) summaryParts.push(t("status.active", { count: activeCount }));
  if (queuedCount > 0) summaryParts.push(t("status.queued_count", { count: queuedCount }));
  if (completedCount > 0) summaryParts.push(t("status.done_count", { count: completedCount }));
  if (cancelledCount > 0) summaryParts.push(t("status.cancelled_count", { count: cancelledCount }));

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("transfers.popover.titleAria")}
      style={style}
      className={[
        "w-[340px] flex flex-col",
        "bg-bg-surface border border-border rounded-xl",
        "shadow-[var(--shadow-lg)]",
        "animate-[fadeIn_120ms_var(--ease-expo-out)_both]",
      ].join(" ")}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/60 shrink-0">
        <span className="text-[length:var(--text-xs)] font-semibold text-text-primary">
          {t("transfers.popover.title")}
        </span>

        {summaryParts.length > 0 && (
          <span className="text-[length:var(--text-2xs)] text-text-muted tabular-nums">
            {summaryParts.join(" \u00b7 ")}
          </span>
        )}

        <span className="flex-1" />

        {/* Close */}
        <button
          onClick={onClose}
          title={t("button.close")}
          aria-label={t("transfers.popover.close")}
          className={[
            "flex items-center justify-center w-7 h-7 rounded-md",
            "text-text-muted hover:text-text-primary hover:bg-bg-subtle",
            "transition-colors duration-[var(--duration-fast)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ].join(" ")}
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Transfer list */}
      {list.length > 0 ? (
        <div
          className="overflow-y-auto flex-1"
          style={{ maxHeight: "min(400px, 50vh)" }}
          role="list"
          aria-label={t("transfers.popover.transferItemsAria")}
        >
          {list.map((t) => (
            <TransferRow
              key={t.transfer_id}
              transfer={t}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <p className="text-[length:var(--text-xs)] text-text-muted">
            {t("transfers.popover.noTransfers")}
          </p>
          <p className="text-[length:var(--text-2xs)] text-text-muted/60">
            {t("transfers.popover.noTransfersHint")}
          </p>
        </div>
      )}
    </div>
  );
}
