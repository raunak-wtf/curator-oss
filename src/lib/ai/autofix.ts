export type AutofixPatch = {
  path: string;
  rule: string;
  description: string;
  before: string;
  after: string;
};

const SUBJECT_MAX = 72;
const MAX_BODY_FILES = 20;

function patch(path: string, rule: string, description: string, before: string, after: string): AutofixPatch {
  return { path, rule, description, before, after };
}

/**
 * `drizzle.config.ts` / `drizzle.config.mjs` read `process.env.DATABASE_URL` (or `DIRECT_URL`)
 * at load time, before Next.js loads `.env.local`, so `drizzle-kit push` sees `undefined`.
 * Prepends a guarded `process.loadEnvFile(".env.local")` when nothing loads env files already.
 */
export function autofixDrizzleConfigEnvLoad(path: string, content: string): AutofixPatch | null {
  if (!/(^|[\\/])drizzle\.config\.(ts|mjs)$/.test(path)) return null;
  if (!/process\.env\.(DATABASE_URL|DIRECT_URL)\b/.test(content)) return null;
  if (/loadEnvFile|dotenv/.test(content)) return null;

  const prefix = `import { existsSync } from "node:fs";\nif (existsSync(".env.local")) process.loadEnvFile(".env.local");\n`;
  return patch(
    path,
    "drizzle-config-env-load",
    "Load .env.local in drizzle.config so DATABASE_URL is defined for drizzle-kit push/generate",
    content,
    prefix + content,
  );
}

