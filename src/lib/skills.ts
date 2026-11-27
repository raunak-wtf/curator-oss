import { z } from "zod";

/** Slash commands that manage skills. Skill names cannot reuse them. */
export const SKILL_COMMANDS = ["create-skill", "install-skill", "new-skill", "skills"] as const;
export type SkillCommand = (typeof SKILL_COMMANDS)[number];

/** Built-in Cognix Cloud slash skills resolved automatically on every prompt. */
export const BUILTIN_SKILL_NAMES = [
  "cloud-fullstack",
  "cloud-database",
  "cloud-auth",
  "cloud-storage",
  "cloud-email",
] as const;

export const SKILL_NAME_MAX = 48;
export const SKILL_DESCRIPTION_MAX = 300;
export const SKILL_BODY_MAX = 20_000;
export const SKILLS_PER_ACCOUNT = 100;
/** Most skills a single prompt can apply, which bounds how much text reaches the agent. */
export const SKILLS_PER_PROMPT = 5;

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export class SkillRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SkillRequestError";
  }
}

export const skillNameSchema = z
  .string()
  .trim()
  .min(1, "Give the skill a name.")
  .max(SKILL_NAME_MAX, `Keep the name under ${SKILL_NAME_MAX} characters.`)
  .regex(SKILL_NAME_PATTERN, "Use lowercase letters, numbers, and single hyphens, like api-docs.")
  .refine((name) => !name.includes("--"), "Use single hyphens between words.")
  .refine((name) => !(SKILL_COMMANDS as readonly string[]).includes(name), "That name is a built-in / command. Choose another.")
  .refine((name) => !(BUILTIN_SKILL_NAMES as readonly string[]).includes(name), "That name is reserved for a built-in Cognix Cloud skill. Choose another.");

export const skillFieldsSchema = z.object({
  name: skillNameSchema,
  description: z
    .string()
    .trim()
    .min(1, "Describe when the AI should use this skill.")
    .max(SKILL_DESCRIPTION_MAX, `Keep the description under ${SKILL_DESCRIPTION_MAX} characters.`),
  body: z
    .string()
    .trim()
    .min(1, "Write the instructions the AI should follow.")
    .max(SKILL_BODY_MAX, `Keep the instructions under ${SKILL_BODY_MAX.toLocaleString("en-US")} characters.`),
});

export type SkillFields = z.infer<typeof skillFieldsSchema>;

/** Turns free text such as a title or folder name into a valid skill name. */
export function normalizeSkillName(value: string) {
  const name = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/g, "");
  const reserved = new Set<string>([...SKILL_COMMANDS, ...BUILTIN_SKILL_NAMES]);
  return reserved.has(name) ? `${name}-custom` : name;
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(["']).*\1$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

/** Reads the simple YAML frontmatter used by SKILL.md files: single-line, quoted, and folded (`>` or `|`) values. */
function parseFrontmatter(source: string) {
  const values: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, key, rest] = match;
    if (/^[>|][-+]?$/.test(rest.trim())) {
      const block: string[] = [];
      while (index + 1 < lines.length && (/^\s+\S/.test(lines[index + 1]) || lines[index + 1].trim() === "")) {
        index += 1;
        block.push(lines[index].trim());
      }
      values[key.toLowerCase()] = rest.trim().startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n").trim();
    } else {
      values[key.toLowerCase()] = unquote(rest);
    }
  }
  return values;
}

