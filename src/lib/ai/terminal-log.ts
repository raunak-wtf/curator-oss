import type { AgentEvent, TerminalCommand, TerminalCommandSource } from "../types";
import { isProductionBuildCommand } from "./agent-policy";

/** Characters of output kept per command. The tail is kept because errors usually appear at the end. */
export const TERMINAL_OUTPUT_LIMIT = 4_000;
/** Commands kept per build. */
export const TERMINAL_COMMANDS_LIMIT = 40;
const REDACTION = "••••••";

// Matches ANSI colour and cursor sequences so the read-only terminal shows plain text.
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function isDependencyInstallCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci)(?:\s|$)/i.test(command);
}

export function isPreviewStartCommand(command: string, background = true): boolean {
  return (
    background
    && /\b(?:next\s+(?:dev|start)|npm\s+run\s+(?:dev|start)|pnpm\s+(?:run\s+)?(?:dev|start)|yarn\s+(?:dev|start)|bun\s+(?:run\s+)?(?:dev|start))\b/i.test(
      command,
    )
  );
}

export type TerminalCommandStats = {
  count: number;
  failed: number;
  durationMs: number;
  background: number;
  productionBuilds: number;
  installs: number;
  previewStarts: number;
};

/**
 * Records the commands a build runs so the owner can watch them in a read-only terminal.
 * Secret values are replaced before anything is emitted or saved.
 */
export function createTerminalLog(emit: (event: AgentEvent) => void | Promise<void>, secretValues: string[] = []) {
  // Short values would redact ordinary words, so only mask values long enough to be credentials.
  let secrets = [...new Set(secretValues.filter((value) => value.length >= 6))].sort((a, b) => b.length - a.length);
  const commands: TerminalCommand[] = [];
  const stats: TerminalCommandStats = {
    count: 0,
    failed: 0,
    durationMs: 0,
    background: 0,
    productionBuilds: 0,
    installs: 0,
    previewStarts: 0,
  };

  function addSecrets(values: string[]) {
    secrets = [...new Set([...secrets, ...values.filter((value) => value.length >= 6)])].sort(
      (a, b) => b.length - a.length,
    );
  }

  function redact(text: string) {
    return secrets.reduce((result, secret) => result.split(secret).join(REDACTION), text);
  }

  function clean(output: string) {
    const text = redact(output.replace(ANSI_PATTERN, "").replace(/\r(?!\n)/g, "\n")).trimEnd();
    return text.length > TERMINAL_OUTPUT_LIMIT ? `…${text.slice(-TERMINAL_OUTPUT_LIMIT)}` : text;
  }

  async function start(command: string, source: TerminalCommandSource, background = false) {
    const entry = {
      id: crypto.randomUUID(),
      command: redact(command).slice(0, 2_000),
      source,
      background,
      startedAt: Date.now(),
    };
    await emit({ type: "command_start", id: entry.id, command: entry.command, source, background });
    return entry;
  }

  async function end(entry: Awaited<ReturnType<typeof start>>, result: { exitCode: number | null; output: string; failed?: boolean }) {
    const command: TerminalCommand = {
      id: entry.id,
      command: entry.command,
      source: entry.source,
      background: entry.background,
      exitCode: result.exitCode,
      output: clean(result.output),
      failed: result.failed ?? (result.exitCode !== null && result.exitCode !== 0),
      startedAt: new Date(entry.startedAt).toISOString(),
      durationMs: Date.now() - entry.startedAt,
    };
    stats.count += 1;
    stats.durationMs += command.durationMs;
    if (command.failed) stats.failed += 1;
    if (command.background) stats.background += 1;
    if (isProductionBuildCommand(entry.command)) stats.productionBuilds += 1;
    if (isDependencyInstallCommand(entry.command)) stats.installs += 1;
    if (isPreviewStartCommand(entry.command, command.background)) {
      stats.previewStarts += 1;
    }
    commands.push(command);
    if (commands.length > TERMINAL_COMMANDS_LIMIT) commands.shift();
    await emit({
      type: "command_end",
      id: command.id,
      exitCode: command.exitCode,
      output: command.output,
      failed: command.failed,
      durationMs: command.durationMs,
    });
  }

  return { start, end, redact, addSecrets, commands, stats };
}

/** Reads the exit code and output from a run_command tool result. */
export function parseRunCommandOutput(output: string): { exitCode: number | null; output: string } {
  try {
    const parsed = JSON.parse(output) as { exitCode?: unknown; output?: unknown; stdout?: unknown; stderr?: unknown };
    if (typeof parsed.output === "string") {
      return { exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null, output: parsed.output };
    }
    // Background commands report their first output and keep running.
    const started = [parsed.stdout, parsed.stderr].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
    return { exitCode: null, output: started || "Started in the background." };
  } catch {
    return { exitCode: null, output };
  }
}
