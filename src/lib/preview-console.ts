import { z } from "zod";
import type {
  PreviewConsoleEntry,
  PreviewConsoleInput,
  PreviewConsoleLevel,
  PreviewConsoleSource,
} from "./types";

export const PREVIEW_CONSOLE_MAX_ENTRIES = 300;

export const previewConsoleInputSchema = z.object({
  source: z.enum(["browser", "network", "server"]).default("browser"),
  level: z.enum(["log", "info", "warn", "error"]).default("log"),
  message: z.string().trim().min(1).max(4_000),
  stack: z.string().max(8_000).nullable().optional(),
  route: z.string().max(400).nullable().optional(),
  statusCode: z.number().int().min(100).max(599).nullable().optional(),
  createdAt: z.string().max(64).optional(),
});

export const previewConsoleBatchSchema = z.object({
  entries: z.array(previewConsoleInputSchema).min(1).max(60),
});

const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsiCodes(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r\n/g, "\n");
}

/**
 * Redacts connection strings, API keys, bearer tokens, and project secret values
 * before persisting or returning console and server logs.
 */
export function redactConsoleSecrets(value: string, secretValues: readonly string[] = []): string {
  if (!value) return "";
  let scrubbed = stripAnsiCodes(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, "postgresql://[REDACTED]")
    .replace(/\bbk_[A-Za-z0-9_-]{12,}\b/g, "bk_[REDACTED]")
    .replace(/\bre_[A-Za-z0-9_-]{12,}\b/g, "re_[REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{12,}\b/g, "AKIA[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]");

  for (const secret of secretValues) {
    const trimmed = secret?.trim();
    if (trimmed && trimmed.length >= 6) {
      scrubbed = scrubbed.replaceAll(trimmed, "[REDACTED]");
    }
  }
  return scrubbed;
}

/**
 * Produces a stable fingerprint for deduplicating repeated console errors and tracking
 * dismissed or fixed error alerts across re-renders.
 */
export function computeConsoleFingerprint(input: {
  source: PreviewConsoleSource;
  level: PreviewConsoleLevel;
  message: string;
  statusCode?: number | null;
}): string {
  const firstLine = stripAnsiCodes(input.message)
    .split("\n")[0]
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/[^\s/]+/g, "<origin>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<uuid>")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/g, "<iso>")
    .replace(/\bin\s+\d+(?:\.\d+)?\s*(?:ms|s)\b/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 220);

  return `${input.source}:${input.level}:${input.statusCode ?? ""}:${firstLine}`;
}

const BENIGN_NOISE_PATTERNS = [
  /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /webpack-hmr/i,
  /favicon\.ico.*404/i,
  /\/sw\.js.*404/i,
  /\.well-known\/appspecific/i,
  /AbortError:\s*The user aborted a request/i,
  /NEXT_REDIRECT/i,
  /NEXT_NOT_FOUND/i,
  // Next.js startup `- Experiments (use with caution): ⨯ webpackBuildWorker` disabled flag bullets
  /^(?:⨯\s*)?[a-z][a-zA-Z0-9_]*$/,
];

/**
 * Filters out harmless browser/HMR/redirect noise and Next.js startup experiment-flag bullets
 * so auto-error detection only surfaces genuine application bugs.
 */
export function isIgnorableConsoleError(input: Pick<PreviewConsoleInput, "message" | "route" | "statusCode">): boolean {
  const trimmedMsg = input.message.trim();
  const text = `${input.route ?? ""} ${trimmedMsg}`.trim();
  if (BENIGN_NOISE_PATTERNS.some((pattern) => pattern.test(trimmedMsg) || pattern.test(text))) return true;
  if (input.statusCode === 404 && (input.route === "/favicon.ico" || input.route === "/sw.js")) return true;
  return false;
}

/**
 * Matches genuine Node.js, Next.js, Drizzle/PostgreSQL, and Better Auth error headlines in sandbox stdout/stderr.
 * Intentionally excludes bare Next.js startup experiment bullets like `  ⨯ webpackBuildWorker`.
 */
