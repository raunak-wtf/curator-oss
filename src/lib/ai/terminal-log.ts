import type { AgentEvent, TerminalCommand, TerminalCommandSource } from "../types";

/** Characters of output kept per command. The tail is kept because errors usually appear at the end. */
export const TERMINAL_OUTPUT_LIMIT = 4_000;
/** Commands kept per build. */
export const TERMINAL_COMMANDS_LIMIT = 40;
const REDACTION = "••••••";

// Matches ANSI colour and cursor sequences so the read-only terminal shows plain text.
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Records the commands a build runs so the owner can watch them in a read-only terminal.
 * Secret values are replaced before anything is emitted or saved.
 */
export function createTerminalLog(emit: (event: AgentEvent) => void | Promise<void>, secretValues: string[] = []) {
  // Short values would redact ordinary words, so only mask values long enough to be credentials.
  let secrets = [...new Set(secretValues.filter((value) => value.length >= 6))].sort((a, b) => b.length - a.length);
  const commands: TerminalCommand[] = [];

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

  return { start, end, redact, addSecrets, commands };
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
