import OpenAI from "openai";
import { isReservedPublishSlug } from "@/lib/domains";
import { publishSlugFromTitle } from "@/lib/utils";
import { isRetryableModelError } from "./model-stream";

const NAME_GEN_TIMEOUT_MS = 7_500;
const NAME_GEN_RETRY_DELAY_MS = 350;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

const LEADING_COMMAND_WORDS = new Set([
  "build",
  "create",
  "make",
  "design",
  "develop",
  "generate",
  "write",
  "code",
  "implement",
  "scaffold",
  "clone",
  "craft",
  "launch",
  "setup",
  "please",
  "hey",
  "hi",
  "can",
  "you",
  "help",
  "me",
  "i",
  "want",
  "need",
  "to",
  "a",
  "an",
  "the",
  "my",
  "our",
  "new",
  "modern",
  "simple",
  "clean",
  "minimal",
  "responsive",
  "fullstack",
  "full",
  "stack",
  "ai",
  "powered",
  "web",
  "app",
  "application",
  "website",
  "site",
  "platform",
  "tool",
  "for",
  "with",
  "using",
  "that",
  "where",
]);

const TRAILING_STOP_WORDS = new Set([
  "with",
  "using",
  "for",
  "that",
  "where",
  "which",
  "and",
  "or",
  "in",
  "on",
  "to",
  "by",
  "from",
]);

const KNOWN_ACRONYMS = new Set([
  "AI",
  "API",
  "B2B",
  "B2C",
  "CMS",
  "CRM",
  "CSS",
  "DAO",
  "DNS",
  "ERP",
  "ETL",
  "FAQ",
  "GPS",
  "HR",
  "IDE",
  "IOT",
  "KPI",
  "LMS",
  "MDX",
  "MVP",
  "NFT",
  "OCR",
  "OKR",
  "ORM",
  "PDF",
  "POS",
  "PR",
  "QA",
  "QR",
  "ROI",
  "RSS",
  "SDK",
  "SEO",
  "SLA",
  "SMS",
  "SQL",
  "SSH",
  "SSO",
  "SVG",
  "TMS",
  "UI",
  "URL",
  "UX",
  "VIP",
  "VPN",
  "WMS",
]);

export const PROJECT_NAME_SYSTEM_PROMPT = `You are a brand and product name generator for AI-generated web applications.
Read the user's app prompt inside <user_prompt> tags and output ONE concise, memorable, domain-compatible project name of 2 to 4 words (1 to 4 words when the prompt already names the product).

Rules:
1. Honor explicit names: If the user explicitly names their app or brand in the prompt (for example: Build "Fieldnote Studio" or an app called "Orbit Desk"), return that exact product name cleaned up to 1–4 words.
2. Invent when unnamed: When no name is given, create a distinctive, concrete 2–3 word product name that fits the product's domain and audience (for example: "Harbor Ledger", "Pulse Desk", "Canvas Review", "Slate Notes").
3. Strict domain & DNS compatibility:
   - Use ONLY plain English ASCII letters (A–Z, a–z), digits (0–9), and single spaces between words so the name converts cleanly into a subdomain slug like \`fieldnote-studio\`.
   - Never include quotes, colons, slashes, emojis, Markdown, explanations, or domain extensions (\`.com\`, \`.io\`, \`.app\`, \`.dev\`, \`.ai\`).
   - Never start with prompt verbs or filler words ("Build", "Create", "Make", "Design", "Generate", "Clone", "Full-Stack", "Web App", "Website").
   - Never return a single reserved system word alone ("API", "App", "Apps", "Admin", "Auth", "WWW", "Edge", "Preview", "Staging", "Dashboard", "Cognix", "Curator").
4. Output ONLY the single Title Case project name on one line, with nothing before or after it.`;

export type GeneratedProjectName = {
  /** Clean 1–4 word human-readable title (e.g. "Fieldnote Studio"). */
  title: string;
  /** DNS/subdomain-safe lowercase slug (e.g. "fieldnote-studio"). */
  slug: string;
  /** Whether the title came from the configured LLM or the deterministic fallback. */
  source: "model" | "fallback";
};

