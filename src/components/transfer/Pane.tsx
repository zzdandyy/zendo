import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, HardDrive, Cloud } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useS3Store } from "../../stores/s3-store";
import { useHostsStore } from "../../stores/hosts-store";
import type { SftpEntry } from "../../types";
import type { ExplorerEntry, ExplorerClipboard, ChmodResult } from "../../types/explorer";
import type { PaneSource } from "../../stores/tab-store";
import { ExplorerToolbar, ExplorerFileTable, ExplorerDropZone } from "../explorer";
import { createSftpProvider, toExplorerEntry as toSftpExplorer } from "../../providers/sftp-provider";
import { createS3Provider, toS3ExplorerEntry } from "../../providers/s3-provider";
import { createLocalProvider, toLocalExplorerEntry } from "../../providers/local-provider";
import { explorerInvoke, transferEventName, type Transport } from "../../lib/explorer-transport";
import { editorLaunchErrorMessage } from "../../lib/editor-errors";
import { conflictingNames } from "../../lib/drop-conflicts";
import { toast } from "../../stores/toast-store";
import type { EditorConfig } from "../../stores/settings-store";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PaneProps {
  source: PaneSource;
  side: "left" | "right";
  /** Callback for cross-pane clipboard paste — called when pasting entries from
   *  another pane into this one. `toDir` is the destination directory. */
  onCrossPaneTransfer?: (entries: ExplorerEntry[], toDir: string) => void;
  /** Called when the user switches source via the toolbar selector. */
  onSourceChange?: (s: PaneSource) => void;
  /** Current directory path — managed externally by TransferPage. */
  currentPath: string;
  onNavigate: (path: string) => void;
  entries: ExplorerEntry[];
  onEntriesChange: (path: string, entries: ExplorerEntry[]) => void;
  busy?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DRAGOUT_STAGING_SEGMENT = "anyscp-dragout";

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return fallback;
}

/** Best-effort detection: Tauri on Windows reports physical pixels for
 *  drag-drop events, while macOS/Linux report CSS pixels. */
function isWindowsWebview(): boolean {
  return navigator.platform?.toLowerCase().includes("win") ?? false;
}

// ─── Entry conversion helpers ────────────────────────────────────────────────

function toExplorerEntries(sourceType: string, raw: unknown[]): ExplorerEntry[] {
  if (sourceType === "host") return (raw as SftpEntry[]).map(toSftpExplorer);
  if (sourceType === "s3") return (raw as any[]).map(toS3ExplorerEntry);
  if (sourceType === "local") return (raw as any[]).map(toLocalExplorerEntry);
  return [];
}

// ─── Toolbar source button ─────────────────────────────────────────────────

function sourceLabel(s: PaneSource, t: (key: string) => string): string {
  if (s.type === "local") return t("pane.localLabel");
  if (s.type === "host") return s.label;
  if (s.type === "s3") return s.label;
  return "";
}

async function connectHostForPane(host: any, onChange: (s: PaneSource) => void) {
  const attemptId = crypto.randomUUID();
  const { invoke } = await import("@tauri-apps/api/core");
  const sshSessionId = await invoke<string>("connect_saved_host_no_pty", {
    hostId: host.id,
    attemptId,
  });
  let explorerSessionId: string;
  let transport: "sftp" | "scp" = "sftp";
  try {
    explorerSessionId = await invoke<string>("sftp_open", { sessionId: sshSessionId });
  } catch {
    explorerSessionId = await invoke<string>("scp_open", { sessionId: sshSessionId });
    transport = "scp";
  }
  onChange({
    type: "host",
    hostId: host.id,
    sessionId: explorerSessionId,
    sshSessionId,
    transport,
    label: host.label || `${host.username}@${host.host}`,
  });
}

async function connectS3ForPane(conn: any, onChange: (s: PaneSource) => void) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("s3_reconnect", { id: conn.id });
  onChange({
    type: "s3",
    connectionId: conn.id,
    sessionId: conn.id,
    label: conn.label || conn.name || conn.bucket,
  });
}

