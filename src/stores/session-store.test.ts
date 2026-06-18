import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./session-store";
import type { HostConfig, LayoutNode, Session } from "../types";

// restorePinnedTab is pure in-memory — no backend calls needed.

function makeHostConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  return {
    host: "example.com",
    port: 22,
    username: "root",
    auth_method: { type: "password", password: "" },
    ...overrides,
  };
}

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    hostConfig: makeHostConfig(),
    status: "Connected",
    label: `session-${id}`,
    ...overrides,
  };
}

describe("session-store — restorePinnedTab", () => {
  beforeEach(() => {
    // Reset to a clean state
    useSessionStore.setState({
      sessions: new Map(),
      tabs: new Map(),
      floatingPanes: new Map(),
      activeSessionId: null,
      activeTerminalTabId: null,
    });
  });

  it("injects a single-pane layout + session", () => {
    const layout: LayoutNode = { type: "pane", sessionId: "s1" };
    const sessions = [{ id: "s1", session: makeSession("s1") }];

    useSessionStore.getState().restorePinnedTab("s1", layout, sessions, "My Tab");

    const state = useSessionStore.getState();
    expect(state.sessions.has("s1")).toBe(true);
    expect(state.sessions.get("s1")?.label).toBe("session-s1");
    expect(state.tabs.get("s1")).toEqual({ layout, label: "My Tab" });
    // Should not set activeSessionId (tab restore doesn't activate)
    expect(state.activeSessionId).toBeNull();
  });

  it("injects a split layout with multiple sessions", () => {
    const layout: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", sessionId: "s1" },
        { type: "pane", sessionId: "s2" },
      ],
    };
    const sessions = [
      { id: "s1", session: makeSession("s1", { label: "left" }) },
      { id: "s2", session: makeSession("s2", { label: "right" }) },
    ];

    useSessionStore.getState().restorePinnedTab("s1", layout, sessions, "Workplace 1");

    const state = useSessionStore.getState();
    expect(state.sessions.size).toBe(2);
    expect(state.sessions.get("s1")?.label).toBe("left");
    expect(state.sessions.get("s2")?.label).toBe("right");
    expect(state.tabs.get("s1")).toEqual({ layout, label: "Workplace 1" });
  });

  it("does not overwrite existing sessions from another tab", () => {
    // Pre-populate an unrelated session
    useSessionStore.setState((s) => {
      const sessions = new Map(s.sessions);
      sessions.set("existing", makeSession("existing"));
      const tabs = new Map(s.tabs);
      tabs.set("existing", {
        layout: { type: "pane", sessionId: "existing" } as LayoutNode,
        label: "existing",
      });
      return { sessions, tabs };
    });

    const layout: LayoutNode = { type: "pane", sessionId: "new" };
    const sessions = [{ id: "new", session: makeSession("new", { label: "new-one" }) }];

    useSessionStore.getState().restorePinnedTab("new", layout, sessions, "New Tab");

    const state = useSessionStore.getState();
    // Existing session untouched
    expect(state.sessions.has("existing")).toBe(true);
    // New session added
    expect(state.sessions.has("new")).toBe(true);
    expect(state.sessions.size).toBe(2);
  });

  it("injects floating panes when provided", () => {
    const layout: LayoutNode = { type: "pane", sessionId: "s1" };
    const sessions = [{ id: "s1", session: makeSession("s1") }];
    const fps = [{ sessionId: "s2", x: 100, y: 200, width: 400, height: 300 }];
    const fpSessions = [{ id: "s2", session: makeSession("s2", { label: "floating" }) }];

    useSessionStore.getState().restorePinnedTab(
      "s1", layout, [...sessions, ...fpSessions], "Tab with float", fps,
    );

    const state = useSessionStore.getState();
    expect(state.sessions.has("s2")).toBe(true);
    expect(state.floatingPanes.get("s1")).toEqual(fps);
  });

  it("does not set floatingPanes when none provided", () => {
    const layout: LayoutNode = { type: "pane", sessionId: "s1" };
    const sessions = [{ id: "s1", session: makeSession("s1") }];

    useSessionStore.getState().restorePinnedTab("s1", layout, sessions, "Tab");

    const state = useSessionStore.getState();
    expect(state.floatingPanes.has("s1")).toBe(false);
  });
});

describe("session-store — setAccent", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: new Map() });
  });

  it("sets the accent on an existing session", () => {
    const hostConfig = makeHostConfig();
    useSessionStore.setState((s) => {
      const sessions = new Map(s.sessions);
      sessions.set("s1", {
        id: "s1",
        hostConfig,
        status: "Connected",
        label: "test",
        accent: undefined,
      } as Session);
      return { sessions };
    });

    useSessionStore.getState().setAccent("s1", "oklch(0.70 0.15 250)");

    expect(useSessionStore.getState().sessions.get("s1")?.accent).toBe("oklch(0.70 0.15 250)");
  });

  it("does nothing for a non-existent session", () => {
    useSessionStore.getState().setAccent("nonexistent", "oklch(1 0 0)");
    expect(useSessionStore.getState().sessions.size).toBe(0);
  });
});
