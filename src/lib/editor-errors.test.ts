import { describe, it, expect } from "vitest";
import { editorLaunchErrorMessage } from "./editor-errors";

describe("editorLaunchErrorMessage", () => {
  const fallback = "Default fallback message";

  it("extracts message from an Error object", () => {
    expect(editorLaunchErrorMessage(new Error("Permission denied"), fallback)).toBe(
      "Permission denied",
    );
  });

  it("extracts message from an error-like object", () => {
    expect(editorLaunchErrorMessage({ message: "File not found" }, fallback)).toBe(
      "File not found",
    );
  });

  it("returns the fallback for an Error with empty message", () => {
    expect(editorLaunchErrorMessage(new Error(""), fallback)).toBe(fallback);
  });

  it("returns the fallback for a null error", () => {
    expect(editorLaunchErrorMessage(null, fallback)).toBe(fallback);
  });

  it("returns the fallback for undefined error", () => {
    expect(editorLaunchErrorMessage(undefined, fallback)).toBe(fallback);
  });

  it("returns the string itself for a string error", () => {
    expect(editorLaunchErrorMessage("Something broke", fallback)).toBe("Something broke");
  });

  it("returns fallback for an empty string error", () => {
    expect(editorLaunchErrorMessage("   ", fallback)).toBe(fallback);
  });

  it("returns fallback for an arbitrary object without message", () => {
    expect(editorLaunchErrorMessage({ code: 42 }, fallback)).toBe(fallback);
  });
});
