import { describe, expect, it, vi } from "vitest";
import {
  extractStreamingActivityLabel,
  isRetryableModelError,
  ModelStreamTimeoutError,
  streamModelTurnWithRetry,
  type StreamChunkLike,
} from "./model-stream";

async function* chunksFromArray(items: StreamChunkLike[], delayMs = 0): AsyncIterable<StreamChunkLike> {
  for (const item of items) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield item;
  }
}

describe("model-stream resilience & retries", () => {
  it("retries automatically when a stream stalls mid-flight and succeeds on the next attempt", async () => {
    let calls = 0;
    const statuses: string[] = [];

    const result = await streamModelTurnWithRetry({
      maxAttempts: 3,
      firstChunkTimeoutMs: 60,
      chunkStallTimeoutMs: 40,
      baseBackoffMs: [10, 20],
      statusThrottleMs: 0,
      onStatus: (label) => {
        statuses.push(label);
      },
      createStream: async () => {
        calls += 1;
        if (calls === 1) {
          // Emit 1 chunk and then hang forever to simulate an upstream SSE stall
          return {
            [Symbol.asyncIterator]() {
              let sent = false;
              return {
                async next() {
                  if (!sent) {
                    sent = true;
                    return {
                      done: false,
                      value: {
                        choices: [{ delta: { tool_calls: [{ index: 0, id: "tc_1", function: { name: "write_file", arguments: '{"path":"package.json"' } }] } }],
                      },
                    };
                  }
                  return new Promise<IteratorResult<StreamChunkLike>>(() => {});
                },
              };
            },
          };
        }
        return chunksFromArray([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "tc_2",
                      function: { name: "write_file", arguments: '{"path":"src/lib/db.ts","content":"ok"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]);
      },
    });

    expect(calls).toBe(2);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.function.name).toBe("write_file");
    expect(statuses.some((s) => s.includes("Drafting package.json"))).toBe(true);
    expect(statuses.some((s) => s.includes("Model stream stalled — retrying (2/3)"))).toBe(true);
    expect(statuses.some((s) => s.includes("Drafting src/lib/db.ts"))).toBe(true);
  });

  it("retries empty ghost streams and transient 502/503/429 errors, but does not retry 401 auth errors", async () => {
    expect(isRetryableModelError(Object.assign(new Error("Bad gateway"), { status: 502 }))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("Cloudflare timeout"), { status: 524 }))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("Rate limit"), { status: 429 }))).toBe(true);
    expect(isRetryableModelError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableModelError(new ModelStreamTimeoutError("first_chunk_timeout", "slow"))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("Unauthorized"), { status: 401 }))).toBe(false);

    let attempt = 0;
    const res = await streamModelTurnWithRetry({
      maxAttempts: 3,
      baseBackoffMs: [5, 10],
      createStream: async () => {
        attempt += 1;
        if (attempt === 1) {
          // Empty stream with no finish_reason (proxy drop)
          return chunksFromArray([]);
        }
        return chunksFromArray([
          { choices: [{ delta: { content: "All set!" }, finish_reason: "stop" }] },
        ]);
      },
    });

    expect(attempt).toBe(2);
    expect(res.content).toBe("All set!");
  });

  it("flags trailing truncated tool-call JSON when finish_reason is length while keeping earlier valid calls", async () => {
    const res = await streamModelTurnWithRetry({
      createStream: async () =>
        chunksFromArray([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "ok_1", function: { name: "write_file", arguments: '{"path":"a.ts","content":"1"}' } },
                    { index: 1, id: "cut_2", function: { name: "write_file", arguments: '{"path":"b.ts","content":"unterminated' } },
                  ],
                },
                finish_reason: "length",
              },
            ],
          },
        ]),
    });

    expect(res.calls).toHaveLength(2);
    expect(res.calls[0]?.truncatedJson).toBeUndefined();
    expect(res.calls[1]?.truncatedJson).toBe(true);
  });

  it("extracts readable live activity labels from streaming tool arguments", () => {
    expect(extractStreamingActivityLabel("write_file", '{"path":"src/lib/auth.ts","content":"...')).toBe(
      "Drafting src/lib/auth.ts",
    );
    expect(extractStreamingActivityLabel("run_command", '{"command":"npm install drizzle-orm pg"')).toBe(
      "Preparing command: npm install drizzle-orm pg",
    );
    expect(extractStreamingActivityLabel("neon_database", '{"action":"provision"}')).toBe(
      "Preparing Neon database (provision)",
    );
    const noop = vi.fn();
    expect(noop).not.toHaveBeenCalled();
  });
});
