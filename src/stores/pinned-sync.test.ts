import { describe, it, expect } from "vitest";
import { serializeLayoutNode } from "./pinned-sync";
import type { LayoutNode } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TestSession {
  hostConfig?: { host: string; port: number; username: string };
  sessionType?: string;
  label: string;
  accent?: string;
}

interface TestHost {
  id: string;
  host: string;
  port: number;
  username: string;
}

function makeSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    hostConfig: { host: "example.com", port: 22, username: "root" },
    sessionType: "ssh",
    label: "root@example.com",
    ...overrides,
  };
}

const hosts: TestHost[] = [
  { id: "h1", host: "example.com", port: 22, username: "root" },
  { id: "h2", host: "other.com", port: 2222, username: "admin" },
];

// ─── serializeLayoutNode ──────────────────────────────────────────────────────

describe("serializeLayoutNode", () => {
  it("serializes a single remote pane", () => {
    const sessions = new Map<string, TestSession>([["s1", makeSession()]]);
    const node: LayoutNode = { type: "pane", sessionId: "s1" };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "pane",
      hostId: "h1",
      label: "root@example.com",
      accent: undefined,
    });
  });

  it("serializes a local pane (hostId = undefined)", () => {
    const sessions = new Map<string, TestSession>([
      ["s1", makeSession({ sessionType: "local", hostConfig: undefined, label: "Local Terminal" })],
    ]);
    const node: LayoutNode = { type: "pane", sessionId: "s1" };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "pane",
      hostId: undefined,
      label: "Local Terminal",
      accent: undefined,
    });
  });

  it("serializes a custom accent", () => {
    const sessions = new Map<string, TestSession>([
      ["s1", makeSession({ accent: "oklch(0.70 0.15 250)" })],
    ]);
    const node: LayoutNode = { type: "pane", sessionId: "s1" };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "pane",
      hostId: "h1",
      label: "root@example.com",
      accent: "oklch(0.70 0.15 250)",
    });
  });

  it("returns Unknown for a missing session", () => {
    const sessions = new Map<string, TestSession>();
    const node: LayoutNode = { type: "pane", sessionId: "gone" };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "pane",
      label: "Unknown",
    });
  });

  it("does not match a host with a different port", () => {
    const sessions = new Map<string, TestSession>([
      ["s1", makeSession({ hostConfig: { host: "example.com", port: 9999, username: "root" } })],
    ]);
    const node: LayoutNode = { type: "pane", sessionId: "s1" };

    // No host matches host:example.com port:9999 — hostId should be undefined.
    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "pane",
      hostId: undefined,
      label: "root@example.com",
      accent: undefined,
    });
  });

  it("serializes a horizontal split", () => {
    const sessions = new Map<string, TestSession>([
      ["s1", makeSession({ label: "left" })],
      [
        "s2",
        makeSession({
          hostConfig: { host: "other.com", port: 2222, username: "admin" },
          label: "admin@other.com",
        }),
      ],
    ]);
    const node: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      children: [
        { type: "pane", sessionId: "s1" },
        { type: "pane", sessionId: "s2" },
      ],
    };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      children: [
        { type: "pane", hostId: "h1", label: "left", accent: undefined },
        { type: "pane", hostId: "h2", label: "admin@other.com", accent: undefined },
      ],
    });
  });

  it("serializes a vertical split", () => {
    const sessions = new Map<string, TestSession>([
      ["s1", makeSession({ label: "top" })],
      ["s2", makeSession({ label: "bottom" })],
    ]);
    const node: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.3,
      children: [
        { type: "pane", sessionId: "s1" },
        { type: "pane", sessionId: "s2" },
      ],
    };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "split",
      direction: "vertical",
      ratio: 0.3,
      children: [
        { type: "pane", hostId: "h1", label: "top", accent: undefined },
        { type: "pane", hostId: "h1", label: "bottom", accent: undefined },
      ],
    });
  });

  it("serializes nested splits (3 panes)", () => {
    const sessions = new Map<string, TestSession>([
      ["s1", makeSession({ label: "top" })],
      ["s2", makeSession({ label: "bottom-left" })],
      ["s3", makeSession({ label: "bottom-right" })],
    ]);
    const node: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "pane", sessionId: "s1" },
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.4,
          children: [
            { type: "pane", sessionId: "s2" },
            { type: "pane", sessionId: "s3" },
          ],
        },
      ],
    };

    expect(serializeLayoutNode(node, sessions, hosts)).toEqual({
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "pane", hostId: "h1", label: "top", accent: undefined },
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.4,
          children: [
            { type: "pane", hostId: "h1", label: "bottom-left", accent: undefined },
            { type: "pane", hostId: "h1", label: "bottom-right", accent: undefined },
          ],
        },
      ],
    });
  });
});
