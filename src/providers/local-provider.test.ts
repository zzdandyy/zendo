import { describe, it, expect } from "vitest";
import { createLocalProvider, toLocalExplorerEntry } from "./local-provider";

const mockLocalEntry = {
  name: "README.md",
  path: "/home/user/README.md",
  entry_type: "File" as const,
  size: 1024,
  modified: 1718000000,
  permissions: 0o644,
  permissions_display: "rw-r--r--",
  is_symlink: false,
};

describe("createLocalProvider", () => {
  const provider = createLocalProvider();

  it("returns a local-type provider", () => {
    expect(provider.type).toBe("local");
  });

  it("uses the sentinel session id", () => {
    expect(provider.sessionId).toBe("__local__");
  });

  it("enables all capabilities except s3-specific ones", () => {
    const caps = provider.capabilities;
    expect(caps.canRename).toBe(true);
    expect(caps.canCreateFile).toBe(true);
    expect(caps.canCreateFolder).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canUpload).toBe(true);
    expect(caps.canDownload).toBe(true);
    expect(caps.canInternalDragMove).toBe(true);
    expect(caps.canCopyPaste).toBe(true);
    expect(caps.canEditInEditor).toBe(true);
    expect(caps.hasPermissions).toBe(true);
    expect(caps.hasStorageClass).toBe(false);
    expect(caps.canPresignUrl).toBe(false);
  });

  it("joinPath joins with slash", () => {
    expect(provider.joinPath("/home/user", "docs")).toBe("/home/user/docs");
    expect(provider.joinPath("/home/user/", "docs")).toBe("/home/user/docs");
  });

  it("parentPath returns parent directory", () => {
    expect(provider.parentPath("/home/user/docs")).toBe("/home/user");
    expect(provider.parentPath("/home/user/docs/")).toBe("/home/user");
    expect(provider.parentPath("/home")).toBe("/");
    expect(provider.parentPath("/")).toBe("/");
  });

  it("rootLabel returns /", () => {
    expect(provider.rootLabel()).toBe("/");
  });
});

describe("toLocalExplorerEntry", () => {
  it("converts directory type correctly", () => {
    const dir = { ...mockLocalEntry, entry_type: "Directory" as const };
    const e = toLocalExplorerEntry(dir);
    expect(e.entryType).toBe("Directory");
  });

  it("converts file type correctly", () => {
    const e = toLocalExplorerEntry(mockLocalEntry);
    expect(e.entryType).toBe("File");
  });

  it("maps path to id", () => {
    const e = toLocalExplorerEntry(mockLocalEntry);
    expect(e.id).toBe("/home/user/README.md");
  });

  it("maps s3 fields to null", () => {
    const e = toLocalExplorerEntry(mockLocalEntry);
    expect(e.storageClass).toBeNull();
  });

  it("maps permissions fields", () => {
    const e = toLocalExplorerEntry(mockLocalEntry);
    expect(e.permissions).toBe(0o644);
    expect(e.permissionsDisplay).toBe("rw-r--r--");
  });

  it("handles null permissions (Windows)", () => {
    const winEntry = { ...mockLocalEntry, permissions: null, permissions_display: null };
    const e = toLocalExplorerEntry(winEntry);
    expect(e.permissions).toBeNull();
    expect(e.permissionsDisplay).toBeNull();
  });
});
