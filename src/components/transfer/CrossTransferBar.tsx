import { useCallback, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, CheckCircle2, XCircle, Ban } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTransferStore } from "../../stores/transfer-store";
import type { TransferEvent } from "../../types";
import { getStatusString, formatSpeed, formatBytes } from "../../utils/format";

// ─── Component ──────────────────────────────────────────────────────────────

interface CrossTransferBarProps {
  /** Called when any transfer completes — target pane should refresh. */
  onTransferComplete?: () => void;
}

export function CrossTransferBar({ onTransferComplete }: CrossTransferBarProps) {
  const { t } = useTranslation();
  const cancelLabel = t("common:transfer.cancel", "Cancel");
  const dismissLabel = t("common:dismiss", "Dismiss");

  // Read cross-pane transfers from TransferStore (identified by sentinel session id).
  // Select the raw Map first, then convert with useMemo — per CLAUDE.md:
  // "Array.from(map.values()) in a Zustand selector creates a new array each
  // evaluation → infinite loop. Fix: select the Map first, then convert to
  // array with useMemo."
  const transfers = useTransferStore((s) => s.transfers);
  const items = useMemo(() => {
    const result: TransferEvent[] = [];
    for (const t of transfers.values()) {
      if (t.sftp_session_id === "__cross__") {
        result.push(t);
      }
    }
    return result;
  }, [transfers]);
  const removeTransfer = useTransferStore((s) => s.removeTransfer);

  // Track completed transfer IDs to fire onTransferComplete exactly once.
  const completedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const item of items) {
      const s = getStatusString(item.status);
      if (
        (s === "Completed" || s === "Failed" || s === "Cancelled") &&
        !completedRef.current.has(item.transfer_id)
      ) {
        completedRef.current.add(item.transfer_id);
        onTransferComplete?.();
      }
    }
  }, [items, onTransferComplete]);

  // Cancel
  const handleCancel = useCallback(async (transferId: string) => {
    try {
      await invoke("cross_cancel_transfer", { transferId });
    } catch (err) {
      console.error("Failed to cancel cross-transfer:", err);
    }
  }, []);

  // Dismiss — remove from the store so it disappears from both the
  // inline bar and the popover.
  const handleDismiss = useCallback(
    (transferId: string) => {
      removeTransfer(transferId);
      completedRef.current.delete(transferId);
    },
    [removeTransfer],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col border-t border-border bg-bg-subtle">
      {items.map((item) => (
        <TransferRow
          key={item.transfer_id}
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
  item: TransferEvent;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  cancelLabel: string;
  dismissLabel: string;
}) {
  const statusStr = getStatusString(item.status);
  const isActive = statusStr === "InProgress" || statusStr === "Queued";
  const isDone = statusStr === "Completed";
  const isError = statusStr === "Failed" || statusStr === "Cancelled";

  const pct =
    item.total_bytes > 0
      ? Math.round((item.bytes_transferred / item.total_bytes) * 100)
      : item.files_total > 0
        ? Math.round((item.files_done / item.files_total) * 100)
        : 0;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-xs)]">
      {/* Icon */}
      {isActive && <Loader2 size={12} className="animate-spin text-accent shrink-0" />}
      {isDone && <CheckCircle2 size={12} className="text-green-500 shrink-0" />}
      {isError && <XCircle size={12} className="text-danger shrink-0" />}

      {/* Labels */}
      <span className="text-text-secondary truncate flex-1 min-w-0">
        <span className="font-medium">{item.name}</span>
        {item.files_total > 0 && (
          <span className="text-text-muted ml-1">
            ({item.files_done}/{item.files_total})
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
      {isActive && item.speed_bps > 0 && (
        <span className="text-text-muted shrink-0 tabular-nums">
          {formatSpeed(item.speed_bps)}
        </span>
      )}

      {/* Detail line: bytes + ETA for active, total bytes for completed */}
      <span className="text-text-muted shrink-0 tabular-nums">
        {isActive && item.total_bytes > 0
          ? `${formatBytes(item.bytes_transferred)} / ${formatBytes(item.total_bytes)}`
          : item.total_bytes > 0
            ? formatBytes(item.total_bytes)
            : ""}
      </span>

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
          onClick={() => onCancel(item.transfer_id)}
          title={cancelLabel}
        >
          <Ban size={12} />
        </button>
      )}
      {!isActive && (
        <button
          type="button"
          className="p-0.5 text-text-muted hover:text-text-secondary transition-colors shrink-0"
          onClick={() => onDismiss(item.transfer_id)}
          title={dismissLabel}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