const SERVER_ERROR_START = new RegExp(
  [
    // Standard JS / Node / DB / Auth Error classes (with optional leading `⨯ ` or `[`)
    "^(?:⨯\\s+)?\\[?(?:[A-Z][A-Za-z0-9_]*(?:Error|Exception)|Error)\\b\\]?\\s*:",
    // Uncaught / unhandled runtime headers
    "^(?:⨯\\s+)?(?:Unhandled Runtime Error|unhandledRejection:|Uncaught Exception:)",
    // Next.js / Turbopack / Webpack compilation & module resolution failures
    "^(?:⨯\\s+)?(?:Failed to compile|Module not found:|Syntax error:|Transform failed\\b|Build Error\\b|Invalid src prop\\b)",
    // File-path compile error lines from Next.js (`⨯ ./src/app/page.tsx:12:4`)
    "^⨯\\s+\\.?\\/[^\\s:]+\\.(?:[cm]?[jt]sx?|css|json)",
    // PostgreSQL / pg driver lower-case `error:` lines and Better Auth logger errors
    "^(?:⨯\\s+)?(?:error:\\s+(?:relation|column|syntax|invalid|duplicate|null value|insert|update|delete|password|database|role|permission|deadlock|could not)\\b|ERROR\\s*\\[Better Auth\\])",
  ].join("|"),
  "i",
);

const SERVER_HTTP_500_LINE =
  /^\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]*)\s+(5\d\d)\s+in\s+\d+/;

const SERVER_AUTH_ERROR_LINE =
  /^\s*(GET|POST)\s+(\/api\/auth\/[^\s]*)\s+(403|5\d\d)\s+in\s+\d+/;

/**
 * Scans sandbox dev-server logs (`npm run dev` output) for genuine runtime exceptions,
 * compilation failures, database errors, and HTTP 5xx responses.
 */
export function extractServerErrorsFromLog(rawLog: string, secretValues: readonly string[] = []): PreviewConsoleInput[] {
  const clean = redactConsoleSecrets(rawLog, secretValues);
  if (!clean.trim()) return [];

  const lines = clean.split("\n");
  const extracted: PreviewConsoleInput[] = [];
  const seen = new Set<string>();
  let inExperimentsList = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      inExperimentsList = false;
      continue;
    }

    // Skip Next.js startup `- Experiments (use with caution):` flag list (`✓ ...` / `⨯ webpackBuildWorker`)
    if (/^-\s*Experiments\b/i.test(line)) {
      inExperimentsList = true;
      continue;
    }
    if (inExperimentsList) {
      if (/^[✓⨯·•-]\s+[A-Za-z0-9_.-]+$/.test(line)) {
        continue;
      }
      inExperimentsList = false;
    }

    const http500 = rawLine.match(SERVER_HTTP_500_LINE) ?? rawLine.match(SERVER_AUTH_ERROR_LINE);
    if (http500) {
      const [, method, rawRoute, codeStr] = http500;
      const route = rawRoute.split("?")[0].slice(0, 300);
      const statusCode = Number(codeStr);
      if (isIgnorableConsoleError({ message: line, route, statusCode })) continue;
      const contextLines: string[] = [];
      for (let lookback = Math.max(0, index - 8); lookback < Math.min(lines.length, index + 6); lookback += 1) {
        if (lookback === index) continue;
        const candidate = lines[lookback].trim();
        if (
          candidate &&
          !/^\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+\s+[23]\d\d\b/.test(lines[lookback]) &&
          !/^(?:▲\s+Next\.js|-\s+(?:Local|Network|Environments|Experiments)|[✓⨯]\s+[A-Za-z0-9_.-]+$)/.test(candidate)
        ) {
          contextLines.push(lines[lookback]);
        }
      }
      const entry: PreviewConsoleInput = {
        source: "server",
        level: "error",
        message: `${method} ${route} returned HTTP ${statusCode}`,
        stack: contextLines.length ? contextLines.join("\n").slice(0, 4_000) : null,
        route,
        statusCode,
      };
      const fp = computeConsoleFingerprint(entry);
      if (!seen.has(fp)) {
        seen.add(fp);
        extracted.push(entry);
      }
      continue;
    }

    if (SERVER_ERROR_START.test(line)) {
      const cleanedHeadline = line.replace(/^⨯\s+/, "").trim();
      if (isIgnorableConsoleError({ message: cleanedHeadline })) continue;
      const block: string[] = [cleanedHeadline];
      let cursor = index + 1;
      while (cursor < lines.length && block.length < 18) {
        const nextLine = lines[cursor];
        const trimmedNext = nextLine.trim();
        if (!trimmedNext) {
          cursor += 1;
          break;
        }
        if (/^(?:✓\s+Ready|○\s+Compiling|✓\s+Compiled|\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+\s+\d{3}\b)/.test(nextLine)) {
          break;
        }
        block.push(nextLine);
        cursor += 1;
      }
      index = Math.max(index, cursor - 1);

      const headline = block[0].slice(0, 600);
      const stack = block.length > 1 ? block.slice(1).join("\n").slice(0, 4_000) : null;
      const routeMatch = block.join("\n").match(/(?:app|src\/app)(\/[^\s:()]+?)\/(?:page|route|layout)\.[jt]sx?/);
      const route = routeMatch ? routeMatch[1] || "/" : null;

      const entry: PreviewConsoleInput = {
        source: "server",
        level: "error",
        message: headline,
        stack,
        route,
        statusCode: null,
      };
      const fp = computeConsoleFingerprint(entry);
      if (!seen.has(fp)) {
        seen.add(fp);
        extracted.push(entry);
      }
    }
  }

  return extracted.slice(-25);
}

