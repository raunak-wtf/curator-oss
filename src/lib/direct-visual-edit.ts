import type { ProjectFile, VisualElementSelection } from "./types";

export type ThemeToken = {
  name: string;
  value: string;
  scope: "root" | "dark" | "theme";
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeJsxText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function pickClosestMatch(
  source: string,
  regex: RegExp,
  targetLine?: number,
): { index: number; fullMatch: string; groups: string[] } | null {
  const matches: { index: number; fullMatch: string; groups: string[]; distance: number }[] = [];
  const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  for (const match of source.matchAll(globalRegex)) {
    if (match.index === undefined) continue;
    const line = lineNumberAt(source, match.index);
    const distance = targetLine ? Math.abs(line - targetLine) : 0;
    matches.push({
      index: match.index,
      fullMatch: match[0],
      groups: match.slice(1),
      distance,
    });
  }
  if (!matches.length) return null;
  if (!targetLine && matches.length > 1) return null;
  matches.sort((a, b) => a.distance - b.distance);
  return matches[0];
}

export function candidateSourcePathsForSelection(
  selection: VisualElementSelection,
  files: ProjectFile[],
): { path: string; line?: number }[] {
  const available = new Set(files.map((file) => file.path.replaceAll("\\", "/")));
  const seen = new Set<string>();
  const out: { path: string; line?: number }[] = [];

  const push = (rawPath: string | undefined, line?: number) => {
    if (!rawPath) return;
    const normalized = rawPath.replaceAll("\\", "/").replace(/^\/+/, "");
    const candidates = [normalized, normalized.replace(/^src\//, ""), `src/${normalized}`];
    for (const candidate of candidates) {
      if (available.has(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        out.push({ path: candidate, line });
        return;
      }
    }
  };

  for (const frame of selection.componentStack ?? []) {
    if (frame.source?.file) push(frame.source.file, frame.source.line);
  }

  const routeTrimmed = selection.route.replace(/^\/+|\/+$/g, "");
  if (!routeTrimmed) {
    push("app/page.tsx");
    push("app/page.jsx");
  } else {
    push(`app/${routeTrimmed}/page.tsx`);
    push(`app/${routeTrimmed}/page.jsx`);
  }
  push("app/layout.tsx");
  push("app/layout.jsx");

  for (const file of files) {
    if (/\.[jt]sx$/i.test(file.path) && !seen.has(file.path)) {
      seen.add(file.path);
      out.push({ path: file.path });
    }
  }
  return out;
}

/**
 * Deterministically patches static JSX text and/or Tailwind `className` for a selected preview element
 * without calling an LLM (zero tokens). Returns `{ updated: false }` when the element is dynamically rendered.
 */
export function applyDirectElementPatch(input: {
  selection: VisualElementSelection;
  files: ProjectFile[];
  nextText?: string;
  nextClassName?: string;
}): { updated: true; path: string; before: string; after: string } | { updated: false; reason: string } {
  const { selection, files, nextText, nextClassName } = input;
  const originalText = selection.text?.trim() ?? "";
  const originalClass = selection.attributes.class?.trim() ?? "";
  const wantTextChange = nextText !== undefined && nextText.trim() !== originalText;
  const wantClassChange = nextClassName !== undefined && nextClassName.trim() !== originalClass;

  if (!wantTextChange && !wantClassChange) {
    return { updated: false, reason: "No visual changes were made yet." };
  }

  const fileMap = new Map(files.map((file) => [file.path.replaceAll("\\", "/"), file.content ?? ""]));
  const candidates = candidateSourcePathsForSelection(selection, files);

  for (const candidate of candidates) {
    const before = fileMap.get(candidate.path);
    if (!before) continue;
    let working = before;
    let changedClass = !wantClassChange;
    let changedText = !wantTextChange;

    if (wantClassChange && nextClassName !== undefined) {
      const cleanNextClass = nextClassName.trim().replaceAll('"', "'");
      if (originalClass) {
        const classPattern = new RegExp(`(className\\s*=\\s*)(["'])${escapeRegExp(originalClass)}\\2`);
        const hit = pickClosestMatch(working, classPattern, candidate.line);
        if (hit) {
          const quote = hit.groups[1] || '"';
          const replacement = `${hit.groups[0]}${quote}${cleanNextClass}${quote}`;
          working = working.slice(0, hit.index) + replacement + working.slice(hit.index + hit.fullMatch.length);
          changedClass = true;
        }
      } else if (originalText) {
        const tag = escapeRegExp(selection.tagName);
        const tagNoClassPattern = new RegExp(
          `(<${tag}\\b(?![^>]*\\bclassName=))([^>]*>\\s*${escapeRegExp(originalText)}\\s*</${tag}>)`,
        );
        const hit = pickClosestMatch(working, tagNoClassPattern, candidate.line);
        if (hit) {
          const replacement = `${hit.groups[0]} className="${cleanNextClass}"${hit.groups[1]}`;
          working = working.slice(0, hit.index) + replacement + working.slice(hit.index + hit.fullMatch.length);
          changedClass = true;
        }
      }
    }

    if (wantTextChange && nextText !== undefined && originalText) {
      const escapedNext = escapeJsxText(nextText);
      const tag = escapeRegExp(selection.tagName);
      const exactTagTextPattern = new RegExp(
        `(<${tag}\\b[^>]*>\\s*)${escapeRegExp(originalText)}(\\s*</${tag}>)`,
      );
      let hit = pickClosestMatch(working, exactTagTextPattern, candidate.line);
      if (!hit) {
        const genericJsxTextPattern = new RegExp(`(>\\s*)${escapeRegExp(originalText)}(\\s*<)`);
        hit = pickClosestMatch(working, genericJsxTextPattern, candidate.line);
      }
      if (hit) {
        const replacement = `${hit.groups[0]}${escapedNext}${hit.groups[1]}`;
        working = working.slice(0, hit.index) + replacement + working.slice(hit.index + hit.fullMatch.length);
        changedText = true;
      }
    }

    if (changedClass && changedText && working !== before) {
      return { updated: true, path: candidate.path, before, after: working };
    }
  }

  return {
    updated: false,
    reason:
      "This element's text or classes come from dynamic JSX props/state rather than a static literal. Click “Apply with AI” to update its component logic.",
  };
}

const CSS_CANDIDATE_PATHS = [
  "app/globals.css",
  "src/app/globals.css",
  "styles/globals.css",
  "src/styles/globals.css",
] as const;

export function findThemeStylesheet(files: ProjectFile[]): { path: string; content: string } | null {
  for (const candidate of CSS_CANDIDATE_PATHS) {
    const found = files.find((file) => file.path.replaceAll("\\", "/") === candidate && typeof file.content === "string");
    if (found && found.content !== null) return { path: found.path, content: found.content };
  }
  const anyCss = files.find((file) => file.path.endsWith(".css") && typeof file.content === "string");
  return anyCss && anyCss.content !== null ? { path: anyCss.path, content: anyCss.content } : null;
}

export function extractThemeTokens(cssContent: string): ThemeToken[] {
  const tokens: ThemeToken[] = [];
  const blockRegex = /(:root|\.dark|@theme(?:\s+inline)?)\s*\{([\s\S]*?)\}/g;
  for (const block of cssContent.matchAll(blockRegex)) {
    const selector = block[1];
    const scope: ThemeToken["scope"] = selector.startsWith(".dark")
      ? "dark"
      : selector.startsWith("@theme")
        ? "theme"
        : "root";
    const body = block[2];
    for (const decl of body.matchAll(/(--[a-zA-Z0-9-_]+)\s*:\s*([^;{}\r\n]+);/g)) {
      const name = decl[1].trim();
      const value = decl[2].trim();
      if (value.startsWith("var(")) continue;
      tokens.push({ name, value, scope });
    }
  }
  return tokens.slice(0, 40);
}

export function updateThemeTokensInCss(
  cssContent: string,
  updates: { name: string; value: string; scope?: ThemeToken["scope"] }[],
): string {
  let next = cssContent;
  for (const update of updates) {
    if (!/^--[a-zA-Z0-9-_]+$/.test(update.name)) continue;
    const cleanValue = update.value.replace(/[;{}<>]/g, "").trim().slice(0, 120);
    if (!cleanValue) continue;
    const declRegex = new RegExp(`(${escapeRegExp(update.name)}\\s*:\\s*)([^;{}\r\n]+)(;)`);
    if (declRegex.test(next)) {
      next = next.replace(declRegex, `$1${cleanValue}$3`);
    }
  }
  return next;
}
