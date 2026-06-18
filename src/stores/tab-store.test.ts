import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore } from "./tab-store";
import type { UnifiedTab } from "./tab-store";

// tab-store calls syncPinnedTabs which does dynamic imports and reaches
// into the backend — mock the sync so we test pure state transitions.
vi.mock("./pinned-sync", () => ({
  syncPinnedTabs: vi.fn().mockResolvedValue(undefined),
  syncPinnedTabsThrottled: vi.fn(),
}));

function makeTerminalTab(id: string, label: string): UnifiedTab {
  return { type: "terminal", id, label };
}

describe("tab-store — pin / unpin", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: new Map(),
      tabOrder: [],
      activeTabId: null,
      pinnedTabIds: new Set(),
    });
  });

  describe("pinTab", () => {
    it("adds the tab ID to pinnedTabIds", () => {
      useTabStore.getState().pinTab("t1");
      expect(useTabStore.getState().pinnedTabIds.has("t1")).toBe(true);
    });

    it("pinning multiple tabs", () => {
      useTabStore.getState().pinTab("t1");
      useTabStore.getState().pinTab("t2");
      expect(useTabStore.getState().pinnedTabIds.size).toBe(2);
    });

    it("pinning the same tab twice is idempotent", () => {
      useTabStore.getState().pinTab("t1");
      useTabStore.getState().pinTab("t1");
      expect(useTabStore.getState().pinnedTabIds.size).toBe(1);
    });
  });

  describe("unpinTab", () => {
    it("removes the tab ID from pinnedTabIds", () => {
      useTabStore.setState({ pinnedTabIds: new Set(["t1", "t2"]) });
      useTabStore.getState().unpinTab("t1");
      const ids = useTabStore.getState().pinnedTabIds;
      expect(ids.has("t1")).toBe(false);
      expect(ids.has("t2")).toBe(true);
    });

    it("unpinning an unpinned tab does nothing", () => {
      useTabStore.getState().unpinTab("nonexistent");
      expect(useTabStore.getState().pinnedTabIds.size).toBe(0);
    });
  });

  describe("setPinnedTabIds", () => {
    it("replaces the entire pinned set", () => {
      useTabStore.setState({ pinnedTabIds: new Set(["old1", "old2"]) });
      useTabStore.getState().setPinnedTabIds(["new1", "new2", "new3"]);
      const ids = useTabStore.getState().pinnedTabIds;
      expect(ids.size).toBe(3);
      expect(ids.has("new1")).toBe(true);
      expect(ids.has("old1")).toBe(false);
    });
  });

  describe("restoreTab", () => {
    it("adds a tab without activating it", () => {
      useTabStore.setState({ activeTabId: "other" });
      useTabStore.getState().restoreTab(makeTerminalTab("t1", "My Tab"));

      const state = useTabStore.getState();
      expect(state.tabs.has("t1")).toBe(true);
      expect(state.tabOrder).toContain("t1");
      // Should not have changed activeTabId
      expect(state.activeTabId).toBe("other");
    });

    it("does not duplicate in tabOrder if already present", () => {
      useTabStore.setState({
        tabs: new Map([["t1", makeTerminalTab("t1", "My Tab")]]),
        tabOrder: ["t1"],
        activeTabId: "t1",
      });
      useTabStore.getState().restoreTab(makeTerminalTab("t1", "My Tab"));

      expect(useTabStore.getState().tabOrder).toEqual(["t1"]);
    });
  });

  describe("updateTabLabel", () => {
    it("updates the label of an existing tab", () => {
      useTabStore.setState({
        tabs: new Map([["t1", makeTerminalTab("t1", "Old")]]),
      });

      useTabStore.getState().updateTabLabel("t1", "New");

      expect(useTabStore.getState().tabs.get("t1")?.label).toBe("New");
    });

    it("does nothing for a missing tab", () => {
      useTabStore.getState().updateTabLabel("nonexistent", "X");
      expect(useTabStore.getState().tabs.size).toBe(0);
    });
  });
});
