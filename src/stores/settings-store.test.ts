import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from "./settings-store";

// The store reaches the backend via a dynamic `import("@tauri-apps/api/core")`,
// so we mock that module's `invoke` (persist is fire-and-forget, hence waitFor).
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe("settings-store — terminal clipboard settings (#71)", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    // Reset just the keys under test to their defaults.
    useSettingsStore.setState({ terminalCopyOnSelect: false, terminalPasteButton: "none" });
  });

  it("defaults to copy-on-select off and paste disabled", () => {
    const s = useSettingsStore.getState();
    expect(s.terminalCopyOnSelect).toBe(false);
    expect(s.terminalPasteButton).toBe("none");
  });

  it("toggles copy-on-select and persists it as a string", async () => {
    useSettingsStore.getState().setTerminalCopyOnSelect(true);
    expect(useSettingsStore.getState().terminalCopyOnSelect).toBe(true);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "terminal_copy_on_select",
        value: "true",
      }),
    );
  });

  it("sets the paste button and persists the raw choice", async () => {
    useSettingsStore.getState().setTerminalPasteButton("middle");
    expect(useSettingsStore.getState().terminalPasteButton).toBe("middle");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "terminal_paste_button",
        value: "middle",
      }),
    );
  });

  it("loads both settings from persisted key/value pairs", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_copy_on_select", "true"],
          ["terminal_paste_button", "right"],
          // editors already seeded — skips the detect_editors first-run path.
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    const s = useSettingsStore.getState();
    expect(s.terminalCopyOnSelect).toBe(true);
    expect(s.terminalPasteButton).toBe("right");
  });

  it("falls back to the default for an unrecognized paste-button value", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_paste_button", "bogus"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().terminalPasteButton).toBe("none");
  });
});

describe("settings-store — explorer double-click action", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ explorerDoubleClickAction: "download" });
  });

  it("defaults to download", () => {
    expect(useSettingsStore.getState().explorerDoubleClickAction).toBe("download");
  });

  it("sets and persists the double-click action", async () => {
    useSettingsStore.getState().setExplorerDoubleClickAction("open");
    expect(useSettingsStore.getState().explorerDoubleClickAction).toBe("open");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "explorer_double_click_action",
        value: "open",
      }),
    );
  });

  it("loads the action, falling back to download for an unknown value", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["explorer_double_click_action", "nonsense"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().explorerDoubleClickAction).toBe("download");
  });
});

describe("settings-store — pinned tabs", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ pinnedTabs: [] });
  });

  it("setPinnedTabs persists as JSON", async () => {
    useSettingsStore.getState().setPinnedTabs([
      {
        type: "terminal",
        label: "My Tab",
        layout: { type: "pane", label: "root@host" },
      },
    ]);

    expect(useSettingsStore.getState().pinnedTabs).toHaveLength(1);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_setting",
        expect.objectContaining({ key: "app_pinned_tabs" }),
      ),
    );
  });

  it("migrates old flat format (no layout) to new layout format", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          [
            "app_pinned_tabs",
            JSON.stringify([
              { type: "terminal", hostId: "h1", label: "Old Tab", accent: "oklch(1 0 0)" },
              { type: "terminal", label: "Local Only" },
            ]),
          ],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    const tabs = useSettingsStore.getState().pinnedTabs;
    expect(tabs).toHaveLength(2);

    // First old descriptor → wrapped into layout.pane
    expect(tabs[0]).toEqual({
      type: "terminal",
      label: "Old Tab",
      layout: {
        type: "pane",
        hostId: "h1",
        label: "Old Tab",
        accent: "oklch(1 0 0)",
      },
    });

    // Second old descriptor (local) → wrapped, no hostId
    expect(tabs[1]).toEqual({
      type: "terminal",
      label: "Local Only",
      layout: {
        type: "pane",
        hostId: undefined,
        label: "Local Only",
        accent: undefined,
      },
    });
  });

  it("keeps new-format descriptors unchanged", async () => {
    const newFormat = {
      type: "terminal" as const,
      label: "Workplace 2",
      layout: {
        type: "split" as const,
        direction: "horizontal" as const,
        ratio: 0.5,
        children: [
          { type: "pane" as const, hostId: "h1", label: "left", accent: "oklch(0.8 0 0)" },
          { type: "pane" as const, label: "local" },
        ],
      },
    };

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [["app_pinned_tabs", JSON.stringify([newFormat])], ["editors_seeded", "true"]];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    const tabs = useSettingsStore.getState().pinnedTabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toEqual(newFormat);
  });
});