function firstParagraph(body: string) {
  const line = body
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#") && !item.startsWith("```") && !item.startsWith("---"));
  return line?.replace(/[*_`]/g, "").slice(0, SKILL_DESCRIPTION_MAX) ?? "";
}

/**
 * Parses SKILL.md text into editable fields. Missing values fall back to the provided name and
 * the first paragraph, so the person reviewing the draft can fix them before saving.
 */
export function parseSkillMarkdown(raw: string, fallbackName = "") {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const meta = match ? parseFrontmatter(match[1]) : {};
  const body = (match ? text.slice(match[0].length) : text).trim();
  const heading = /^#\s+(.+)$/m.exec(body)?.[1] ?? "";
  return {
    name: normalizeSkillName(meta.name || fallbackName || heading),
    description: (meta.description || firstParagraph(body)).slice(0, SKILL_DESCRIPTION_MAX),
    body,
  };
}

/** Removes a single wrapping Markdown code fence that models sometimes add around a file. */
export function stripCodeFence(value: string) {
  const match = /^\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(value);
  return match ? match[1] : value;
}

/** Skill names a prompt invokes with `/name`, excluding the built-in commands. */
export function skillReferences(prompt: string) {
  const names = new Set<string>();
  for (const match of prompt.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]{0,47})(?=$|[\s.,;:!?)])/g)) {
    if (!(SKILL_COMMANDS as readonly string[]).includes(match[1])) names.add(match[1]);
  }
  return [...names];
}

/** Splits `/command argument` text. Returns null when the text is not one of the skill commands. */
export function parseSkillCommand(text: string): { command: SkillCommand; argument: string } | null {
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match || !(SKILL_COMMANDS as readonly string[]).includes(match[1])) return null;
  return { command: match[1] as SkillCommand, argument: (match[2] ?? "").trim() };
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const RAW_HOST = "raw.githubusercontent.com";
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Converts a GitHub repository, folder, or file URL into the raw URL of its SKILL.md.
 * Only GitHub hosts are accepted. Folder and repository URLs resolve to their SKILL.md.
 */
export function githubSkillSource(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SkillRequestError("Paste a full GitHub link, like https://github.com/owner/repo/tree/main/skills/my-skill.");
  }
  if (url.protocol !== "https:") throw new SkillRequestError("Use an https:// GitHub link.");
  const host = url.hostname.toLowerCase();
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    parts = ["%"];
  }
  if (parts.some((part) => part === ".." || part === "." || !SEGMENT.test(part))) {
    throw new SkillRequestError("That GitHub link contains characters Cognix cannot read. Copy the link from the address bar.");
  }

  let owner: string;
  let repo: string;
  let ref: string;
  let path: string[];
  if (host === RAW_HOST) {
    if (parts.length < 4) throw new SkillRequestError("That raw GitHub link does not point to a file.");
    [owner, repo, ref, ...path] = parts;
  } else if (GITHUB_HOSTS.has(host)) {
    if (parts.length < 2) throw new SkillRequestError("Link to a GitHub repository, folder, or SKILL.md file.");
    [owner, repo] = parts;
    repo = repo.replace(/\.git$/, "");
    const kind = parts[2];
    if (!kind) {
      ref = "HEAD";
      path = [];
    } else if ((kind === "blob" || kind === "tree") && parts[3]) {
      ref = parts[3];
      path = parts.slice(4);
    } else {
      throw new SkillRequestError("Link to a GitHub repository, folder, or SKILL.md file.");
    }
  } else {
    throw new SkillRequestError("Only GitHub links are supported. Paste a github.com or raw.githubusercontent.com URL.");
  }

  const last = path.at(-1) ?? "";
  if (!/\.(md|markdown|txt)$/i.test(last)) path = [...path, "SKILL.md"];
  const fileName = path.at(-1) ?? "SKILL.md";
  const folder = path.length > 1 ? path.at(-2) : repo;
  const fallbackName = /^skill\.md$/i.test(fileName) || /^readme\.md$/i.test(fileName) ? folder ?? repo : fileName.replace(/\.[^.]+$/, "");

  const rawPath = [owner, repo, ref, ...path].map(encodeURIComponent).join("/");
  return {
    rawUrl: `https://${RAW_HOST}/${rawPath}`,
    sourceUrl: `https://github.com/${owner}/${repo}/blob/${[ref, ...path].map(encodeURIComponent).join("/")}`,
    fallbackName: fallbackName ?? repo,
  };
}
