import { describe, expect, it, vi } from "vitest";
import { createResilientNeonFetch } from "./index";

describe("createResilientNeonFetch", () => {
  it("retries transient network failures and 503 responses before succeeding", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [{ id: "1" }] }), { status: 200 }));

    const wrapped = createResilientNeonFetch("", mockFetch);
    const res = await wrapped("https://ep-example.neon.tech/sql", { method: "POST", body: "{}" });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0]?.[1]?.cache).toBe("no-store");
  });
});