/** Resolves the configured project-name model, preferring PROJECT_NAME_GEN_MODEL over OPENAI_MODEL. */
export function resolveProjectNameModel(env: Record<string, string | undefined> = process.env): string | null {
  const dedicated = env.PROJECT_NAME_GEN_MODEL?.trim();
  if (dedicated) return dedicated;
  const fallbackModel = env.OPENAI_MODEL?.trim();
  return fallbackModel || null;
}

export function isProjectNameGeneratorConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim() && resolveProjectNameModel(env));
}

function formatNameWord(word: string): string {
  if (!word) return "";
  const upper = word.toUpperCase();
  if (KNOWN_ACRONYMS.has(upper)) return upper;
  // Preserve intentional mixed-case brand words like "FieldNote", "GitOps", "iCloud"
  if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1))) {
    return word;
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function stripDomainTld(value: string): string {
  return value.replace(/\.(?:com|io|app|dev|ai|co|net|org|xyz|hq|studio|tech|site|codes|in)\b/gi, " ");
}

function ensureUnreservedDomainPair(words: string[]): { title: string; slug: string } {
  let cleanWords = words.slice(0, 4);
  if (cleanWords.length === 0) cleanWords = ["Studio", "Workspace"];

  const rawSlug = cleanWords.join("-").toLowerCase();
  let title = cleanWords.map(formatNameWord).join(" ").slice(0, 40).trim();
  let slug = publishSlugFromTitle(title);

  if (isReservedPublishSlug(rawSlug) || isReservedPublishSlug(slug) || !DNS_LABEL_PATTERN.test(slug)) {
    const suffixed = [...cleanWords.slice(0, 3), "Studio"];
    title = suffixed.map(formatNameWord).join(" ").slice(0, 40).trim();
    slug = publishSlugFromTitle(title);
  }

  return { title, slug };
}

/**
 * Sanitizes raw model output into a clean 1–4 word Title Case name whose slug is
 * guaranteed to be valid for DNS subdomains (`<slug>.<domain>`). Returns null if empty/unusable.
 */
export function sanitizeGeneratedProjectName(raw: string): { title: string; slug: string } | null {
  const withoutReasoning = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .trim();

  // Take the first non-empty line
  const firstLine =
    withoutReasoning
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine) return null;

  const cleaned = stripDomainTld(firstLine)
    .replace(/^(?:project\s+name|app\s+name|name|title|output)\s*[:=-]\s*/i, "")
    .replace(/^["'`*#\-\s]+|["'`*#\-\s.!?]+$/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  let words = cleaned.split(" ").filter(Boolean);
  // Strip accidental leading imperative verbs like "Build ..." if 2+ words remain
  while (words.length > 2 && LEADING_COMMAND_WORDS.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  while (words.length > 1 && TRAILING_STOP_WORDS.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1);
  }

  words = words.slice(0, 4);
  if (words.length === 0) return null;

  const totalLetters = words.join("").replace(/[^a-zA-Z0-9]/g, "");
  if (totalLetters.length < 2) return null;

  return ensureUnreservedDomainPair(words);
}

/** Extracts an explicit quoted brand/app name from the prompt when present (e.g. Build "Fieldnote Studio"). */
export function extractExplicitNameFromPrompt(prompt: string): { title: string; slug: string } | null {
  const withoutSkills = prompt.replace(/(?:^|\s)\/[a-z0-9][a-z0-9-]*(?=\s|$)/gi, " ");
  const patterns = [
    /\b(?:build|create|make|design|develop|called|named|titled)\s+(?:an?\s+(?:app|platform|portal|website|tool|dashboard|workspace)\s+(?:called|named)\s+)?["“]([^"”\r\n]{2,42})["”]/i,
    /^["“]([^"”\r\n]{2,42})["”]\s*[-—:]/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(withoutSkills);
    if (!match?.[1]) continue;
    const candidate = sanitizeGeneratedProjectName(match[1]);
    if (candidate && candidate.title.split(" ").length <= 4) {
      return candidate;
    }
  }
  return null;
}

/** Deterministic 2–4 word domain-compatible fallback when the LLM is unconfigured or unreachable. */
export function fallbackProjectNameFromPrompt(prompt: string): { title: string; slug: string } {
  const explicit = extractExplicitNameFromPrompt(prompt);
  if (explicit) return explicit;

  const firstClause = prompt
    .replace(/(?:^|\s)\/[a-z0-9][a-z0-9-]*(?=\s|$)/gi, " ")
    .split(/[\r\n.!?]/)[0] ?? prompt;

  const tokens = stripDomainTld(firstClause)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/-+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2);

  const meaningful: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (meaningful.length === 0 && LEADING_COMMAND_WORDS.has(lower)) continue;
    if (meaningful.length > 0 && TRAILING_STOP_WORDS.has(lower)) break;
    if (LEADING_COMMAND_WORDS.has(lower) && meaningful.length < 2) continue;
    meaningful.push(token);
    if (meaningful.length >= 3) break;
  }

  if (meaningful.length === 1) {
    meaningful.push("Studio");
  } else if (meaningful.length === 0) {
    meaningful.push("Nova", "Workspace");
  }

  return ensureUnreservedDomainPair(meaningful);
}

