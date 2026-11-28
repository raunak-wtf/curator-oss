import { describe, expect, it } from "vitest";
import { deriveServerActionsEncryptionKey } from "./secrets-crypto";

const hostKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");

describe("deriveServerActionsEncryptionKey", () => {
  it("returns a stable 32-byte base64 key for one project", () => {
    const first = deriveServerActionsEncryptionKey("project-1", hostKey);
    const second = deriveServerActionsEncryptionKey("project-1", hostKey);

    expect(first).toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(32);
  });

  it("scopes the derived key to the project", () => {
    expect(deriveServerActionsEncryptionKey("project-1", hostKey)).not.toBe(
      deriveServerActionsEncryptionKey("project-2", hostKey),
    );
  });
});