const SERVER_ONLY_IMPORT = /^[ \t]*import\s+["']server-only["'];?[ \t]*\r?\n?/m;

/**
 * `import "server-only"` in a `schema.ts` breaks `drizzle-kit push` (which imports the schema
 * outside Next.js runtime) and the schema is safe to import anywhere. Removes only that line.
 */
export function autofixSchemaServerOnlyImport(path: string, content: string): AutofixPatch | null {
  const basename = path.split(/[\\/]/).at(-1);
  if (basename !== "schema.ts") return null;
  if (!content.includes("pgTable(")) return null;
  if (!SERVER_ONLY_IMPORT.test(content)) return null;

  const after = content.replace(SERVER_ONLY_IMPORT, "");
  if (after === content) return null;
  return patch(
    path,
    "schema-server-only-import",
    'Remove "import \\"server-only\\" from schema.ts so drizzle-kit can load the schema',
    content,
    after,
  );
}

const S3_CLIENT_OPEN = /new\s+S3Client\s*\(\s*\{/;

/**
 * MinIO / self-hosted S3 endpoints fail on default AWS SDK checksum behavior
 * (`XmlLengthMismatchError` / unsupported `x-amz-checksum-*` headers). Inserts the
 * `WHEN_REQUIRED` checksum options into the inline `new S3Client({ ... })` options object.
 */
export function autofixS3ClientChecksums(path: string, content: string): AutofixPatch | null {
  if (!/\.tsx?$/.test(path) && !/\.mjs$/.test(path)) return null;
  const open = S3_CLIENT_OPEN.exec(content);
  if (!open) return null;
  const needsPathStyle = /forcePathStyle\s*:\s*true/.test(content) || /process\.env\.S3_ENDPOINT\b/.test(content);
  if (!needsPathStyle) return null;

  const missing: string[] = [];
  if (!/requestChecksumCalculation/.test(content)) missing.push('requestChecksumCalculation: "WHEN_REQUIRED"');
  if (!/responseChecksumValidation/.test(content)) missing.push('responseChecksumValidation: "WHEN_REQUIRED"');
  if (!missing.length) return null;

  const braceIndex = open.index + open[0].length - 1;
  const after = content.slice(0, braceIndex + 1) + " " + missing.join(", ") + "," + content.slice(braceIndex + 1);
  return patch(
    path,
    "s3-client-checksums",
    "Use WHEN_REQUIRED checksum options on the S3 client for path-style/self-hosted endpoints",
    content,
    after,
  );
}

const CLIENT_COMPONENT_ERRORS = [
  "only works in a Client Component",
  "Event handlers cannot be passed to Client Component props",
  "cannot be used in a Server Component",
];

function startsWithDirective(content: string): boolean {
  const trimmed = content.replace(/^#![^\n]*\r?\n/, "").trimStart();
  return /^\s*["'](use client|use server)["']/.test(trimmed);
}

/**
 * A generated `.tsx`/`.jsx` using hooks or event handlers fails the Next.js build when it lacks
 * a directive. Only fires when the build diagnostics explicitly name this file and the error.
 */
export function autofixMissingUseClientDirective(
  path: string,
  content: string,
  diagnosticOutput: string,
): AutofixPatch | null {
  if (!/\.(tsx|jsx)$/.test(path)) return null;
  if (!diagnosticOutput) return null;
  if (!diagnosticOutput.includes(path)) return null;
  if (!CLIENT_COMPONENT_ERRORS.some((message) => diagnosticOutput.includes(message))) return null;
  if (startsWithDirective(content)) return null;

  return patch(
    path,
    "missing-use-client-directive",
    'Prepend "use client" for the component the build reported as needing client-side hooks/handlers',
    content,
    `"use client";\n\n` + content,
  );
}

/** Runs every narrow deterministic autofix rule over the generated files, in a fixed order. */
export function computeSafeAutofixes(
  files: Array<{ path: string; content: string }>,
  diagnosticOutput?: string,
): AutofixPatch[] {
  const patches: AutofixPatch[] = [];
  for (const file of files) {
    const before = [
      autofixSchemaServerOnlyImport(file.path, file.content),
      autofixMissingUseClientDirective(file.path, file.content, diagnosticOutput ?? ""),
      autofixS3ClientChecksums(file.path, file.content),
      autofixDrizzleConfigEnvLoad(file.path, file.content),
    ];
    for (const patchOrNull of before) {
      if (patchOrNull) patches.push(patchOrNull);
    }
  }
  return patches;
}

const FIX_REQUEST = /\b(fix|bug|error|crash|broken|incorrect|failing|issue|exception|undefined)\b/i;
const STYLE_REQUEST = /\b(style|css|spacing|color|colour|font|layout|visual|polish|padding|margin)\b/i;
const CONFIG_PATH = /(^|[\\/])([^\\/]*\.config\.[a-z]+|package(-lock)?\.json|tsconfig\.json|\.env[^\\/]*|pnpm-lock\.yaml|yarn\.lock)$/i;

function firstSentence(request: string): string {
  const collapsed = request.replace(/\s+/g, " ").trim();
  const sentence = collapsed.split(/[.!?](?:\s|$)/)[0];
  return (sentence || collapsed).trim();
}

function subjectTextFromFiles(paths: string[]): string {
  if (!paths.length) return "sync project files";
  const names = paths.slice(0, 2).map((p) => p.split(/[\\/]/).at(-1)).filter(Boolean);
  return `update ${names.join(" and ")}${paths.length > names.length ? ` and ${paths.length - names.length} more` : ""}`;
}

/**
 * Zero-LLM conventional commit message (feat/fix/style/chore inferred from prompt and paths,
 * subject <= 72 chars, file bullet list) so first-preview latency never waits on a model call.
 */
export function buildDeterministicCommitMessage(input: { request: string; changedPaths: string[] }): string {
  const request = input.request.trim();
  const paths = [...new Set(input.changedPaths)];

  const type = FIX_REQUEST.test(request)
    ? "fix"
    : STYLE_REQUEST.test(request)
      ? "style"
      : !request && paths.length > 0 && paths.every((p) => CONFIG_PATH.test(p))
        ? "chore"
        : "feat";

  const rawSubject = (request ? firstSentence(request) : subjectTextFromFiles(paths))
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(new RegExp(`^${type}\\s+`, "i"), "");
  let subject = `${type}: ${rawSubject.charAt(0).toLowerCase()}${rawSubject.slice(1)}`.trim();
  if (subject.length > SUBJECT_MAX) subject = subject.slice(0, SUBJECT_MAX - 1).trimEnd() + "…";

  if (!paths.length) return subject;
  const listed = paths.slice(0, MAX_BODY_FILES);
  const body = listed.map((p) => `- ${p}`).join("\n");
  const rest = paths.length > listed.length ? `\n… and ${paths.length - listed.length} more` : "";
  return `${subject}\n\n${body}${rest}`;
}
