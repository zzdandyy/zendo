import { describe, it, expect, afterEach } from "vitest";
import {
  suppressTerminalFits,
  resumeTerminalFits,
  shouldFit,
} from "./terminal-instances";

describe("terminal-instances — fit suppression", () => {
  // After each test we must resume fits so the module-level state is clean.
  afterEach(() => {
    resumeTerminalFits();
  });

  describe("shouldFit", () => {
    it("returns true when fits are not suppressed", () => {
      expect(shouldFit("s1")).toBe(true);
    });

    it("returns false when fits are suppressed", () => {
      suppressTerminalFits();
      expect(shouldFit("s1")).toBe(false);
    });

    it("marks the session dirty when suppressed", () => {
      suppressTerminalFits();
      shouldFit("s1");
      shouldFit("s2");

      // After resuming, dirty sessions should be flushed.
      // We can observe that resumeTerminalFits doesn't throw.
      resumeTerminalFits();
      // After resume, subsequent shouldFit returns true again.
      expect(shouldFit("s1")).toBe(true);
    });
  });

  describe("suppressTerminalFits / resumeTerminalFits", () => {
    it("shouldFit returns false while suppressed", () => {
      suppressTerminalFits();
      expect(shouldFit("any")).toBe(false);
    });

    it("shouldFit returns true after resume", () => {
      suppressTerminalFits();
      resumeTerminalFits();
      expect(shouldFit("any")).toBe(true);
    });

    it("multiple suppress/resume cycles work correctly", () => {
      suppressTerminalFits();
      expect(shouldFit("a")).toBe(false);
      resumeTerminalFits();
      expect(shouldFit("a")).toBe(true);

      suppressTerminalFits();
      expect(shouldFit("b")).toBe(false);
      resumeTerminalFits();
      expect(shouldFit("b")).toBe(true);
    });

    it("resume without prior suppress is harmless", () => {
      // Calling resume when not suppressed shouldn't throw
      expect(() => resumeTerminalFits()).not.toThrow();
      expect(shouldFit("x")).toBe(true);
    });
  });
});
