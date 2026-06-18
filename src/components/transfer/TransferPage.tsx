import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Pane, ToolbarSourceButton } from "./Pane";
import { CrossTransferBar } from "./CrossTransferBar";
import { TransferPopover } from "../transfers/TransferPopover";
import { useUiStore } from "../../stores/ui-store";
import { useTransferStore } from "../../stores/transfer-store";
import type { PaneSource } from "../../stores/tab-store";
import type { ExplorerEntry } from "../../types/explorer";

// ─── Props ──────────────────────────────────────────────────────────────────

interface TransferPageProps {
  left: PaneSource;
  right: PaneSource | null;
  standalone?: boolean;
  tabId?: string;
  onLabelChange?: (label: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TransferPage({
  left: initialLeft,
  right: initialRight,
  standalone,
  onLabelChange,
}: TransferPageProps) {
  const { t } = useTranslation();

  const paneLabel = useCallback((s: PaneSource | null): string => {
    if (!s) return "";
    if (s.type === "local") return t("pane.localLabel");
    if (s.type === "host") return s.label;
    if (s.type === "s3") return s.label;
    return t("pane.unknown");
  }, [t]);

  const [leftSource, setLeftSource] = useState<PaneSource>(initialLeft);
  const [rightSource, setRightSource] = useState<PaneSource | null>(initialRight);

  // Persist source changes so selections survive Home panel navigation.
  const persistLeft = useUiStore((s) => s.setTransferLeftSource);
  const persistRight = useUiStore((s) => s.setTransferRightSource);

  const handleLeftSourceChange = useCallback(
    (s: PaneSource) => { setLeftSource(s); persistLeft(s); },
    [persistLeft],
  );
  const handleRightSourceChange = useCallback(
    (s: PaneSource) => { setRightSource(s); persistRight(s); },
    [persistRight],
  );

  const [leftPath, setLeftPath] = useState("");
  const [rightPath, setRightPath] = useState("");
  const [leftEntries, setLeftEntries] = useState<ExplorerEntry[]>([]);
  const [rightEntries, setRightEntries] = useState<ExplorerEntry[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);

  // ─── Cross-pane transfer ────────────────────────────────────────────────

  const sourceTypeStr = useCallback((s: PaneSource | null): string => {
    if (!s) return "";
    if (s.type === "local") return "local";
    if (s.type === "host") return s.transport;
    return "s3";
  }, []);

  const sourceSessionStr = useCallback((s: PaneSource | null): string => {
    if (!s) return "";
    if (s.type === "local") return "";
    return s.sessionId;
  }, []);

  const doCrossTransfer = useCallback(
    async (entries: ExplorerEntry[], from: PaneSource, to: PaneSource, toDir: string) => {
      try {
        await invoke<string>("cross_transfer", {
          srcType: sourceTypeStr(from),
          srcSessionId: sourceSessionStr(from),
          srcPaths: entries.map((e) => e.id),
          dstType: sourceTypeStr(to),
          dstSessionId: sourceSessionStr(to),
          dstDir: toDir,
          srcLabelStr: paneLabel(from),
          dstLabelStr: paneLabel(to),
        });
      } catch (err) {
        console.error("Cross transfer failed:", err);
      }
    },
    [sourceTypeStr, sourceSessionStr, paneLabel],
  );

  const handleLeftPaste = useCallback(
    (entries: ExplorerEntry[], toDir: string) => {
      if (!rightSource) return;
      void doCrossTransfer(entries, rightSource, leftSource, toDir);
    },
    [doCrossTransfer, leftSource, rightSource],
  );

  const handleRightPaste = useCallback(
    (entries: ExplorerEntry[], toDir: string) => {
      if (!rightSource) return;
      void doCrossTransfer(entries, leftSource, rightSource, toDir);
    },
    [doCrossTransfer, leftSource, rightSource],
  );

  const handleTransferComplete = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ─── Tab label ───────────────────────────────────────────────────────────

  const tabLabel = useMemo(
    () => rightSource
      ? `${paneLabel(leftSource)} ↔ ${paneLabel(rightSource)}`
      : `${paneLabel(leftSource)} ↔ …`,
    [leftSource, rightSource],
  );

  const onLabelChangeRef = useRef(onLabelChange);
  onLabelChangeRef.current = onLabelChange;
  useEffect(() => {
    if (!standalone) onLabelChangeRef.current?.(tabLabel);
  }, [tabLabel, standalone]);

  // ─── Transfer popover (floating FAB) ─────────────────────────────────────

  const transferCount = useTransferStore((s) => {
    let count = 0;
    for (const t of s.transfers.values()) {
      if (t.status === "Queued" || t.status === "InProgress") count++;
    }
    return count;
  });
  const [fabAnchor, setFabAnchor] = useState<DOMRect | null>(null);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-bg-base relative">
      {/* ── Pane body — pt-0/pb-0 so pane card edges align with sidebar card edges */}
      <div className="flex-1 flex min-h-0 gap-0 pt-0 pb-0 px-2">
        {/* Left pane */}
        <div className="min-w-0 overflow-hidden flex-1 rounded-xl border border-border/40 bg-bg-surface">
          <Pane
            key={`left-${refreshKey}`}
            source={leftSource}
            side="left"
            currentPath={leftPath}
            onNavigate={setLeftPath}
            entries={leftEntries}
            onEntriesChange={(path, entries) => {
              setLeftPath(path);
              setLeftEntries(entries);
            }}
            onCrossPaneTransfer={handleLeftPaste}
            onSourceChange={handleLeftSourceChange}
          />
        </div>

        {/* Gutter */}
        <div className="w-3 shrink-0" />

        {/* Right pane */}
        <div className="min-w-0 overflow-hidden flex-1 rounded-xl border border-border/40 bg-bg-surface">
          {rightSource ? (
            <Pane
              key={`right-${refreshKey}`}
              source={rightSource}
              side="right"
              currentPath={rightPath}
              onNavigate={setRightPath}
              entries={rightEntries}
              onEntriesChange={(path, entries) => {
                setRightPath(path);
                setRightEntries(entries);
              }}
              onCrossPaneTransfer={handleRightPaste}
              onSourceChange={handleRightSourceChange}
            />
          ) : (
            <div className="flex flex-col h-full min-w-0">
              {/* Minimal toolbar with source selector */}
              <div className="flex items-center h-10 px-2 border-b border-border bg-bg-surface shrink-0">
                <ToolbarSourceButton source={null} onChange={handleRightSourceChange} />
              </div>
              {/* Empty file area */}
              <div className="flex-1 flex items-center justify-center">
                <span className="text-[length:var(--text-sm)] text-text-muted">{t("common:pane.notConnected")}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Transfer progress ── */}
      <CrossTransferBar onTransferComplete={handleTransferComplete} />

      {/* ── Floating transfer button (bottom-right) ── */}
      {transferCount > 0 && (
        <>
          <button
            type="button"
            className={[
              "absolute bottom-3 right-3 z-30",
              "flex items-center gap-1.5 pl-3 pr-3 py-1.5 rounded-full",
              "bg-accent text-white shadow-lg",
              "hover:bg-accent-hover transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            ].join(" ")}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setFabAnchor((prev) => (prev ? null : rect));
            }}
          >
            <ArrowUpDown size={15} strokeWidth={2} />
            <span className="text-[length:var(--text-xs)] font-semibold tabular-nums">
              {transferCount > 99 ? "99+" : transferCount}
            </span>
          </button>
          {fabAnchor && (
            <TransferPopover
              anchorRect={fabAnchor}
              onClose={() => setFabAnchor(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

