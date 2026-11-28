export type ParsedDiagnostic = {
  category: "typescript" | "nextjs" | "dependency" | "drizzle" | "runtime";
  code: string;
  filePath?: string;
  line?: number;
  message: string;
  suggestedFix: string;
};

const TS_PATTERNS: Array<{ regex: RegExp; build: (match: RegExpExecArray) => ParsedDiagnostic | null }> = [
  {
    regex: /^(.+?)\((\d+),(\d+)\):\s*error (TS\d+):\s*(.+)$/,
    build: (match) => ({
      category: "typescript",
      code: match[4],
      filePath: match[1],
      line: Number(match[2]),
      message: match[5],
      suggestedFix: `Fix TypeScript ${match[4]} in ${match[1]}:${match[2]} — ${match[5]}`,
    }),
  },
  {
    regex: /^(.+?):(\d+):(\d+)\s*-\s*error (TS\d+):\s*(.+)$/,
    build: (match) => ({
      category: "typescript",
      code: match[4],
      filePath: match[1],
      line: Number(match[2]),
      message: match[5],
      suggestedFix: `Fix TypeScript ${match[4]} in ${match[1]}:${match[2]} — ${match[5]}`,
    }),
  },
];

const NEXTJS_PATTERNS: Array<{ regex: RegExp; build: (match: RegExpExecArray) => ParsedDiagnostic | null }> = [
  {
    regex: /You're importing a component that needs (\w+)[^\n]*?["']([^"']+)["']/,
    build: (match) => ({
      category: "nextjs",
      code: "client-boundary",
      filePath: match[2],
      message: `Component needs ${match[1]}; add "use client" or move it behind a client boundary`,
      suggestedFix: `Add "use client" at the top of ${match[2]} (or wrap it in a client component) and keep server-only imports out of it.`,
    }),
  },
  {
    regex: /You're importing a component that needs ([^\s.]+)/,
    build: (match) => ({
      category: "nextjs",
      code: "client-boundary",
      message: `Component needs ${match[1]}; add "use client"`,
      suggestedFix: `Add "use client" at the top of the importing client component file.`,
    }),
  },
  {
    regex: /Dynamic server usage[^\n]*?["']([^"']+)["']/,
    build: (match) => ({
      category: "nextjs",
      code: "dynamic-server-usage",
      filePath: match[1],
      message: "Route opted into dynamic rendering during static generation",
      suggestedFix: `Add export const dynamic = "force-dynamic" to ${match[1]} (or remove the dynamic data access from prerender).`,
    }),
  },
  {
    regex: /Module not found: Can't resolve ['"]([^'"]+)['"]/,
    build: (match) => ({
      category: "nextjs",
      code: "module-not-found",
      message: `Module not found: Can't resolve '${match[1]}'`,
      suggestedFix: `Install the '${match[1]}' package or fix the import path.`,
    }),
  },
  {
    regex: /Invalid src prop \(([^)]+)\) (?:on `next\/image`|detected on `?next\/image`?)/,
    build: (match) => ({
      category: "nextjs",
      code: "invalid-image-src",
      message: `Invalid src prop (${match[1]}) on next/image`,
      suggestedFix: `Use an absolute URL or a static import for next/image (hostname must be configured in next.config).`,
    }),
  },
  {
    regex: /Invalid src prop \(([^)]+)\)/,
    build: (match) => ({
      category: "nextjs",
      code: "invalid-image-src",
      message: `Invalid src prop (${match[1]}) on next/image`,
      suggestedFix: `Use an absolute URL or a static import for next/image.`,
    }),
  },
];

