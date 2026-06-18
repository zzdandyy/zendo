import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, CheckCircle2, XCircle, Ban } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CrossTransferItem {
  transferId: string;
  srcLabel: string;
  dstLabel: string;
  status: "InProgress" | "Completed" | "Failed" | "Cancelled" | "Queued";
  error?: string;
  bytesTransferred: number;
  totalBytes: number;
  filesDone: number;
  filesTotal: number;
  speedBps: number;
  etaSecs?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CrossTransferBarProps {
  /** Called when any transfer completes — target pane should refresh. */
  onTransferComplete?: () => void;
}

export function CrossTransferBar({ onTransferComplete }: CrossTransferBarProps) {
  const { t } = useTranslation();
  const cancelLabel = t("common:transfer.cancel", "Cancel");
  const dismissLabel = t("common:dismiss", "Dismiss");
  const [items, setItems] = useState<CrossTransferItem[]>([]);
  const completedRef = useRef<Set<string>>(new Set());

  // Listen for cross:transfer events
  useEffect(() => {
    let aborted = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (aborted) return;

        const unsub = await listen<any>("cross:transfer", (event) => {
          if (aborted) return;
          const p = event.payload;
          const item: CrossTransferItem = {
            transferId: p.transfer_id,
            srcLabel: p.src_label,
            dstLabel: p.dst_label,
            status: p.status,
            error: p.error,
            bytesTransferred: p.bytes_transferred,
            totalBytes: p.total_bytes,
            filesDone: p.files_done,
            filesTotal: p.files_total,
            speedBps: p.speed_bps,
            etaSecs: p.eta_secs,
          };

          setItems((prev) => {
            const idx = prev.findIndex((x) => x.transferId === item.transferId);
            const next = [...prev];
            if (idx >= 0) {
              next[idx] = item;
            } else {
              next.push(item);
            }

            // Trigger refresh when a transfer completes
            if (
              (item.status === "Completed" || item.status === "Failed" || item.status === "Cancelled") &&
              !completedRef.current.has(item.transferId)
            ) {
              completedRef.current.add(item.transferId);
              // Auto-remove completed items after 5s
              setTimeout(() => {
                setItems((cur) => cur.filter((x) => x.transferId !== item.transferId));
                completedRef.current.delete(item.transferId);
              }, 5000);
              onTransferComplete?.();
            }

            return next;
          });
        });

        if (!aborted) unlisten = unsub;
      } catch {
        // Not in Tauri context
      }
    })();

    return () => {
      aborted = true;
      unlisten?.();
    };
  }, [onTransferComplete]);

  // Cancel
  const handleCancel = useCallback(async (transferId: string) => {
    try {
      await invoke("cross_cancel_transfer", { transferId });
    } catch (err) {
      console.error("Failed to cancel transfer:", err);
    }
  }, []);

  // Dismiss a completed/failed item
  const handleDismiss = useCallback((transferId: string) => {
    setItems((prev) => prev.filter((x) => x.transferId !== transferId));
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col border-t border-border bg-bg-subtle">
      {items.map((item) => (
        <TransferRow
          key={item.transferId}
          item={item}
          onCancel={handleCancel}
          onDismiss={handleDismiss}
          cancelLabel={cancelLabel}
          dismissLabel={dismissLabel}
        />
      ))}
    </div>
  );
}

// ─── Single transfer row ────────────────────────────────────────────────────

function TransferRow({
  item,
  onCancel,
  onDismiss,
  cancelLabel,
  dismissLabel,
}: {
  item: CrossTransferItem;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  cancelLabel: string;
  dismissLabel: string;
}) {
  const { t } = useTranslation();

  function formatSpeed(bps: number): string {
    const s = formatSpeedValue(bps);
    return t(`transfer.${s.unitKey}`, { value: s.value });
  }

  const isActive = item.status === "InProgress" || item.status === "Queued";
  const isDone = item.status === "Completed";
  const isError = item.status === "Failed" || item.status === "Cancelled";

  const pct =
    item.totalBytes > 0
      ? Math.round((item.bytesTransferred / item.totalBytes) * 100)
      : item.filesTotal > 0
        ? Math.round((item.filesDone / item.filesTotal) * 100)
        : 0;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-xs)]">
      {/* Icon */}
      {isActive && <Loader2 size={12} className="animate-spin text-accent shrink-0" />}
      {isDone && <CheckCircle2 size={12} className="text-green-500 shrink-0" />}
      {isError && <XCircle size={12} className="text-danger shrink-0" />}

      {/* Labels */}
      <span className="text-text-secondary truncate flex-1 min-w-0">
        <span className="font-medium">{item.srcLabel}</span>
        {" → "}
        <span className="font-medium">{item.dstLabel}</span>
        {item.filesTotal > 0 && (
          <span className="text-text-muted ml-1">
            ({item.filesDone}/{item.filesTotal})
          </span>
        )}
      </span>

      {/* Progress bar */}
      {isActive && (
        <div className="w-24 h-1.5 bg-bg-surface rounded-full overflow-hidden shrink-0">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Speed */}
      {isActive && item.speedBps > 0 && (
        <span className="text-text-muted shrink-0 tabular-nums">
          {formatSpeed(item.speedBps)}
        </span>
      )}

      {/* Error message */}
      {isError && item.error && (
        <span className="text-danger truncate max-w-[200px] shrink-0" title={item.error}>
          {item.error}
        </span>
      )}

      {/* Actions */}
      {isActive && (
        <button
          type="button"
          className="p-0.5 text-text-muted hover:text-danger transition-colors shrink-0"
          onClick={() => onCancel(item.transferId)}
          title={cancelLabel}
        >
          <Ban size={12} />
        </button>
      )}
      {!isActive && (
        <button
          type="button"
          className="p-0.5 text-text-muted hover:text-text-secondary transition-colors shrink-0"
          onClick={() => onDismiss(item.transferId)}
          title={dismissLabel}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatSpeedValue(bytesPerSec: number): { value: string; unitKey: string } {
  if (bytesPerSec >= 1_000_000) return { value: (bytesPerSec / 1_000_000).toFixed(1), unitKey: "speedMbs" };
  if (bytesPerSec >= 1_000) return { value: (bytesPerSec / 1_000).toFixed(1), unitKey: "speedKbs" };
  return { value: String(bytesPerSec), unitKey: "speedBps" };
}
