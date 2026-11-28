import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type ShouldCompactInput = {
  turn: number;
  turnsSinceLastCompaction: number;
  estimatedChars: number;
  lastToolResultChars: number;
  charThreshold?: number;
};

export function shouldCompactContext(input: ShouldCompactInput): boolean {
  if (input.turn < 6) {
    return false;
  }
  return (
    input.turnsSinceLastCompaction >= 6 ||
    input.lastToolResultChars >= 24_000 ||
    input.estimatedChars >= (input.charThreshold ?? 90_000)
  );
}

const DIAGNOSTIC_LINE_PATTERN =
  /error TS\d+|ERR!|ERESOLVE|Module not found|SyntaxError|TypeError|ReferenceError|drizzle|exitCode|Failed to compile|^\s+at\s+/im;

function isDiagnosticLine(line: string): boolean {
  DIAGNOSTIC_LINE_PATTERN.lastIndex = 0;
  return DIAGNOSTIC_LINE_PATTERN.test(line);
}

export function truncateCommandOutputDeterministically(output: string, maxChars = 6_000): string {
  if (output.length <= maxChars) {
    return output;
  }
  const allLines = output.split("\n");
  const diagnosticLines: string[] = [];
  const diagnosticIndexes = new Set<number>();
  allLines.forEach((line, index) => {
    if (isDiagnosticLine(line)) {
      diagnosticLines.push(line);
      diagnosticIndexes.add(index);
    }
  });

  const headLines: string[] = [];
  const tailLines: string[] = [];
  let headBudget = Math.floor(maxChars * 0.25);
  let tailBudget = Math.floor(maxChars * 0.25);
  for (const line of allLines) {
    if (headBudget <= 0) {
      break;
    }
    headLines.push(line);
    headBudget -= line.length + 1;
  }
  for (let index = allLines.length - 1; index >= 0; index -= 1) {
    if (tailBudget <= 0) {
      break;
    }
    const line = allLines[index];
    tailLines.unshift(line);
    tailBudget -= line.length + 1;
  }

  const parts: string[] = [];
  const appendPart = (label: string, lines: string[]) => {
    if (lines.length === 0) {
      return;
    }
    const body = lines.join("\n");
    const chunk = `[${label}]\n${body}`;
    parts.push(chunk);
    return chunk.length;
  };

  appendPart("output head", headLines);
  if (diagnosticLines.length > 0) {
    appendPart("diagnostic lines", diagnosticLines);
  }
  appendPart("output tail", tailLines);

  let truncated = parts.join("\n\n");
  if (truncated.length > maxChars) {
    truncated = truncated.slice(0, maxChars);
  }
  return `… output truncated (${output.length} chars → ${Math.min(truncated.length, maxChars)} chars) …\n${truncated}`;
}

export type CompactionState = {
  originalPrompt: string;
  mode: "build" | "plan" | "security";
  changedFiles: Array<{ path: string; hash?: string }>;
  unresolvedErrors: string[];
  verifiedChecks: string[];
  constraints?: string[];
};

function renderCompactionSummary(state: CompactionState): string {
  const changedFiles =
    state.changedFiles.length > 0
      ? state.changedFiles.map((file) => `- ${file.path}${file.hash ? ` (sha256 ${file.hash.slice(0, 12)})` : ""}`).join("\n")
      : "None yet";
  const unresolvedErrors =
    state.unresolvedErrors.length > 0 ? state.unresolvedErrors.map((error) => `- ${error}`).join("\n") : "None recorded";
  const verifiedChecks =
    state.verifiedChecks.length > 0
      ? state.verifiedChecks.map((check) => `- ${check}`).join("\n")
      : "None verified yet";
  const constraints =
    state.constraints && state.constraints.length > 0
      ? state.constraints.map((constraint) => `- ${constraint}`).join("\n")
      : "None";
  return [
    "<context-compaction>",
    "Earlier conversation turns were compacted. The following is the authoritative state:",
    "",
    "## Original user request",
    state.originalPrompt,
    "",
    "## Constraints",
    constraints,
    "",
    "## Changed files",
    changedFiles,
    "",
    "## Unresolved errors",
    unresolvedErrors,
    "",
    "## Verified checks",
    verifiedChecks,
    "",
    "Do not re-read unchanged files, do not repeat completed work, and continue from the unresolved errors above.",
    "</context-compaction>",
  ].join("\n");
}

function isToolMessage(message: ChatCompletionMessageParam): boolean {
  return message.role === "tool";
}

function assistantMessageHasToolCalls(message: ChatCompletionMessageParam): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

export function compactAgentMessages(
  messages: ChatCompletionMessageParam[],
  state: CompactionState,
  keepRecentMessages = 4,
): ChatCompletionMessageParam[] {
  if (messages.length === 0) {
    return [
      { role: "user", content: renderCompactionSummary(state) },
    ];
  }

  const systemMessage = messages[0]?.role === "system" ? messages[0] : null;
  const recentStart = Math.max(systemMessage ? 1 : 0, messages.length - keepRecentMessages);
  let recent = messages.slice(recentStart);

  // Trim leading orphaned tool messages whose triggering assistant message was dropped.
  while (recent.length > 0 && isToolMessage(recent[0])) {
    const toolMessage = recent[0] as { role: "tool"; tool_call_id?: string };
    const hasCaller = recent.some(
      (message) => assistantMessageHasToolCalls(message) &&
        Array.isArray((message as { tool_calls?: Array<{ id?: string }> }).tool_calls) &&
        ((message as { tool_calls?: Array<{ id?: string }> }).tool_calls ?? []).some(
          (call) => call.id === toolMessage.tool_call_id,
        ),
    );
    if (hasCaller) {
      break;
    }
    recent = recent.slice(1);
  }

  const compacted: ChatCompletionMessageParam[] = [];
  if (systemMessage) {
    compacted.push(systemMessage);
  }
  compacted.push({ role: "user", content: renderCompactionSummary(state) });
  compacted.push(...recent);
  return compacted;
}