/** Builds the user message sent to PROJECT_NAME_GEN_MODEL, escaping closing tags. */
export function buildProjectNameUserMessage(prompt: string): string {
  const cleanPrompt = prompt
    .replace(/(?:^|\s)\/[a-z0-9][a-z0-9-]*(?=\s|$)/gi, " ")
    .trim()
    .slice(0, 3_000)
    .replaceAll("</user_prompt>", "<\\/user_prompt>");
  return `Generate a single 2-4 word domain-compatible project name.\n\n<user_prompt>\n${cleanPrompt}\n</user_prompt>`;
}

/**
 * Generates a concise 2–4 word domain-compatible project name + slug using `PROJECT_NAME_GEN_MODEL`
 * (or `OPENAI_MODEL` if `PROJECT_NAME_GEN_MODEL` is unset), falling back deterministically on error.
 */
export async function generateProjectName(
  prompt: string,
  options?: {
    env?: Record<string, string | undefined>;
    createCompletion?: (args: {
      model: string;
      system: string;
      user: string;
      signal: AbortSignal;
    }) => Promise<string>;
  },
): Promise<GeneratedProjectName> {
  const env = options?.env ?? process.env;
  const model = resolveProjectNameModel(env);
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!model || (!apiKey && !options?.createCompletion)) {
    return { ...fallbackProjectNameFromPrompt(prompt), source: "fallback" };
  }

  const runCompletion =
    options?.createCompletion ??
    (async ({ model: targetModel, system, user, signal }) => {
      const client = new OpenAI({
        apiKey,
        baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
        defaultHeaders: { "User-Agent": "Cognix/1.0" },
        maxRetries: 0,
        timeout: NAME_GEN_TIMEOUT_MS,
      });
      const response = await client.chat.completions.create(
        {
          model: targetModel,
          temperature: 0.3,
          max_tokens: 32,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { signal },
      );
      return response.choices[0]?.message?.content ?? "";
    });

  const userMessage = buildProjectNameUserMessage(prompt);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await runCompletion({
        model,
        system: PROJECT_NAME_SYSTEM_PROMPT,
        user: userMessage,
        signal: AbortSignal.timeout(NAME_GEN_TIMEOUT_MS),
      });
      const sanitized = sanitizeGeneratedProjectName(raw);
      if (sanitized) {
        return { ...sanitized, source: "model" };
      }
      break;
    } catch (error) {
      if (attempt >= 2 || !isRetryableModelError(error)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, NAME_GEN_RETRY_DELAY_MS));
    }
  }

  return { ...fallbackProjectNameFromPrompt(prompt), source: "fallback" };
}
