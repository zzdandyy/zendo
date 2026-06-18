import type { LayoutNode } from "../types";
import type { PinnedTabDescriptor, PinnedLayoutNode } from "./tab-store";

/**
 * Rebuild all PinnedTabDescriptor[] from live session/tab state and persist.
 *
 * Called after every mutation that could affect a pinned tab so persistence is
 * crash-safe — no reliance on `beforeunload`.
 *
 * Uses dynamic imports for store access to avoid making circular import chains
 * between session-store ↔ tab-store ↔ settings-store ↔ hosts-store any deeper
 * than they already are.
 */
export async function syncPinnedTabs(): Promise<void> {
  const [{ useTabStore }, { useSessionStore }, { useHostsStore }, { useSettingsStore }] =
    await Promise.all([
      import("./tab-store"),
      import("./session-store"),
      import("./hosts-store"),
      import("./settings-store"),
    ]);

  const tabStore = useTabStore.getState();
  const sessionStore = useSessionStore.getState();
  const hostsStore = useHostsStore.getState();
  const settingsStore = useSettingsStore.getState();

  const descriptors: PinnedTabDescriptor[] = [];

  for (const tabId of tabStore.pinnedTabIds) {
    const tab = tabStore.tabs.get(tabId);
    if (!tab || tab.type !== "terminal") continue;

    const termTab = sessionStore.tabs.get(tabId);
    if (!termTab) continue;

    // Serialize floating panes for this tab
    const floatingDescs: import("./tab-store").PinnedFloatingPaneDescriptor[] = [];
    const fpList = sessionStore.floatingPanes.get(tabId);
    if (fpList) {
      for (const fp of fpList) {
        const sess = sessionStore.sessions.get(fp.sessionId);
        if (!sess) continue;
        const fHostId =
          sess.sessionType === "local"
            ? undefined
            : hostsStore.hosts.find(
                (h) =>
                  h.host === sess.hostConfig?.host &&
                  h.port === sess.hostConfig?.port &&
                  h.username === sess.hostConfig?.username,
              )?.id;
        floatingDescs.push({
          hostId: fHostId,
          label: sess.label,
          accent: sess.accent,
          x: fp.x,
          y: fp.y,
          width: fp.width,
          height: fp.height,
        });
      }
    }

    descriptors.push({
      type: "terminal",
      label: tab.label,
      layout: serializeLayoutNode(
        termTab.layout,
        sessionStore.sessions,
        hostsStore.hosts,
      ),
      floatingPanes: floatingDescs.length > 0 ? floatingDescs : undefined,
    });
  }

  settingsStore.setPinnedTabs(descriptors);
}

// ─── Throttled variant for high-frequency mutations ───────────────────────────

const COOLDOWN_MS = 10_000;

let dirty = false;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

function startCooldown(): void {
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    if (dirty) {
      void syncPinnedTabs();
      dirty = false;
      startCooldown(); // keep looping while new changes arrive
    }
  }, COOLDOWN_MS);
}

/**
 * Like {@link syncPinnedTabs}, but rate-limited for high-frequency mutations
 * (drag, resize).  First call saves immediately and starts a 10 s cooldown.
 * Calls during the cooldown only set a dirty flag.  When the cooldown expires,
 * a final save fires if dirty was set, then restarts the cooldown — ensuring
 * the last state is always persisted without hammering the disk on every
 * mousemove.  Once the user stops and a full cooldown passes clean, the cycle
 * ends.
 */
export function syncPinnedTabsThrottled(): void {
  if (cooldownTimer) {
    dirty = true;
    return;
  }

  // Not in cooldown — save immediately and boot the loop.
  void syncPinnedTabs();
  dirty = false;
  startCooldown();
}

/** Recursively serialize a LayoutNode tree into a PinnedLayoutNode. */
export function serializeLayoutNode(
  node: LayoutNode,
  sessions: Map<string, { hostConfig?: { host: string; port: number; username: string }; sessionType?: string; label: string; accent?: string }>,
  hosts: Array<{ id: string; host: string; port: number; username: string }>,
): PinnedLayoutNode {
  if (node.type === "pane") {
    const session = sessions.get(node.sessionId);
    if (!session) {
      // Shouldn't happen for a connected pane, but be defensive.
      return { type: "pane", label: "Unknown" };
    }

    const hostId =
      session.sessionType === "local"
        ? undefined
        : hosts.find(
            (h) =>
              h.host === session.hostConfig?.host &&
              h.port === session.hostConfig?.port &&
              h.username === session.hostConfig?.username,
          )?.id;

    return {
      type: "pane",
      hostId,
      label: session.label,
      accent: session.accent,
    };
  }

  // Split node
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [
      serializeLayoutNode(node.children[0], sessions, hosts),
      serializeLayoutNode(node.children[1], sessions, hosts),
    ],
  };
}
