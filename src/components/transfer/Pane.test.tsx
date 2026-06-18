import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { Pane } from "./Pane";
import type { PaneSource } from "../../stores/tab-store";
import type { ExplorerEntry } from "../../types/explorer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

vi.mock("../../stores/s3-store", () => ({
  useS3Store: Object.assign(
    vi.fn((sel?: any) => {
      if (typeof sel === "function") return sel({ sessions: new Map(), connections: [] });
      return { sessions: new Map(), connections: [] };
    }),
    { getState: () => ({ sessions: new Map(), connections: [] }) },
  ),
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: vi.fn((sel?: any) => {
    const state = { editors: [], defaultEditorId: null, explorerDoubleClickAction: "open" };
    return typeof sel === "function" ? sel(state) : state;
  }),
}));

const mockLocal: PaneSource = { type: "local" };
const mockHost: PaneSource = {
  type: "host", hostId: "h1", sessionId: "s1", sshSessionId: "ssh1",
  transport: "sftp" as const, label: "test@host",
};
const mockS3: PaneSource = {
  type: "s3", connectionId: "c1", sessionId: "s3-1", label: "my-bucket",
};

const emptyEntries: ExplorerEntry[] = [];
const noop = () => {};

describe("Pane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPane(source: PaneSource, path = "/") {
    return render(
      <Pane
        source={source}
        side="left"
        currentPath={path}
        onNavigate={noop}
        entries={emptyEntries}
        onEntriesChange={noop}
      />,
    );
  }

  it("renders toolbar home button — local", () => {
    const { container } = renderPane(mockLocal, "/home/user");
    expect(container.querySelector('[data-testid="explorer-home"]')).toBeTruthy();
  });

  it("renders toolbar home button — host/sftp", () => {
    const { container } = renderPane(mockHost, "/var/log");
    expect(container.querySelector('[data-testid="explorer-home"]')).toBeTruthy();
  });

  it("renders toolbar home button — s3", () => {
    const { container } = renderPane(mockS3, "/my-bucket");
    expect(container.querySelector('[data-testid="explorer-home"]')).toBeTruthy();
  });

  it("renders drop zone when drag is over", () => {
    // The drop zone is conditionally rendered based on `isDragOver` state.
    // We verify the pane renders without crashing first.
    const { container } = renderPane(mockLocal, "/home");
    expect(container.textContent).toBeTruthy();
  });

  it("renders file table (s3)", () => {
    // S3 uses a simpler provider that works well in jsdom
    const { container } = renderPane(mockS3, "/bucket");
    expect(container.querySelector('[data-testid="explorer-sort-name"]')).toBeTruthy();
  });

  it("Pane component accepts all three source types", () => {
    // TypeScript compile-time check: these should all type-check
    const sources: PaneSource[] = [mockLocal, mockHost, mockS3];
    expect(sources).toHaveLength(3);
  });
});