export function ToolbarSourceButton({
  source,
  onChange,
}: {
  source: PaneSource | null;
  onChange: (s: PaneSource) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hostsMap = useHostsStore((s) => s.hosts);
  const s3Map = useS3Store((s) => s.connections);
  const hosts = useMemo(() => {
    const arr: any[] = [];
    hostsMap.forEach((v) => arr.push(v));
    return arr;
  }, [hostsMap]);
  const s3Conns = useMemo(() => {
    const arr: any[] = [];
    s3Map.forEach((v) => arr.push(v));
    return arr;
  }, [s3Map]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className={[
          "flex items-center gap-1 px-1.5 py-0.5 rounded shrink-0",
          "text-[length:var(--text-sm)]",
          "text-text-muted hover:text-text-secondary hover:bg-bg-subtle",
          "transition-colors duration-[var(--duration-fast)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ].join(" ")}
        onClick={() => setOpen(!open)}
      >
        {source ? (
          <>
            {source.type === "local" ? (
              <Monitor size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            ) : source.type === "host" ? (
              <HardDrive size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            ) : (
              <Cloud size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
            )}
            <span className="truncate max-w-[80px]">{sourceLabel(source, t)}</span>
          </>
        ) : (
          <span className="text-text-muted/60">{t("pane.connect")}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="text-text-muted/70"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-52 bg-bg-surface border border-border rounded-xl shadow-lg py-1.5 overflow-hidden">
            {/* Local */}
            <button
              type="button"
              className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
              onClick={() => { setOpen(false); onChange({ type: "local" }); }}
            >
              <Monitor size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
              {t("pane.localLabel")}
            </button>

            {/* Hosts */}
            {hosts.length > 0 && (
              <>
                <div className="h-px bg-border/60 my-1 mx-2" />
                <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">{t("pane.hosts")}</div>
                {hosts.map((host: any) => (
                  <button
                    key={host.id}
                    type="button"
                    className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
                    onClick={() => { setOpen(false); void connectHostForPane(host, onChange); }}
                  >
                    <HardDrive size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
                    <span className="truncate">{host.label || `${host.username}@${host.host}`}</span>
                  </button>
                ))}
              </>
            )}

            {/* S3 */}
            {s3Conns.length > 0 && (
              <>
                <div className="h-px bg-border/60 my-1 mx-2" />
                <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">{t("pane.cloudStorage")}</div>
                {s3Conns.map((conn: any) => (
                  <button
                    key={conn.id}
                    type="button"
                    className="w-[calc(100%-8px)] mx-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[length:var(--text-sm)] text-text-primary hover:bg-bg-overlay transition-colors"
                    onClick={() => { setOpen(false); void connectS3ForPane(conn, onChange); }}
                  >
                    <Cloud size={14} strokeWidth={1.8} className="text-text-muted shrink-0" />
                    <span className="truncate">{conn.label || conn.name || conn.bucket}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function Pane({
  source,
  side,
  onCrossPaneTransfer,
  onSourceChange,
  currentPath,
  onNavigate,
  entries,
  onEntriesChange,
  busy: busyProp,
}: PaneProps) {
  const { t } = useTranslation();

  // Resolve transport + sessionId from source type
  const transport: Transport = useMemo(() => {
    if (source.type === "local") return "local";
    if (source.type === "host") return source.transport;
    return "sftp"; // S3 uses its own invoke path, fallback for type safety
  }, [source]);

  const sessionId = useMemo(() => {
    if (source.type === "local") return "__local__";
    if (source.type === "host") return source.sessionId;
    if (source.type === "s3") return source.sessionId;
    return "__local__";
  }, [source]);

  const provider = useMemo(() => {
    let p;
    if (source.type === "local") p = createLocalProvider();
    else if (source.type === "host") p = createSftpProvider(sessionId);
    else if (source.type === "s3") p = createS3Provider(sessionId, currentPath.split("/").filter(Boolean)[0] ?? "");
    else p = createLocalProvider();
    // Disable the toolbar upload button in the dual-pane transfer view —
    // uploads are handled via OS drag-and-drop in this context.
    return { ...p, capabilities: { ...p.capabilities, canUpload: false } };
  }, [source, sessionId, currentPath]);

  // ─── State ────────────────────────────────────────────────────────────────

  const [loading, setLoading] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "size" | "modified">("name");
  const [sortAsc, setSortAsc] = useState(true);

  // Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const isProcessingDrop = useRef(false);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  // Clipboard (managed at Pane level for cross-pane support)
  const [clipboard, setClipboard] = useState<ExplorerClipboard | null>(null);

  // Hidden files toggle
  const [showHidden, setShowHidden] = useState(false);

  // Creating file/folder inline state
  const [creatingFile, setCreatingFile] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  // ─── Load directory ─────────────────────────────────────────────────────

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true);
      setErrorState(null);
      try {
        if (source.type === "s3") {
          const s3Session = useS3Store.getState().sessions.get(source.sessionId);
          if (!s3Session) return;

          // Determine if this is a bucket listing or object listing
          if (!s3Session.currentBucket) {
            // Bucket listing
            const raw = await invoke<any[]>("s3_list_buckets", { s3SessionId: source.sessionId });
            onEntriesChange(path, toS3ExplorerEntries(raw));
          } else {
            // Object listing at the given prefix
            const raw = await invoke<any[]>("s3_list_objects", {
              s3SessionId: source.sessionId,
              prefix: path,
            });
            onEntriesChange(path, toS3ExplorerEntries(raw));
          }
        } else {
          const raw = await explorerInvoke<any[]>(transport, "list_dir", sessionId, { path });
          onEntriesChange(path, toExplorerEntries(source.type, raw));
        }
      } catch (err: unknown) {
        setErrorState(errorMessage(err, t("explorer.errors.listDirFailed")));
      } finally {
        setLoading(false);
      }
    },
    [source, transport, sessionId, onEntriesChange],
  );

  // Re-resolve home directory when source identity changes (e.g. user
  // switches from Local → a saved Host in the source selector).
  const sourceId = useMemo(() => {
    if (source.type === "local") return "local";
    if (source.type === "host") return `${source.type}:${source.hostId}`;
    if (source.type === "s3") return `${source.type}:${source.connectionId}`;
    return "unknown";
  }, [source]);

  useEffect(() => {
    void (async () => {
      try {
        if (source.type === "s3") {
          await loadDir("");
          onNavigate("");
        } else {
          const home = await explorerInvoke<string>(transport, "home_dir", sessionId, {});
          onNavigate(home);
          await loadDir(home);
        }
      } catch {
        if (currentPath) void loadDir(currentPath);
      }
    })();
  }, [sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Drag-drop (OS → Pane) ──────────────────────────────────────────────

  /** Whether drop coordinates land inside this pane's DOM element. */
  const isOverPane = useCallback(
    (position?: { x: number; y: number }): boolean => {
      if (!position || !paneRef.current) return false;
      const scale = isWindowsWebview() ? window.devicePixelRatio || 1 : 1;
      const x = position.x / scale;
      const y = position.y / scale;
      const r = paneRef.current.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    },
    [],
  );

  const resolveDropDir = useCallback(
    (position?: { x: number; y: number }): string => {
      const base = currentPathRef.current;
      if (!position) return base;
      const scale = isWindowsWebview() ? window.devicePixelRatio || 1 : 1;
      const el = document.elementFromPoint(position.x / scale, position.y / scale);
      const row = el?.closest("[data-entry-row]") as HTMLElement | null;
      if (row && row.dataset.entryType === "Directory") {
        const name = row.dataset.entryName;
        const target = entries.find((e) => e.name === name && e.entryType === "Directory");
        if (target) return target.id;
      }
      return base;
    },
    [entries],
  );

  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let aborted = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        type DragDropTarget = { onDragDropEvent: (cb: (e: any) => void) => Promise<() => void> };
        let appWindow: DragDropTarget | null = null;
        try {
          const mod = await import("@tauri-apps/api/webviewWindow");
          appWindow = mod.getCurrentWebviewWindow() as unknown as DragDropTarget;
        } catch {
          // Drag-drop API unavailable
        }

        if (!appWindow || aborted) return;

        const unsub = await appWindow.onDragDropEvent((event: any) => {
          const type = event.payload?.type;
          if (type === "enter" || type === "over") {
            // Highlight this pane only when the cursor is actually over it.
            const over = isOverPane(event.payload?.position);
            setIsDragOver(over);
            if (over) {
              setDropTargetDir(resolveDropDir(event.payload?.position));
            }
          } else if (type === "drop") {
            setIsDragOver(false);
            setDropTargetDir(null);

            // Only process the drop if it landed on this pane.
            if (!isOverPane(event.payload?.position)) return;

            const paths: string[] = event.payload?.paths ?? [];
            if (paths.some((p) => p.includes(DRAGOUT_STAGING_SEGMENT))) return;
            if (isProcessingDrop.current || paths.length === 0) return;
            isProcessingDrop.current = true;

            const remoteDir = resolveDropDir(event.payload?.position);

            void (async () => {
              try {
                if (source.type === "host") {
                  const existing = await explorerInvoke<any[]>(transport, "list_dir", sessionId, { path: remoteDir });
                  const conflicts = conflictingNames(paths, new Set(existing.map((e: any) => e.name)));
                  if (conflicts.length > 0) {
                    // TODO: DropOverwriteDialog — Phase 3
                  }
                }
                await explorerInvoke(transport, "enqueue_upload", sessionId, { localPaths: paths, remoteDir });
              } catch (err) {
                toast.error(errorMessage(err, t("explorer.errors.uploadFailed")));
              } finally {
                setTimeout(() => { isProcessingDrop.current = false; }, 500);
              }
            })();
          } else {
            setIsDragOver(false);
            setDropTargetDir(null);
          }
        });

        if (!aborted) unlisten = unsub;
      } catch {
        // Not in Tauri context
      }
    })();

    return () => { aborted = true; unlisten?.(); };
  }, [source, transport, sessionId, resolveDropDir]);

  // ─── Auto-refresh on upload progress / completion ──────────────────────
  //
  // Transfer events are bursty (emitted per progress chunk), so we avoid
  // reacting to individual events. Instead: start a 3 s polling loop as
  // soon as any upload is active, with an immediate first refresh at 300 ms.

  useEffect(() => {
    let aborted = false;
    let unlisten: (() => void) | undefined;
    const activeIds = new Set<string>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let firstTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshNow = () => {
      const path = currentPathRef.current;
      if (path) void loadDir(path);
    };

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (aborted) return;
        const ch = transferEventName(transport);
        const unsub = await listen<any>(ch, (event) => {
          const { direction, status, transfer_id } = event.payload;
          const sid = event.payload.sftp_session_id ?? event.payload.scp_session_id ?? event.payload.s3_session_id;
          if (sid !== sessionId || direction !== "Upload") return;

          if (status === "InProgress" || status === "Queued") {
            activeIds.add(transfer_id);
            if (!pollTimer) {
              firstTimer = setTimeout(() => {
                firstTimer = null;
                refreshNow();
                pollTimer = setInterval(refreshNow, 3000);
              }, 300);
            }
          } else if (status === "Completed" || status === "Failed" || status === "Cancelled") {
            activeIds.delete(transfer_id);
            setTimeout(refreshNow, 300);
            if (activeIds.size === 0) {
              if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
              if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            }
          }
        });
        if (!aborted) unlisten = unsub;
      } catch {
        // Not in Tauri context
      }
    })();
    return () => {
      aborted = true;
      unlisten?.();
      if (firstTimer) clearTimeout(firstTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [transport, sessionId, loadDir]);

  // ─── Operations ─────────────────────────────────────────────────────────

  const handleNavigate = useCallback(
    (path: string) => {
      onNavigate(path);
      void loadDir(path);
    },
    [onNavigate, loadDir],
  );

  const handleDownload = useCallback(
    async (entry: ExplorerEntry) => {
      setBusy(true);
      try {
        if (source.type === "s3") {
          await invoke("s3_download_file", { s3SessionId: source.sessionId, key: entry.id });
        } else if (entry.entryType === "Directory") {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const localDir = await open({
            directory: true,
            title: `${t("common:download")}: ${entry.name}`,
          }) as string | null;
          if (!localDir) { setBusy(false); return; }
          await explorerInvoke(transport, "enqueue_download", sessionId, {
            remotePaths: [entry.id],
            localDir,
          });
        } else {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const savePath = await save({
            defaultPath: entry.name,
            title: `${t("common:download")}: ${entry.name}`,
          });
          if (!savePath) { setBusy(false); return; }
          await explorerInvoke(transport, "download", sessionId, {
            remotePath: entry.id,
            localPath: savePath,
          });
        }
      } catch (err) {
        setErrorState(errorMessage(err, t("explorer.errors.downloadFailed")));
      } finally {
        setBusy(false);
      }
    },
    [source, transport, sessionId],
  );

  const handleDelete = useCallback(
    async (ents: ExplorerEntry[]) => {
      setBusy(true);
      try {
        if (source.type === "s3") {
          await invoke("s3_delete_objects", { s3SessionId: source.sessionId, keys: ents.map((e) => e.id) });
        } else {
          for (const entry of ents) {
            await explorerInvoke(transport, "delete", sessionId, {
              path: entry.id,
              isDir: entry.entryType === "Directory",
            });
          }
        }
        toast.success(t("explorer.errors.deleteSuccess", { count: ents.length }));
        await loadDir(currentPathRef.current);
      } catch (err) {
        setErrorState(errorMessage(err, t("explorer.errors.deleteFailed")));
      } finally {
        setBusy(false);
      }
    },
    [source, transport, sessionId, loadDir],
  );

  const handleRename = useCallback(
    async (entry: ExplorerEntry, newName: string) => {
      const newPath = provider.joinPath(provider.parentPath(entry.id), newName);
      if (source.type === "s3") {
        // S3 rename = copy + delete
        await invoke("s3_copy_object", {
          s3SessionId: source.sessionId,
          sourceKey: entry.id,
          destKey: newPath,
        });
        await invoke("s3_delete_objects", { s3SessionId: source.sessionId, keys: [entry.id] });
      } else {
        await explorerInvoke(transport, "rename", sessionId, { oldPath: entry.id, newPath });
      }
      await loadDir(currentPathRef.current);
    },
    [source, transport, sessionId, provider, loadDir],
  );

  const handleCreateFile = useCallback(
    async (name: string) => {
      setCreatingFile(false);
      const path = provider.joinPath(currentPath, name);
      try {
        if (source.type === "s3") {
          await invoke("s3_create_file", { s3SessionId: source.sessionId, key: path });
        } else {
          await explorerInvoke(transport, "create_file", sessionId, { path });
        }
        await loadDir(currentPath);
      } catch (err) {
        setErrorState(errorMessage(err, t("explorer.errors.createFileFailed")));
      }
    },
    [source, transport, sessionId, provider, currentPath, loadDir],
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      setCreatingFolder(false);
      const path = provider.joinPath(currentPath, name);
      try {
        if (source.type === "s3") {
          await invoke("s3_create_folder", { s3SessionId: source.sessionId, prefix: path });
        } else {
          await explorerInvoke(transport, "mkdir", sessionId, { path });
        }
        await loadDir(currentPath);
      } catch (err) {
        setErrorState(errorMessage(err, t("explorer.errors.createFolderFailed")));
      }
    },
    [source, transport, sessionId, provider, currentPath, loadDir],
  );

  const handleEditInEditor = useCallback(
    async (entry: ExplorerEntry, editor?: EditorConfig) => {
      try {
        if (source.type === "s3") {
          // S3 download first, then open locally
          const localPath = await invoke<string>("s3_download_file", {
            s3SessionId: source.sessionId,
            key: entry.id,
          });
          // Open with editor
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(`file://${localPath}`);
        } else {
          await explorerInvoke(transport, "edit_external", sessionId, {
            remotePath: entry.id,
            editor: editor ?? null,
          });
        }
      } catch (err) {
        toast.error(editorLaunchErrorMessage(err, t("editor.launchFailed")));
      }
    },
    [source, transport, sessionId],
  );

  const handleApplyPermissions = useCallback(
    async (entry: ExplorerEntry, mode: number, recursive: boolean): Promise<ChmodResult | void> => {
      if (source.type === "s3") return;
      if (recursive) {
        const result = await explorerInvoke<ChmodResult>(transport, "chmod_recursive", sessionId, {
          path: entry.id,
          mode,
        });
        return result;
      }
      await explorerInvoke(transport, "chmod", sessionId, { path: entry.id, mode });
    },
    [source, transport, sessionId],
  );

  // ─── Paste ─────────────────────────────────────────────────────────────

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    const targetDir = currentPath;
    setBusy(true);
    try {
      if (clipboard.operation === "cut") {
        // Cross-pane move = copy + delete source
        if (clipboard.sourceSessionId !== sessionId && onCrossPaneTransfer) {
          onCrossPaneTransfer(clipboard.entries, targetDir);
          // TODO: delete source entries after successful transfer
        } else if (source.type === "s3") {
          // S3 internal move
          for (const e of clipboard.entries) {
            const destKey = `${targetDir}/${e.name}`;
            await invoke("s3_copy_object", { s3SessionId: source.sessionId, sourceKey: e.id, destKey });
            await invoke("s3_delete_objects", { s3SessionId: source.sessionId, keys: [e.id] });
          }
        } else {
          await explorerInvoke(transport, "move_entries", sessionId, {
            sourcePaths: clipboard.entries.map((e) => e.id),
            targetDir,
          });
        }
        setClipboard(null);
      } else {
        // Copy
        if (clipboard.sourceSessionId !== sessionId && onCrossPaneTransfer) {
          onCrossPaneTransfer(clipboard.entries, targetDir);
        } else if (source.type === "s3") {
          for (const e of clipboard.entries) {
            const destKey = `${targetDir}/${e.name}`;
            await invoke("s3_copy_object", { s3SessionId: source.sessionId, sourceKey: e.id, destKey });
          }
        } else {
          await explorerInvoke(transport, "copy_entries", sessionId, {
            sourcePaths: clipboard.entries.map((e) => e.id),
            targetDir,
          });
        }
      }
      await loadDir(currentPath);
    } catch (err) {
      setErrorState(errorMessage(err, t("explorer.errors.pasteFailed")));
    } finally {
      setBusy(false);
    }
  }, [clipboard, currentPath, sessionId, source, transport, onCrossPaneTransfer, loadDir]);

  // ─── Breadcrumb segments ────────────────────────────────────────────────

  const segments = currentPath.split("/").filter(Boolean).map((seg, i, arr) => ({
    label: seg,
    path: "/" + arr.slice(0, i + 1).join("/"),
  }));

  // Filter hidden (dot-prefix) files when toggle is off
  const visibleEntries = useMemo(() => {
    if (showHidden) return entries;
    return entries.filter((e) => !e.name.startsWith("."));
  }, [entries, showHidden]);

  const toolbarIconBtn = [
    "flex items-center justify-center w-7 h-7 rounded-md shrink-0",
    "transition-colors duration-[var(--duration-fast)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  ].join(" ");

  return (
    <div ref={paneRef} className="flex flex-col h-full min-w-0">
      {/* Toolbar + hidden-files toggle — border spans full width */}
      <div className="flex items-center gap-0 border-b border-border bg-bg-surface">
        <div className="flex-1 min-w-0">
          <ExplorerToolbar
            provider={provider}
            currentPath={currentPath}
            segments={segments}
            onNavigate={handleNavigate}
            onRefresh={() => void loadDir(currentPath)}
            onUpload={() => {}}
            loading={loading}
            busy={busy || busyProp}
            leadingSlot={onSourceChange ? (
              <ToolbarSourceButton source={source} onChange={onSourceChange} />
            ) : undefined}
            hideBottomBorder
          />
        </div>
        <button
          type="button"
          onClick={() => setShowHidden(!showHidden)}
          className={[
            toolbarIconBtn,
            "mr-2",
            showHidden
              ? "text-accent bg-accent-muted"
              : "text-text-muted hover:text-text-secondary hover:bg-bg-subtle",
          ].join(" ")}
          title={showHidden ? t("common:pane.hideHidden") : t("common:pane.showHidden")}
          aria-label={showHidden ? t("common:pane.hideHidden") : t("common:pane.showHidden")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.08"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
            {!showHidden && <line x1="2" y1="2" x2="22" y2="22" />}
          </svg>
        </button>
      </div>

      {/* File table — flex flex-col so ExplorerFileTable's flex-1 + overflow-y-auto works */}
      <div className="flex-1 min-h-0 flex flex-col relative" data-pane={side}>
        {isDragOver && (
          <ExplorerDropZone
            path={dropTargetDir ?? currentPath}
          />
        )}
        <ExplorerFileTable
          provider={provider}
          entries={visibleEntries}
          sortBy={sortBy}
          sortAsc={sortAsc}
          onSortChange={(sb, sa) => { setSortBy(sb); setSortAsc(sa); }}
          clipboard={clipboard}
          onSetClipboard={setClipboard}
          onNavigate={handleNavigate}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onRename={provider.capabilities.canRename ? handleRename : undefined}
          onEditInEditor={provider.capabilities.canEditInEditor ? handleEditInEditor : undefined}
          onApplyPermissions={provider.capabilities.hasPermissions ? handleApplyPermissions : undefined}
          creatingFile={creatingFile}
          onStartCreateFile={() => setCreatingFile(true)}
          onCreateFile={handleCreateFile}
          onCancelCreateFile={() => setCreatingFile(false)}
          creatingFolder={creatingFolder}
          onStartCreateFolder={() => setCreatingFolder(true)}
          onCreateFolder={handleCreateFolder}
          onCancelCreateFolder={() => setCreatingFolder(false)}
          onPaste={clipboard ? handlePaste : undefined}
          onMoveEntries={provider.capabilities.canInternalDragMove
            ? async (sourceIds, targetDir) => {
                if (source.type === "s3") return;
                await explorerInvoke(transport, "move_entries", sessionId, { sourcePaths: sourceIds, targetDir });
                await loadDir(currentPath);
              }
            : undefined}
          onCopyEntries={provider.capabilities.canCopyPaste
            ? async (sourceIds, targetDir) => {
                if (source.type === "s3") {
                  for (const sid of sourceIds) {
                    const entry = entries.find((e) => e.id === sid);
                    if (!entry) continue;
                    const destKey = `${targetDir}/${entry.name}`;
                    await invoke("s3_copy_object", { s3SessionId: source.sessionId, sourceKey: sid, destKey });
                  }
                } else {
                  await explorerInvoke(transport, "copy_entries", sessionId, { sourcePaths: sourceIds, targetDir });
                }
                await loadDir(currentPath);
              }
            : undefined}
          onDragOut={source.type === "host" && transport === "sftp"
            ? (ents) => {
                void (async () => {
                  try {
                    await explorerInvoke(transport, "drag_out", sessionId, { remotePaths: ents.map((e) => e.id) });
                  } catch (err) {
                    toast.error(errorMessage(err, t("explorer.errors.dragOutFailed")));
                  }
                })();
              }
            : undefined}
          currentPath={currentPath}
          busy={busy || busyProp}
        />

        {/* Error banner */}
        {error && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-danger/10 border-t border-danger/20 text-[length:var(--text-xs)] text-danger flex items-center gap-1.5">
            <span className="i-lucide-alert-circle" />
            {error}
            <button
              type="button"
              className="ml-auto underline"
              onClick={() => setErrorState(null)}
            >
              {t("common:dismiss")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── S3 helper ──────────────────────────────────────────────────────────────

function toS3ExplorerEntries(raw: any[]): ExplorerEntry[] {
  return raw.map((e: any) => ({
    name: e.name ?? e.key?.split("/").filter(Boolean).pop() ?? "",
    id: e.key ?? e.name ?? "",
    entryType: (e.entry_type === "Directory" ? "Directory" : "File") as "Directory" | "File",
    size: e.size ?? 0,
    modified: e.last_modified ? Math.floor(new Date(e.last_modified).getTime() / 1000) : null,
    permissionsDisplay: null,
    permissions: null,
    isSymlink: false,
    storageClass: e.storage_class ?? null,
  }));
}
