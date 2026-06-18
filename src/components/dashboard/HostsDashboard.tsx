import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { Search, Plus, Cloud, Terminal, Monitor } from "lucide-react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { S3ConnectDialog } from "../s3/S3ConnectDialog";
import { useHostsStore } from "../../stores/hosts-store";
import { useSessionStore } from "../../stores/session-store";
import { useUiStore } from "../../stores/ui-store";
import { useTabStore } from "../../stores/tab-store";
import { useSftpStore } from "../../stores/sftp-store";
import { useS3Store } from "../../stores/s3-store";
import type { SavedHost, S3Connection } from "../../types";
import { HostCard } from "./HostCard";
import { S3Card } from "./S3Card";
import { SortableCard } from "./SortableCard";
import { ConnectionDialog } from "./ConnectionDialog";
import { TunnelSection } from "./TunnelSection";
import { toast } from "../../stores/toast-store";

// Abort an in-flight SSH connection attempt on the Rust side. Best-effort:
// the attempt may already have settled, in which case the backend reports it
// found nothing and we simply move on.
async function cancelConnectAttempt(attemptId: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ssh_cancel_connect", { attemptId });
  } catch {
    /* attempt already finished — nothing to cancel */
  }
}

// ─── Local card ────────────────────────────────────────────────────────────────

