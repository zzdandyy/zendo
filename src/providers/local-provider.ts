import type { ExplorerEntry, ProviderCapabilities, FileSystemProvider } from "../types/explorer";
import type { LocalEntry } from "../types/local";

const LOCAL_CAPABILITIES: ProviderCapabilities = {
  canRename: true,
  canCreateFile: true,
  canCreateFolder: true,
  canDelete: true,
  canUpload: true,
  canDownload: true,
  canDragDropUpload: true,
  canInternalDragMove: true,
  canCopyPaste: true,
  canEditInEditor: true,
  canGetInfo: true,
  hasPermissions: true, // Unix only; the toolbar hides the column on Windows via runtime check
  hasStorageClass: false,
  canPresignUrl: false,
};

/** Convert a backend LocalEntry into the unified ExplorerEntry shape. */
export function toLocalExplorerEntry(e: LocalEntry): ExplorerEntry {
  return {
    name: e.name,
    id: e.path,
    entryType: e.entry_type === "Directory" ? "Directory" : "File",
    size: e.size,
    modified: e.modified ?? null,
    permissionsDisplay: e.permissions_display ?? null,
    permissions: e.permissions ?? null,
    isSymlink: e.is_symlink,
    storageClass: null,
  };
}

/** Create a FileSystemProvider that talks to the local filesystem backend. */
export function createLocalProvider(): FileSystemProvider {
  return {
    type: "local" as FileSystemProvider["type"],
    sessionId: "__local__",
    capabilities: LOCAL_CAPABILITIES,
    joinPath(parent: string, child: string): string {
      return parent.endsWith("/") ? `${parent}${child}` : `${parent}/${child}`;
    },
    parentPath(path: string): string {
      // Strip trailing slash(es) before finding parent.
      const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
      const idx = trimmed.lastIndexOf("/");
      return idx <= 0 ? "/" : trimmed.substring(0, idx);
    },
    rootLabel(): string {
      return "/";
    },
  };
}
