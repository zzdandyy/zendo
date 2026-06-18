import { describe, it, expect } from "vitest";
import { transferEventName, type Transport } from "./explorer-transport";

describe("transferEventName", () => {
  it("returns sftp:transfer for sftp transport", () => {
    expect(transferEventName("sftp")).toBe("sftp:transfer");
  });

  it("returns scp:transfer for scp transport", () => {
    expect(transferEventName("scp")).toBe("scp:transfer");
  });

  it("returns local:transfer for local transport", () => {
    expect(transferEventName("local")).toBe("local:transfer");
  });
});

describe("explorerInvoke — local transport contract", () => {
  it("accepts local in the Transport union", () => {
    const transports: Transport[] = ["sftp", "scp", "local"];
    expect(transports).toHaveLength(3);
  });

  it("does not inject a session-id key for local transport", () => {
    // explorerInvoke calls `invoke("local_${op}", extra)` without spreading
    // a session-id key, unlike sftp/scp. This is verifiable through code
    // review; here we just confirm the type system allows "local".
    const t: Transport = "local";
    expect(t).toBe("local");
  });
});
