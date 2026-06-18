import { useTranslation } from "react-i18next";
import { Upload, FolderPlus, FilePlus, RefreshCw, ChevronRight, Home, Loader2, Shield } from "lucide-react";
import type { FileSystemProvider } from "../../types/explorer";

interface BreadcrumbSegment {
  label: string;
  path: string;
}

interface ExplorerToolbarProps {
  provider: FileSystemProvider;
  currentPath: string;
  segments: BreadcrumbSegment[];
  loading: boolean;
  onRefresh: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onNavigate: (path: string) => void;
  onUpload: () => void;
  busy?: boolean;
  sudoMode?: boolean;
  sudoBusy?: boolean;
  onToggleSudo?: () => void;
  /** Renders in place of the home button. Use for source selector etc. */
  leadingSlot?: React.ReactNode;
  /** Suppress the built-in bottom border (parent handles it instead). */
  hideBottomBorder?: boolean;
}

export function ExplorerToolbar({
  provider,
  currentPath,
  segments,
  loading,
  onRefresh,
  onNewFolder,
  onNewFile,
  onNavigate,
  onUpload,
  busy,
  sudoMode,
  sudoBusy,
  onToggleSudo,
  leadingSlot,
  hideBottomBorder,
}: ExplorerToolbarProps) {
  const { t } = useTranslation();
  const caps = provider.capabilities;

  const iconBtn = [
    "flex items-center justify-center w-7 h-7 rounded-md shrink-0",
    "text-text-muted hover:text-text-secondary hover:bg-bg-subtle",
    "transition-colors duration-[var(--duration-fast)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" ");

  const isAtRoot = provider.type === "sftp"
    ? currentPath === "/"
    : currentPath === "";

  return (
    <div className={[
      "flex items-center h-10 px-2 bg-bg-surface shrink-0 gap-1 no-select",
      hideBottomBorder ? "" : "border-b border-border",
    ].join(" ")}>
      {/* Home button / custom slot */}
      {leadingSlot ?? (
        <button
          data-testid="explorer-home"
          onClick={() => onNavigate(provider.type === "sftp" ? "/" : "")}
          disabled={loading || isAtRoot}
          title={t("explorer.toolbar.goToRoot", { root: provider.rootLabel() })}
          aria-label={t("explorer.toolbar.goToRootAria")}
          className={iconBtn}
        >
          <Home size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* Breadcrumb path */}
      <div
        className="flex items-center gap-0 overflow-x-auto flex-1 min-w-0 mx-1"
        aria-label={t("explorer.toolbar.currentPathAria")}
      >
        {segments.map((seg, index) => {
          const isLast = index === segments.length - 1;
          const isRoot = index === 0;

          return (
            <span key={`${seg.path}-${index}`} className="flex items-center shrink-0">
              {!isRoot && (
                <ChevronRight
                  size={12}
                  strokeWidth={2}
                  className="text-text-muted/50 mx-0.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <button
                onClick={() => !isLast && onNavigate(seg.path)}
                disabled={isLast}
                title={isLast ? seg.path : t("explorer.toolbar.navigateTo", { path: seg.path })}
                className={[
                  "px-1 py-0.5 rounded text-[length:var(--text-sm)]",
                  "transition-colors duration-[var(--duration-fast)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isLast
                    ? "text-text-primary font-medium cursor-default"
                    : "text-text-muted hover:text-text-secondary hover:bg-bg-subtle/70 cursor-pointer",
                ].join(" ")}
              >
                {isRoot ? provider.rootLabel() : seg.label}
              </button>
            </span>
          );
        })}
      </div>

      {/* Busy spinner */}
      {busy && (
        <Loader2
          size={15}
          strokeWidth={2}
          className="text-accent motion-safe:animate-spin shrink-0"
          aria-label={t("explorer.toolbar.operationInProgress")}
        />
      )}

      {/* Separator */}
      <span className="w-px h-4 bg-border shrink-0" aria-hidden="true" />

      {/* Upload */}
      {caps.canUpload && (
        <button
          data-testid="explorer-upload"
          onClick={onUpload}
          disabled={loading}
          title={t("explorer.toolbar.uploadFile")}
          aria-label={t("explorer.toolbar.uploadFile")}
          className={iconBtn}
        >
          <Upload size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* New file */}
      {caps.canCreateFile && (
        <button
          data-testid="explorer-new-file"
          onClick={onNewFile}
          disabled={loading}
          title={t("explorer.toolbar.newFile")}
          aria-label={t("explorer.toolbar.newFile")}
          className={iconBtn}
        >
          <FilePlus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* New folder */}
      {caps.canCreateFolder && (
        <button
          data-testid="explorer-new-folder"
          onClick={onNewFolder}
          disabled={loading}
          title={t("explorer.toolbar.newFolder")}
          aria-label={t("explorer.toolbar.newFolder")}
          className={iconBtn}
        >
          <FolderPlus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}

      {/* Refresh */}
      <button
        data-testid="explorer-refresh"
        onClick={onRefresh}
        disabled={loading}
        title={t("explorer.toolbar.refresh")}
        aria-label={t("explorer.toolbar.refresh")}
        className={iconBtn}
      >
        <RefreshCw
          size={15}
          strokeWidth={1.8}
          aria-hidden="true"
          className={loading ? "motion-safe:animate-spin" : ""}
        />
      </button>

      {onToggleSudo && (
        <button
          data-testid="explorer-sudo-toggle"
          onClick={onToggleSudo}
          disabled={sudoBusy}
          aria-busy={sudoBusy}
          title={sudoMode ? t("explorer.toolbar.sudoDisable") : t("explorer.toolbar.sudoEnable")}
          aria-label={sudoMode ? t("explorer.toolbar.sudoDisable") : t("explorer.toolbar.sudoEnable")}
          aria-pressed={!!sudoMode}
          className={[
            iconBtn,
            sudoMode
              ? "text-accent bg-accent/15 hover:bg-accent/25 hover:text-accent"
              : "",
          ].join(" ")}
        >
          {sudoBusy ? (
            <Loader2 size={15} strokeWidth={1.8} aria-hidden="true" className="motion-safe:animate-spin" />
          ) : (
            <Shield size={15} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}