/**
 * Deduplicates unresolved error entries in chronological order (keeping latest details + total count)
 * for auto-error banners and AI fix prompts.
 */
export function selectActionableConsoleErrors(
  entries: readonly PreviewConsoleEntry[],
  options?: { afterIso?: string | null; dismissedFingerprints?: ReadonlySet<string> },
): PreviewConsoleEntry[] {
  const afterIso = options?.afterIso ?? null;
  const dismissed = options?.dismissedFingerprints;
  const byFingerprint = new Map<string, PreviewConsoleEntry>();

  for (const entry of entries) {
    if (entry.level !== "error") continue;
    if (afterIso && entry.createdAt < afterIso) continue;
    if (isIgnorableConsoleError(entry)) continue;
    if (dismissed?.has(entry.fingerprint)) continue;

    const existing = byFingerprint.get(entry.fingerprint);
    if (existing) {
      byFingerprint.set(entry.fingerprint, {
        ...entry,
        repeatCount: existing.repeatCount + entry.repeatCount,
      });
    } else {
      byFingerprint.set(entry.fingerprint, entry);
    }
  }

  return [...byFingerprint.values()];
}

/**
 * Builds a structured, high-signal diagnostic prompt sent to the build agent when the user clicks "Fix error".
 */
export function buildConsoleFixPrompt(
  errors: readonly Pick<
    PreviewConsoleEntry,
    "source" | "level" | "message" | "stack" | "route" | "statusCode" | "repeatCount"
  >[],
  attemptCount = 1,
): string {
  const unique = errors.slice(-5);
  const formattedBlocks = unique.map((err, idx) => {
    const sourceLabel =
      err.source === "network"
        ? "API / Network"
        : err.source === "server"
          ? "Sandbox server"
          : "Browser runtime";
    const meta = [
      sourceLabel,
      err.route ? `route: ${err.route}` : null,
      err.statusCode ? `HTTP ${err.statusCode}` : null,
      err.repeatCount > 1 ? `${err.repeatCount} occurrences` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const stackSnippet = err.stack ? `\n\`\`\`text\n${err.stack.trim().slice(0, 1_400)}\n\`\`\`` : "";
    return `${idx + 1}. **[${meta}]** ${err.message.trim().slice(0, 800)}${stackSnippet}`;
  });

  const retryGuidance =
    attemptCount >= 2
      ? "\n\nNote: A previous fix attempt did not clear this runtime error. Do not repeat the same surface patch—call `read_preview_console` to inspect the latest live sandbox server and browser logs, trace the full request/data flow end to end (including environment variables, database schema/tables, auth configuration, and API route handlers), and fix the underlying root cause."
      : "";

  return [
    `Fix ${unique.length === 1 ? "this runtime error" : "these runtime errors"} detected in the running sandbox & preview:`,
    "",
    ...formattedBlocks,
    "",
    `Inspect the relevant source files and call \`read_preview_console\` for full sandbox server logs. Fix the root cause cleanly, verify any affected database tables or API routes, run the full production build (\`npm run build\`), and confirm the live preview renders and responds without errors.${retryGuidance}`,
  ].join("\n");
}