const DEPENDENCY_PATTERNS: Array<{ regex: RegExp; build: (match: RegExpExecArray) => ParsedDiagnostic | null }> = [
  {
    regex: /(ERESOLVE)[^\n]*?while resolving ([^\s]+)/,
    build: (match) => ({
      category: "dependency",
      code: match[1],
      message: `Peer dependency conflict while resolving ${match[2]}`,
      suggestedFix: "Install with --legacy-peer-deps or align the conflicting package versions.",
    }),
  },
  {
    regex: /ERESOLVE[^\n]*/,
    build: (match) => ({
      category: "dependency",
      code: "ERESOLVE",
      message: match[0].slice(0, 200),
      suggestedFix: "Install with --legacy-peer-deps or align the conflicting package versions.",
    }),
  },
  {
    regex: /(ETARGET)[^\n]*?No matching version found for ([^\s.]+)/,
    build: (match) => ({
      category: "dependency",
      code: match[1],
      message: `No matching version found for ${match[2]}`,
      suggestedFix: `Pin a valid published version of ${match[2]} in package.json.`,
    }),
  },
  {
    regex: /(ETARGET)[^\n]*/,
    build: (match) => ({
      category: "dependency",
      code: match[1],
      message: match[0].slice(0, 200),
      suggestedFix: "Pin a valid published version in package.json.",
    }),
  },
  {
    regex: /(ERR_PNPM[A-Z_]*)[^\n]*/,
    build: (match) => ({
      category: "dependency",
      code: match[1],
      message: match[0].slice(0, 200),
      suggestedFix: "Fix the pnpm install error (clean lockfile or adjust the offending dependency spec).",
    }),
  },
];

const DRIZZLE_PATTERNS: Array<{ regex: RegExp; build: (match: RegExpExecArray) => ParsedDiagnostic | null }> = [
  {
    regex: /(drizzle\.config)[^\n]*/,
    build: (match) => ({
      category: "drizzle",
      code: "drizzle-config",
      message: match[0].slice(0, 200),
      suggestedFix: "Fix drizzle.config.ts (check dialect, schema path, and credentials).",
    }),
  },
  {
    regex: /(?:module ['"]server-only['"]|["']server-only['"])/,
    build: () => ({
      category: "drizzle",
      code: "server-only",
      message: "Server-only module imported from client code",
      suggestedFix: "Move the database access into a server-only file (e.g. a route handler or a file guarded by server-only).",
    }),
  },
  {
    regex: /relation ['"]([^'"]+)['"] does not exist/,
    build: (match) => ({
      category: "drizzle",
      code: "relation-missing",
      message: `relation "${match[1]}" does not exist`,
      suggestedFix: `Run the generated migration (or create the "${match[1]}" table) before querying it.`,
    }),
  },
];

const RUNTIME_PATTERNS: Array<{ regex: RegExp; build: (match: RegExpExecArray) => ParsedDiagnostic | null }> = [
  {
    regex: /(SyntaxError): ([^\n]+)/,
    build: (match) => ({
      category: "runtime",
      code: match[1],
      message: match[2],
      suggestedFix: "Fix the reported syntax error at its source location.",
    }),
  },
  {
    regex: /(TypeError): ([^\n]+)/,
    build: (match) => ({
      category: "runtime",
      code: match[1],
      message: match[2],
      suggestedFix: "Guard the failing value (null/undefined access) or fix the expected type.",
    }),
  },
  {
    regex: /(ReferenceError): ([^\n]+)/,
    build: (match) => ({
      category: "runtime",
      code: match[1],
      message: match[2],
      suggestedFix: "Define the referenced variable before it is used.",
    }),
  },
];

const PATTERN_GROUPS = [
  ...TS_PATTERNS,
  ...NEXTJS_PATTERNS,
  ...DEPENDENCY_PATTERNS,
  ...DRIZZLE_PATTERNS,
  ...RUNTIME_PATTERNS,
];

function diagnosticKey(diagnostic: ParsedDiagnostic): string {
  return `${diagnostic.category}:${diagnostic.code}:${diagnostic.filePath ?? ""}:${diagnostic.line ?? ""}`;
}

export function parseBuildDiagnostics(output: string, maxItems = 12): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  const seen = new Set<string>();

  for (const line of output.split("\n")) {
    for (const pattern of PATTERN_GROUPS) {
      const match = pattern.regex.exec(line);
      if (!match) {
        continue;
      }
      const diagnostic = pattern.build(match);
      if (!diagnostic) {
        continue;
      }
      const key = diagnosticKey(diagnostic);
      if (seen.has(key)) {
        break;
      }
      seen.add(key);
      diagnostics.push(diagnostic);
      break;
    }
    if (diagnostics.length >= maxItems) {
      break;
    }
  }

  return diagnostics.slice(0, maxItems);
}
