import type { ProjectFile, PublishCheckIssue, PublishCheckReport, PublishCheckSeverity } from "./types";

const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/i;
const PAGE_OR_LAYOUT_RE = /(?:^|\/)(?:src\/)?app\/(?:layout|page)\.[jt]sx?$/i;
const API_ROUTE_RE = /(?:^|\/)(?:src\/)?app\/api\/(.+)\/route\.[jt]s$/i;

const SECRET_VALUE_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{24,}\b/, label: "Hardcoded API secret key (`sk-...`)" },
  { regex: /\bre_[A-Za-z0-9_]{20,}\b/, label: "Hardcoded Resend API key (`re_...`)" },
  { regex: /\bpostgres(?:ql)?:\/\/[^/\s"']+:[^@\s"']+@[^/\s"']+/, label: "Hardcoded PostgreSQL connection string" },
  { regex: /\bgh[pousr]_[A-Za-z0-9]{24,}\b/, label: "Hardcoded GitHub token" },
  { regex: /\bAKIA[0-9A-Z]{16}\b/, label: "Hardcoded AWS access key ID" },
];

function lineOfIndex(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function severityWeight(severity: PublishCheckSeverity): number {
  if (severity === "critical") return 25;
  if (severity === "warning") return 8;
  return 2;
}

/**
 * Runs deterministic pre-publish Security & SEO checks across a project's saved source files.
 * Never includes decrypted secret values in any returned issue string.
 */
export function runPublishCheck(
  files: ProjectFile[],
  options: { secretValues?: string[] } = {},
): PublishCheckReport {
  const securityIssues: PublishCheckIssue[] = [];
  const seoIssues: PublishCheckIssue[] = [];
  const secretValues = (options.secretValues ?? []).filter((val) => val.trim().length >= 8);

  const textFiles = files.filter((file) => typeof file.content === "string");
  const hasAuthSetup = textFiles.some(
    (file) =>
      /(?:^|\/)lib\/auth\.[jt]s$/i.test(file.path) ||
      (SOURCE_FILE_RE.test(file.path) && /\bbetterAuth\s*\(/.test(file.content ?? "")),
  );

  let hasMetadata = false;
  let hasDescriptionMetadata = false;
  let hasOpenGraph = false;
  let hasBoilerplateTitle = false;
  let boilerplateFile: string | undefined;
  let hasRobots = false;
  let hasSitemap = false;
  let missingAltReported = 0;

  for (const file of textFiles) {
    const content = file.content ?? "";
    const path = file.path.replaceAll("\\", "/");

    if (/^(?:public\/robots\.txt|(?:src\/)?app\/robots\.[jt]s)$/i.test(path)) hasRobots = true;
    if (/^(?:public\/sitemap\.xml|(?:src\/)?app\/sitemap\.[jt]s)$/i.test(path)) hasSitemap = true;
    if (/(?:^|\/)opengraph-image\.(?:png|jpg|jpeg|tsx|jsx|ts|js)$/i.test(path)) hasOpenGraph = true;

    if (!SOURCE_FILE_RE.test(path)) continue;
    if (path === "public/__cognix_visual_edit.js") continue;

    // 1. Check if any actual project secret value is hardcoded in source code
    for (const secretVal of secretValues) {
      const idx = content.indexOf(secretVal);
      if (idx >= 0) {
        securityIssues.push({
          id: `hardcoded-project-secret:${path}`,
          category: "security",
          severity: "critical",
          title: "Project secret value hardcoded in source",
          detail: `A configured project secret appears as a literal value in \`${path}\`.`,
          file: path,
          line: lineOfIndex(content, idx),
          fixHint: `Remove the literal secret from \`${path}\` and read it on the server via \`process.env\`.`,
        });
        break;
      }
    }

    // 2. Check common hardcoded credential patterns
    for (const pattern of SECRET_VALUE_PATTERNS) {
      const match = pattern.regex.exec(content);
      if (match && match.index !== undefined) {
        securityIssues.push({
          id: `credential-pattern:${path}:${pattern.label}`,
          category: "security",
          severity: "critical",
          title: pattern.label,
          detail: `Found what looks like a live credential in \`${path}\`.`,
          file: path,
          line: lineOfIndex(content, match.index),
          fixHint: `Move credentials to **Cloud → Secrets** and reference \`process.env\` from a server-only module.`,
        });
      }
    }

    // 3. Check NEXT_PUBLIC_* secret exposure
    const publicSecretMatch = /\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE|DATABASE_URL|RESEND_API_KEY|SERVICE_ROLE)[A-Z0-9_]*\b/.exec(
      content,
    );
    if (publicSecretMatch && publicSecretMatch.index !== undefined) {
      securityIssues.push({
        id: `next-public-secret:${path}:${publicSecretMatch[0]}`,
        category: "security",
        severity: "critical",
        title: `Server secret exposed via \`${publicSecretMatch[0]}\``,
        detail: `Variables prefixed with \`NEXT_PUBLIC_\` are bundled into browser JavaScript.`,
        file: path,
        line: lineOfIndex(content, publicSecretMatch.index),
        fixHint: `Rename \`${publicSecretMatch[0]}\` without \`NEXT_PUBLIC_\` and keep all calls inside server routes or server actions.`,
      });
    }

    // 4. Check mutating API routes for session/auth & input validation
    const apiMatch = API_ROUTE_RE.exec(path);
    if (apiMatch && !apiMatch[1].startsWith("auth/")) {
      const mutatingExport = /\bexport\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.exec(content);
      if (mutatingExport && mutatingExport.index !== undefined) {
        if (hasAuthSetup && !/\b(?:getSession|auth\.api|authorization|x-webhook|svix)/i.test(content)) {
          securityIssues.push({
            id: `unauthenticated-api:${path}`,
            category: "security",
            severity: "warning",
            title: `Mutating API route \`${mutatingExport[1]} /api/${apiMatch[1]}\` has no visible session check`,
            detail: `Authentication is configured in this app, but \`${path}\` does not appear to verify \`auth.api.getSession\`.`,
            file: path,
            line: lineOfIndex(content, mutatingExport.index),
            fixHint: `Verify \`await auth.api.getSession({ headers: await headers() })\` in \`${path}\` unless this endpoint is intentionally public.`,
          });
        }
        if (/\.json\s*\(\s*\)/.test(content) && !/\b(?:z\.|zod|\.parse\s*\(|\.safeParse\s*\()/.test(content)) {
          securityIssues.push({
            id: `unvalidated-json:${path}`,
            category: "security",
            severity: "info",
            title: `Request body in \`/api/${apiMatch[1]}\` is parsed without Zod validation`,
            detail: `\`request.json()\` is read without schema validation in \`${path}\`.`,
            file: path,
            line: lineOfIndex(content, mutatingExport.index),
            fixHint: `Validate incoming JSON payloads in \`${path}\` with \`zod\` before writing to the database or external APIs.`,
          });
        }
      }
    }

    // 5. Raw dangerouslySetInnerHTML warning
    const dangerousMatch = /\bdangerouslySetInnerHTML\b/.exec(content);
    if (dangerousMatch && dangerousMatch.index !== undefined) {
      securityIssues.push({
        id: `dangerously-set-html:${path}`,
        category: "security",
        severity: "warning",
        title: `\`dangerouslySetInnerHTML\` used in \`${path}\``,
        detail: `Rendering unescaped HTML can cause XSS if user-controlled text reaches it.`,
        file: path,
        line: lineOfIndex(content, dangerousMatch.index),
        fixHint: `Ensure HTML passed to \`dangerouslySetInnerHTML\` in \`${path}\` is strictly static or sanitized.`,
      });
    }

    // 6. SEO checks on layouts & pages
    if (PAGE_OR_LAYOUT_RE.test(path)) {
      if (/\b(?:export\s+const\s+metadata|export\s+async\s+function\s+generateMetadata)\b/.test(content)) {
        hasMetadata = true;
        if (/\bdescription\s*:/.test(content)) hasDescriptionMetadata = true;
        if (/\bopenGraph\s*:/.test(content)) hasOpenGraph = true;
      }
      if (/Create Next App/i.test(content)) {
        hasBoilerplateTitle = true;
        boilerplateFile = path;
      }
    }

    // 7. Accessibility / SEO image alt check
    if (missingAltReported < 3 && /\.[jt]sx$/i.test(path)) {
      const imgRegex = /<img\b(?![^>]*\balt=)[^>]*>/g;
      const imgMatch = imgRegex.exec(content);
      if (imgMatch && imgMatch.index !== undefined) {
        missingAltReported += 1;
        seoIssues.push({
          id: `img-missing-alt:${path}`,
          category: "seo",
          severity: "info",
          title: `\`<img>\` element missing \`alt\` attribute in \`${path}\``,
          detail: `Descriptive \`alt\` text improves screen-reader accessibility and image search indexing.`,
          file: path,
          line: lineOfIndex(content, imgMatch.index),
          fixHint: `Add meaningful \`alt\` text (or \`alt=""\` for decorative images) in \`${path}\`.`,
        });
      }
    }
  }

  if (textFiles.length > 0) {
    if (!hasMetadata || !hasDescriptionMetadata) {
      seoIssues.push({
        id: "seo-missing-metadata",
        category: "seo",
        severity: "warning",
        title: "Page title or meta description is incomplete",
        detail: "Search engines and link previews rely on Next.js `metadata` (`title` + `description`) in `app/layout.tsx`.",
        file: "app/layout.tsx",
        fixHint: "Export `metadata` with a clear `title`, `description`, and `openGraph` object in `app/layout.tsx`.",
      });
    }
    if (hasBoilerplateTitle) {
      seoIssues.push({
        id: "seo-boilerplate-title",
        category: "seo",
        severity: "warning",
        title: 'Default "Create Next App" metadata is still present',
        detail: `Found starter placeholder metadata in \`${boilerplateFile ?? "app/layout.tsx"}\`.`,
        file: boilerplateFile ?? "app/layout.tsx",
        fixHint: `Replace "Create Next App" in \`${boilerplateFile ?? "app/layout.tsx"}\` with this app's real name and summary.`,
      });
    }
    if (!hasOpenGraph) {
      seoIssues.push({
        id: "seo-missing-opengraph",
        category: "seo",
        severity: "info",
        title: "No OpenGraph social share metadata detected",
        detail: "Sharing your published URL on X, Slack, Discord, or WhatsApp works best with `metadata.openGraph`.",
        file: "app/layout.tsx",
        fixHint: "Add `openGraph: { title, description, type: \"website\" }` (and `twitter: { card: \"summary_large_image\" }`) to `metadata` in `app/layout.tsx`.",
      });
    }
    if (!hasRobots || !hasSitemap) {
      const missing = [!hasRobots ? "`app/robots.ts`" : null, !hasSitemap ? "`app/sitemap.ts`" : null]
        .filter(Boolean)
        .join(" and ");
      seoIssues.push({
        id: "seo-missing-crawlers",
        category: "seo",
        severity: "info",
        title: `Missing ${!hasRobots && !hasSitemap ? "robots.txt and sitemap.xml" : !hasRobots ? "robots.txt" : "sitemap.xml"}`,
        detail: `Adding ${missing} helps search engines and AI crawlers discover public routes cleanly.`,
        fixHint: `Create Next.js App Router ${missing} routes for search indexing.`,
      });
    }
  }

  const allIssues = [...securityIssues, ...seoIssues];
  const penalty = allIssues.reduce((sum, issue) => sum + severityWeight(issue.severity), 0);
  const score = textFiles.length === 0 ? 100 : Math.max(0, 100 - penalty);
  const hasCritical = securityIssues.some((issue) => issue.severity === "critical");

  return {
    score,
    readyToPublish: !hasCritical,
    checkedFileCount: textFiles.length,
    checkedAt: new Date().toISOString(),
    securityIssues,
    seoIssues,
  };
}
