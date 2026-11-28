import { createHash } from "node:crypto";

export type AgentTurnBudget = {
  softBudget: number;
  hardBudget: number;
  category: "localized_edit" | "frontend_new" | "fullstack_new" | "repair" | "plan" | "security";
};

export type TurnBudgetInput = {
  mode: "build" | "plan" | "security";
  prompt: string;
  isNewProject: boolean;
  cloudFeaturesCount: number;
  hasVisualSelections: boolean;
  isErrorRepair?: boolean;
};

export function resolveAdaptiveTurnBudget(input: TurnBudgetInput): AgentTurnBudget {
  if (input.mode === "plan") {
    return { softBudget: 12, hardBudget: 18, category: "plan" };
  }
  if (input.mode === "security") {
    return { softBudget: 14, hardBudget: 24, category: "security" };
  }
  if (input.isErrorRepair) {
    return { softBudget: 10, hardBudget: 16, category: "repair" };
  }
  if (!input.isNewProject && (input.hasVisualSelections || input.prompt.length < 220)) {
    return { softBudget: 12, hardBudget: 16, category: "localized_edit" };
  }
  if (input.cloudFeaturesCount > 0) {
    return { softBudget: 20, hardBudget: 30, category: "fullstack_new" };
  }
  return { softBudget: 16, hardBudget: 22, category: "frontend_new" };
}

type FileReadRecord = {
  hash: string;
  rereadCount: number;
};

type CommandRecord = {
  count: number;
  failureSignature: string | null;
  identicalFailureStreak: number;
  lastExitCode: number | null;
};

export type FileReadResult = {
  isUnchangedReread: boolean;
  hash: string;
  rereadCount: number;
  warning?: string;
};

export type CommandResult = {
  repeated: boolean;
  identicalFailureStreak: number;
  warning?: string;
};

export type PreviewCheckResult = {
  repeated: boolean;
  warning?: string;
};

export type LoopGuardStats = {
  unchangedFileRereads: number;
  repeatedCommands: number;
  repeatedPreviewChecks: number;
  maxErrorStreak: number;
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createAgentLoopGuard() {
  const fileReads = new Map<string, FileReadRecord>();
  const commands = new Map<string, CommandRecord>();
  const previewChecks = new Map<string, number>();
  let unchangedFileRereads = 0;
  let repeatedCommands = 0;
  let repeatedPreviewChecks = 0;
  let maxErrorStreak = 0;

  function recordFileRead(filePath: string, content: string, rangeKey = ""): FileReadResult {
    const key = `${filePath}::${rangeKey}`;
    const hash = hashContent(content);
    const previous = fileReads.get(key);
    if (previous) {
      const isUnchangedReread = previous.hash === hash;
      previous.rereadCount += 1;
      if (isUnchangedReread) {
        unchangedFileRereads += 1;
      }
      const result: FileReadResult = {
        isUnchangedReread,
        hash,
        rereadCount: previous.rereadCount,
      };
      if (isUnchangedReread && previous.rereadCount >= 1) {
        result.warning = `File ${filePath}${
          rangeKey ? ` (${rangeKey})` : ""
        } was read ${previous.rereadCount + 1} times without changing. Use the earlier read result instead of re-reading.`;
      }
      return result;
    }
    fileReads.set(key, { hash, rereadCount: 0 });
    return { isUnchangedReread: false, hash, rereadCount: 0 };
  }

  function invalidateFile(filePath: string): void {
    for (const key of fileReads.keys()) {
      if (key === filePath || key.startsWith(`${filePath}::`)) {
        fileReads.delete(key);
      }
    }
  }

  function invalidateAllFiles(): void {
    fileReads.clear();
  }

  function recordCommand(command: string, exitCode: number | null, errorSignature?: string): CommandResult {
    const signature = exitCode !== null && exitCode !== 0 ? errorSignature?.trim() || `exit:${exitCode}` : null;
    const previous = commands.get(command);
    if (!previous) {
      const streak = signature ? 1 : 0;
      commands.set(command, {
        count: 1,
        failureSignature: signature,
        identicalFailureStreak: streak,
        lastExitCode: exitCode,
      });
      maxErrorStreak = Math.max(maxErrorStreak, streak);
      return { repeated: false, identicalFailureStreak: streak };
    }
    previous.count += 1;
    const isRepeatedFailure =
      previous.count >= 2 && signature !== null && previous.failureSignature === signature && previous.lastExitCode === exitCode;
    if (isRepeatedFailure) {
      previous.identicalFailureStreak += 1;
    } else if (signature) {
      previous.identicalFailureStreak = 1;
    } else {
      previous.identicalFailureStreak = 0;
    }
    previous.failureSignature = signature;
    previous.lastExitCode = exitCode;
    maxErrorStreak = Math.max(maxErrorStreak, previous.identicalFailureStreak);
    const repeated = previous.count >= 2;
    if (repeated) {
      repeatedCommands += 1;
    }
    const result: CommandResult = {
      repeated,
      identicalFailureStreak: previous.identicalFailureStreak,
    };
    if (repeated) {
      result.warning = `Command ran ${previous.count} times${
        previous.identicalFailureStreak >= 2
          ? ` and failed identically ${previous.identicalFailureStreak} times in a row. Change the approach instead of repeating it.`
          : "."
      }`;
    }
    return result;
  }

  function recordPreviewCheck(routes: readonly string[]): PreviewCheckResult {
    const key = [...routes].sort().join("|");
    const previousCount = previewChecks.get(key) ?? 0;
    previewChecks.set(key, previousCount + 1);
    const repeated = previousCount >= 1;
    if (repeated) {
      repeatedPreviewChecks += 1;
    }
    const result: PreviewCheckResult = { repeated };
    if (repeated) {
      result.warning = `Preview routes (${routes.join(", ")}) were already checked. Only re-check after a code change.`;
    }
    return result;
  }

  function stats(): LoopGuardStats {
    return {
      unchangedFileRereads,
      repeatedCommands,
      repeatedPreviewChecks,
      maxErrorStreak,
    };
  }

  return {
    recordFileRead,
    invalidateFile,
    invalidateAllFiles,
    recordCommand,
    recordPreviewCheck,
    stats,
  };
}