function LocalCard({ label, subtitle, onClick }: {
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <div
      data-testid="local-terminal-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      title={label}
      className={[
        "group relative isolate flex flex-col gap-2.5 p-3.5 rounded-xl text-left w-full h-full cursor-pointer overflow-hidden",
        "bg-bg-surface border border-dashed border-border/70",
        "hover:border-border-focus hover:bg-bg-overlay hover:border-solid",
        "transition-[background-color,border-color] duration-[var(--duration-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      ].join(" ")}
    >
      {/* Color accent — matches host card gradient style */}
      <div
        className="absolute inset-0 pointer-events-none -z-10 opacity-70 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)]"
        style={{
          background: "radial-gradient(circle at top left, #14b8a633, transparent 60%)",
        }}
        aria-hidden="true"
      />

      {/* Avatar */}
      <div
        className="flex items-center justify-center w-9 h-9 rounded-full shrink-0 font-semibold text-[length:var(--text-sm)] select-none"
        style={{
          backgroundColor: "#14b8a625",
          color: "#14b8a6",
          fontFamily: "var(--font-sans)",
        }}
        aria-hidden="true"
      >
        <Terminal size={18} strokeWidth={2} />
      </div>

      {/* Info */}
      <div className="min-w-0">
        <p className="text-[length:var(--text-sm)] font-medium text-text-primary truncate leading-tight">
          {label}
        </p>
        <p className="text-[length:var(--text-xs)] text-text-muted font-mono truncate mt-0.5">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function HostsDashboard() {
  const { t } = useTranslation();
  const { hosts, loadHosts, saveHost, deleteHost, reorderHosts } = useHostsStore();
  const setEditingHostId = useUiStore((s) => s.setEditingHostId);

  const [query, setQuery] = useState("");
  const [s3DialogOpen, setS3DialogOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // S3 connections
  const s3Connections = useS3Store((s) => s.connections);
  const loadS3Connections = useS3Store((s) => s.loadConnections);
  const reorderS3Connections = useS3Store((s) => s.reorderConnections);

  const [editingS3Connection, setEditingS3Connection] = useState<S3Connection | null>(null);

  const handleS3Duplicate = async (conn: S3Connection) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("s3_save_connection", {
        label: `${conn.label}${t('hosts:duplicateSuffix')}`,
        provider: conn.provider,
        bucketName: conn.bucket ?? "",
        region: conn.region,
        endpoint: conn.endpoint,
        accessKey: "",
        secretKey: "",
        pathStyle: conn.path_style,
        color: conn.color,
        environment: conn.environment,
        notes: conn.notes,
      });
    } catch { /* credential-less copy saved to DB */ }
    await loadS3Connections();
  };

  const handleS3Connect = async (conn: S3Connection) => {
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      setConnectingHost(null);
    };
    setConnectingHost({ label: conn.label, error: null, retry: () => void handleS3Connect(conn), cancel });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("s3_reconnect", { id: conn.id });
      if (cancelled) return;
      useS3Store.getState().openSession(conn.id, conn.label);
      if (conn.bucket) {
        useS3Store.getState().setCurrentBucket(conn.id, conn.bucket);
      }
      setConnectingHost(null);
      useTabStore.getState().addTab({ type: "s3", id: conn.id, label: conn.label });
    } catch (err) {
      if (cancelled) return;
      const msg = err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : t('hosts:hostdialog.s3ConnectionFailed');
      setConnectingHost({ label: conn.label, error: msg, retry: () => void handleS3Connect(conn), cancel: null });
    }
  };

  const handleS3Delete = async (conn: S3Connection) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("s3_delete_connection", { id: conn.id });
      await loadS3Connections();
    } catch { /* best-effort */ }
  };

  // Connection dialog state
  const [connectingHost, setConnectingHost] = useState<{ label: string; error: string | null; retry: (() => void) | null; cancel: (() => void) | null } | null>(null);

  // Load data on mount
  useEffect(() => {
    void loadHosts();
    void loadS3Connections();
  }, [loadHosts, loadS3Connections]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const filteredHosts = useMemo<SavedHost[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.host.toLowerCase().includes(q) ||
        h.label.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q),
    );
  }, [hosts, query]);

  const filteredS3 = useMemo<S3Connection[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return s3Connections;
    return s3Connections.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q) ||
        (c.bucket?.toLowerCase().includes(q) ?? false),
    );
  }, [s3Connections, query]);

  // ─── Connect handlers ──────────────────────────────────────────────────────

  const connectToHost = useCallback(
    async (host: SavedHost) => {
      const label = host.label || `${host.username}@${host.host}`;
      const attemptId = crypto.randomUUID();
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        void cancelConnectAttempt(attemptId);
        setConnectingHost(null);
      };
      setConnectingHost({ label, error: null, retry: () => void connectToHost(host), cancel });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const addSession = useSessionStore.getState().addSession;
        const sessionId = await invoke<string>("connect_saved_host", { hostId: host.id, attemptId });
        if (cancelled) {
          void invoke("ssh_disconnect", { sessionId });
          return;
        }
        const hostLabel = host.label || `${host.username}@${host.host}`;
        addSession(sessionId, {
          host: host.host,
          port: host.port,
          username: host.username,
          label: host.label || undefined,
          auth_method: { type: "password", password: "" },
        });
        setConnectingHost(null);
        useTabStore.getState().addTab({ type: "terminal", id: sessionId, label: hostLabel });
      } catch (err) {
        if (cancelled) return;
        const msg = err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t('hosts:hostdialog.connectionFailedHint');
        setConnectingHost({ label, error: msg, retry: () => void connectToHost(host), cancel: null });
      }
    },
    [],
  );

  // Local terminal
  const handleLocalTerminal = useCallback(async () => {
    const label = t('hosts:local.terminalLabel');
    setConnectingHost({ label, error: null, retry: () => void handleLocalTerminal(), cancel: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const addSession = useSessionStore.getState().addSession;
      const sessionId = await invoke<string>("local_terminal_create");
      addSession(
        sessionId,
        {
          host: "localhost",
          port: 0,
          username: "",
          auth_method: { type: "password", password: "" },
        },
        "local",
      );
      setConnectingHost(null);
      useTabStore.getState().addTab({ type: "terminal", id: sessionId, label });
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t('hosts:local.openFailed');
      setConnectingHost({ label, error: msg, retry: () => void handleLocalTerminal(), cancel: null });
    }
  }, []);

  // Explore: connect SSH + open a file browser
  const exploreHost = useCallback(
    async (host: SavedHost) => {
      const label = host.label || `${host.username}@${host.host}`;
      const attemptId = crypto.randomUUID();
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        void cancelConnectAttempt(attemptId);
        setConnectingHost(null);
      };
      setConnectingHost({ label, error: null, retry: () => void exploreHost(host), cancel });
      try {
        const { invoke } = await import("@tauri-apps/api/core");

        const sessionId = await invoke<string>("connect_saved_host_no_pty", { hostId: host.id, attemptId });
        if (cancelled) {
          void invoke("ssh_disconnect", { sessionId });
          return;
        }

        let explorerSessionId: string;
        let transport: "sftp" | "scp" = "sftp";
        try {
          explorerSessionId = await invoke<string>("sftp_open", { sessionId });
        } catch (sftpErr) {
          try {
            explorerSessionId = await invoke<string>("scp_open", { sessionId });
            transport = "scp";
          } catch {
            throw sftpErr;
          }
        }

        if (cancelled) {
          if (transport === "sftp") void invoke("sftp_close", { sftpSessionId: explorerSessionId });
          else void invoke("scp_close", { scpSessionId: explorerSessionId });
          void invoke("ssh_disconnect", { sessionId });
          return;
        }

        useSftpStore.getState().openSession(explorerSessionId, sessionId, label, host.username, false, host.start_directory ?? undefined);

        setConnectingHost(null);
        // Switch to the Home panel's transfer page with this host on the right
        useUiStore.getState().setPendingTransferRight({
          type: "host",
          hostId: host.id,
          sessionId: explorerSessionId,
          sshSessionId: sessionId,
          transport,
          label,
        });
        useUiStore.getState().setHomePage("transfer");
        useTabStore.getState().setActiveTab(null); // Switch to Home panel
      } catch (err) {
        if (cancelled) return;
        const msg = err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t('hosts:hostdialog.connectionFailedShort');
        setConnectingHost({ label, error: msg, retry: () => void exploreHost(host), cancel: null });
      }
    },
    [],
  );

  // ─── Host action handlers ──────────────────────────────────────────────────

  const handleDeleteHost = useCallback(
    async (id: string) => {
      await deleteHost(id);
    },
    [deleteHost],
  );

  const handleDuplicateHost = useCallback(
    async (host: SavedHost) => {
      const now = new Date().toISOString();
      const duplicate: SavedHost = {
        ...host,
        id: crypto.randomUUID(),
        label: `${host.label || host.host}${t('hosts:duplicateSuffix')}`,
        created_at: now,
        updated_at: now,
        last_connected_at: null,
        connection_count: null,
      };
      await saveHost(duplicate);
    },
    [saveHost],
  );

  // ─── Drag-and-drop reordering ────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = filteredHosts.findIndex((h) => h.id === active.id);
      const newIndex = filteredHosts.findIndex((h) => h.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reorderedVisible = arrayMove(filteredHosts, oldIndex, newIndex);
      const visibleIds = new Set(filteredHosts.map((h) => h.id));
      let cursor = 0;
      const newFullOrder = hosts.map((h) =>
        visibleIds.has(h.id) ? reorderedVisible[cursor++] : h,
      );

      void reorderHosts(newFullOrder).catch(() => {
        toast.error(t('hosts:hostdialog.reorderFailed'));
      });
    },
    [filteredHosts, hosts, reorderHosts],
  );

  const handleS3DragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = filteredS3.findIndex((c) => c.id === active.id);
      const newIndex = filteredS3.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reorderedVisible = arrayMove(filteredS3, oldIndex, newIndex);
      const visibleIds = new Set(filteredS3.map((c) => c.id));
      let cursor = 0;
      const newFullOrder = s3Connections.map((c) =>
        visibleIds.has(c.id) ? reorderedVisible[cursor++] : c,
      );

      void reorderS3Connections(newFullOrder).catch(() => {
        toast.error(t('hosts:hostdialog.s3ReorderFailed'));
      });
    },
    [filteredS3, s3Connections, reorderS3Connections],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  const showLocalCard = !query.trim(); // hide local card when searching

  return (
    <>
      <div className="flex flex-col h-full overflow-y-auto bg-bg-base">
        <div className="max-w-4xl w-full mx-auto px-8 py-8 flex flex-col gap-8">

          {/* ── Page title ── */}
          <div>
            <h1 className="text-[length:var(--text-lg)] font-semibold text-text-primary">{t('hosts:title')}</h1>
            <p className="text-[length:var(--text-xs)] text-text-muted mt-1">{t('hosts:description')}</p>
          </div>

          {/* ── Search bar ── */}
          <div className="relative">
            <Search
              size={16}
              strokeWidth={2}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              data-testid="host-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={t('hosts:searchPlaceholder')}
              aria-label={t('hosts:searchPlaceholder')}
              className={[
                "w-full pl-10 pr-4 py-2.5 rounded-xl text-[length:var(--text-sm)]",
                "bg-bg-surface border border-border text-text-primary placeholder:text-text-muted",
                "outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
                "focus:border-border-focus focus:ring-2 focus:ring-ring",
              ].join(" ")}
            />
          </div>

          {/* ── Hosts section ── */}
          <section aria-labelledby="hosts-heading">
            <div className="flex items-center gap-3 mb-3">
              <h2
                id="hosts-heading"
                className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-text-muted"
              >
                {t('hosts:server.heading')}
              </h2>
              {hosts.length > 0 && !query.trim() && (
                <span className="text-[length:var(--text-2xs)] text-text-muted tabular-nums font-medium bg-bg-surface border border-border/50 rounded-full px-2 py-px">
                  {hosts.length}
                </span>
              )}
              <div className="flex-1" />
              {hosts.length > 0 && (
                <button
                  data-testid="new-host-button"
                  onClick={() => setEditingHostId("__new__")}
                  className={[
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md",
                    "text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide",
                    "text-text-muted hover:text-text-secondary",
                    "border border-transparent hover:border-border hover:bg-bg-overlay",
                    "transition-all duration-[var(--duration-fast)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ].join(" ")}
                  title={t('hosts:hostdialog.newServerShortcut')}
                >
                  <Plus size={12} strokeWidth={2.2} aria-hidden="true" />
                  {t('hosts:server.newHost')}
                </button>
              )}
            </div>

            {(hosts.length > 0 || showLocalCard) ? (
              <div className="grid grid-cols-3 gap-2.5">
                {/* Local terminal — always first, outside DnD */}
                {showLocalCard && (
                  <LocalCard
                    label={t('hosts:local.label')}
                    subtitle={t('hosts:local.subtitle')}
                    onClick={() => void handleLocalTerminal()}
                  />
                )}

                {/* Host cards (draggable) */}
                {filteredHosts.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={filteredHosts.map((h) => h.id)}
                      strategy={rectSortingStrategy}
                    >
                      {filteredHosts.map((host) => (
                        <SortableCard key={host.id} id={host.id}>
                          <HostCard
                            host={host}
                            onConnect={(h) => void connectToHost(h)}
                            onExplore={(h) => void exploreHost(h)}
                            onEdit={setEditingHostId}
                            onDelete={(id) => void handleDeleteHost(id)}
                            onDuplicate={(h) => void handleDuplicateHost(h)}
                          />
                        </SortableCard>
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  query.trim() && (
                    <div className="col-span-3 flex flex-col items-center gap-3 py-8">
                      <Search size={28} strokeWidth={1.2} className="text-text-muted/30" aria-hidden="true" />
                      <p className="text-[length:var(--text-sm)] text-text-muted">
                        {t('hosts:server.noMatch', { query })}
                      </p>
                    </div>
                  )
                )}
              </div>
            ) : (
              /* No hosts at all */
              <div className="flex flex-col items-center gap-3 py-10 rounded-xl bg-bg-surface border border-border/50">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-bg-base border border-border">
                  <Monitor size={22} strokeWidth={1.2} className="text-text-muted/40" aria-hidden="true" />
                </div>
                <div className="text-center">
                  <p className="text-[length:var(--text-sm)] text-text-muted">
                    {t('hosts:server.empty.title')}
                  </p>
                  <p className="text-[length:var(--text-xs)] text-text-muted/60 mt-1">
                    {t('hosts:server.empty.description')}
                  </p>
                </div>
                <button
                  data-testid="new-host-button"
                  onClick={() => setEditingHostId("__new__")}
                  className={[
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium uppercase tracking-wide",
                    "bg-accent-muted border border-accent/20 text-accent",
                    "hover:brightness-110",
                    "transition-all duration-[var(--duration-fast)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ].join(" ")}
                >
                  <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                  {t('hosts:server.empty.cta')}
                </button>
              </div>
            )}
          </section>

          {/* ── Cloud Storage section ── */}
          <section aria-labelledby="s3-heading">
            <div className="flex items-center gap-3 mb-3">
              <h2
                id="s3-heading"
                className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-text-muted"
              >
                {t('hosts:cloud.heading')}
              </h2>
              {s3Connections.length > 0 && !query.trim() && (
                <span className="text-[length:var(--text-2xs)] text-text-muted tabular-nums font-medium bg-bg-surface border border-border/50 rounded-full px-2 py-px">
                  {s3Connections.length}
                </span>
              )}
              <div className="flex-1" />
              {s3Connections.length > 0 && (
                <button
                  data-testid="new-s3-button"
                  onClick={() => setS3DialogOpen(true)}
                  className={[
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md",
                    "text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide",
                    "text-text-muted hover:text-text-secondary",
                    "border border-transparent hover:border-border hover:bg-bg-overlay",
                    "transition-all duration-[var(--duration-fast)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ].join(" ")}
                  title={t('hosts:cloud.empty.cta')}
                >
                  <Plus size={12} strokeWidth={2.2} aria-hidden="true" />
                  {t('hosts:cloud.newS3')}
                </button>
              )}
            </div>

            {filteredS3.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleS3DragEnd}
              >
                <SortableContext
                  items={filteredS3.map((c) => c.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-3 gap-2.5">
                    {filteredS3.map((conn) => (
                      <SortableCard key={conn.id} id={conn.id}>
                        <S3Card
                          conn={conn}
                          onConnect={(c) => void handleS3Connect(c)}
                          onEdit={(c) => setEditingS3Connection(c)}
                          onDuplicate={(c) => void handleS3Duplicate(c)}
                          onDelete={(c) => void handleS3Delete(c)}
                        />
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              s3Connections.length === 0 && !query.trim() && (
                <div className="flex flex-col items-center gap-3 py-10 rounded-xl bg-bg-surface border border-border/50">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-bg-base border border-border">
                    <Cloud size={22} strokeWidth={1.2} className="text-text-muted/40" aria-hidden="true" />
                  </div>
                  <div className="text-center">
                    <p className="text-[length:var(--text-sm)] text-text-muted">
                      {t('hosts:cloud.empty.title')}
                    </p>
                    <p className="text-[length:var(--text-xs)] text-text-muted/60 mt-1">
                      {t('hosts:cloud.empty.description')}
                    </p>
                  </div>
                  <button
                    data-testid="new-s3-button"
                    onClick={() => setS3DialogOpen(true)}
                    className={[
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium uppercase tracking-wide",
                      "bg-accent-muted border border-accent/20 text-accent",
                      "hover:brightness-110",
                      "transition-all duration-[var(--duration-fast)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ].join(" ")}
                  >
                    <Cloud size={14} strokeWidth={2} aria-hidden="true" />
                    {t('hosts:cloud.empty.cta')}
                  </button>
                </div>
              )
            )}
          </section>

          {/* ── Tunnels section ── */}
          <TunnelSection query={query} />
        </div>
      </div>

      {s3DialogOpen && (
        <S3ConnectDialog onClose={() => { setS3DialogOpen(false); void loadS3Connections(); }} />
      )}

      {editingS3Connection && (
        <S3ConnectDialog
          editConnection={editingS3Connection}
          onClose={() => { setEditingS3Connection(null); void loadS3Connections(); }}
        />
      )}

      {connectingHost && (
        <ConnectionDialog
          label={connectingHost.label}
          error={connectingHost.error}
          onClose={() => setConnectingHost(null)}
          onRetry={connectingHost.retry ?? undefined}
          onCancel={connectingHost.cancel ?? undefined}
        />
      )}
    </>
  );
}
