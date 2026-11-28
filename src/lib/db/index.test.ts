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

  it("auto-heals 42703 missing-column errors on Neon regional api.<region>.aws.neon.tech endpoints for the host DB only", async () => {
    const hostConn = "postgresql://owner:secret@ep-cool-frog-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const customerConn = "postgresql://app:secret@ep-customer-app.us-east-1.aws.neon.tech/appdb?sslmode=require";

    const healFn = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "42703",
            message: 'column "email_verified" of relation "users" does not exist',
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "42703",
            message: 'column "missing_customer_col" of relation "todos" does not exist',
          }),
          { status: 400 },
        ),
      );

    const wrapped = createResilientNeonFetch(hostConn, mockFetch, healFn);

    // 1. Host DB query sent to regional `api.us-east-1.aws.neon.tech/sql` heals and retries -> 200
    const hostRes = await wrapped("https://api.us-east-1.aws.neon.tech/sql", {
      method: "POST",
      headers: { "Neon-Connection-String": hostConn },
      body: "{}",
    });
    expect(hostRes.status).toBe(200);
    expect(healFn).toHaveBeenCalledTimes(1);
    expect(healFn).toHaveBeenCalledWith(hostConn, expect.any(Object));

    // 2. Customer DB query to the exact same `api.us-east-1.aws.neon.tech/sql` endpoint NEVER triggers host schema healing
    const customerRes = await wrapped("https://api.us-east-1.aws.neon.tech/sql", {
      method: "POST",
      headers: { "Neon-Connection-String": customerConn },
      body: "{}",
    });
    expect(customerRes.status).toBe(400);
    expect(healFn).toHaveBeenCalledTimes(1);
  });
});
