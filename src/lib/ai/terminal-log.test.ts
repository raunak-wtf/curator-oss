import { describe, expect, it, vi } from "vitest";
import { createTerminalLog, TERMINAL_COMMANDS_LIMIT } from "./terminal-log";

describe("terminal command metrics", () => {
  it("keeps aggregate counts after visible command history is capped", async () => {
    const log = createTerminalLog(vi.fn());

    for (let index = 0; index < TERMINAL_COMMANDS_LIMIT + 3; index += 1) {
      const entry = await log.start(index === 0 ? "npm run build" : "npm run lint", "agent");
      await log.end(entry, { exitCode: index === 2 ? 1 : 0, output: "" });
    }

    expect(log.commands).toHaveLength(TERMINAL_COMMANDS_LIMIT);
    expect(log.stats.count).toBe(TERMINAL_COMMANDS_LIMIT + 3);
    expect(log.stats.failed).toBe(1);
    expect(log.stats.productionBuilds).toBe(1);
  });

  it("classifies installs and background preview starts without retaining extra payloads", async () => {
    const log = createTerminalLog(vi.fn());
    const install = await log.start("npm install --no-audit", "system");
    await log.end(install, { exitCode: 0, output: "installed" });
    const preview = await log.start("npm run dev -- --hostname 0.0.0.0", "system", true);
    await log.end(preview, { exitCode: null, output: "started" });

    expect(log.stats).toMatchObject({ count: 2, installs: 1, background: 1, previewStarts: 1 });
  });
});
