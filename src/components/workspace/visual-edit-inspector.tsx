"use client";

import { Check, MousePointer2, Palette, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import type { ThemeToken } from "@/lib/direct-visual-edit";
import type { ProjectFile, VisualElementSelection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { visualSelectionLabel } from "@/lib/visual-edit";

type InspectorTab = "element" | "theme";

const FONT_SIZE_PRESETS = ["", "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl"] as const;
const FONT_WEIGHT_PRESETS = ["", "font-normal", "font-medium", "font-semibold", "font-bold"] as const;
const RADIUS_PRESETS = ["", "rounded-none", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-full"] as const;
const PADDING_PRESETS = ["", "p-0", "p-1", "p-2", "p-3", "p-4", "p-6", "p-8"] as const;

function swapTailwindGroup(classes: string, groupValues: readonly string[], next: string): string {
  const tokens = classes.split(/\s+/).filter(Boolean);
  const groupSet = new Set(groupValues.filter(Boolean));
  const filtered = tokens.filter((token) => !groupSet.has(token));
  if (next) filtered.push(next);
  return filtered.join(" ");
}

function findActivePreset(classes: string, groupValues: readonly string[]): string {
  const tokens = new Set(classes.split(/\s+/).filter(Boolean));
  for (const candidate of groupValues) {
    if (candidate && tokens.has(candidate)) return candidate;
  }
  return "";
}

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function normalizeSixHex(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return "#000000";
}

type VisualEditInspectorProps = {
  projectId: string;
  selections: VisualElementSelection[];
  onPreviewElement: (selector: string, patch: { text?: string; className?: string }) => void;
  onPreviewTheme: (tokens: ThemeToken[]) => void;
  onFileSaved: (file: ProjectFile) => void;
  onAskAiInstead: (prompt: string) => void;
  onClose: () => void;
};

export function VisualEditInspector({
  projectId,
  selections,
  onPreviewElement,
  onPreviewTheme,
  onFileSaved,
  onAskAiInstead,
  onClose,
}: VisualEditInspectorProps) {
  const primary = selections[0] ?? null;
  const [tab, setTab] = useState<InspectorTab>("element");
  const [draftKey, setDraftKey] = useState("");
  const [textValue, setTextValue] = useState("");
  const [classValue, setClassValue] = useState("");
  const [savingElement, setSavingElement] = useState(false);
  const [fallbackHint, setFallbackHint] = useState<string | null>(null);

  const [themePath, setThemePath] = useState<string | null>(null);
  const [themeTokens, setThemeTokens] = useState<ThemeToken[]>([]);
  const [initialThemeTokens, setInitialThemeTokens] = useState<ThemeToken[]>([]);
  const [loadingTheme, setLoadingTheme] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);

  // Sync draft fields whenever a different preview element is selected (React state-from-props pattern).
  const selectionKey = primary ? `${primary.id}::${primary.text ?? ""}::${primary.attributes.class ?? ""}` : "";
  if (selectionKey !== draftKey) {
    setDraftKey(selectionKey);
    setTextValue(primary?.text ?? "");
    setClassValue(primary?.attributes.class ?? "");
    setFallbackHint(null);
  }

  const loadTheme = useCallback(async () => {
    setLoadingTheme(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/visual-edit/theme`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not inspect theme tokens.");
      const loaded = Array.isArray(payload.tokens) ? (payload.tokens as ThemeToken[]) : [];
      setThemePath(typeof payload.path === "string" ? payload.path : null);
      setThemeTokens(loaded);
      setInitialThemeTokens(loaded);
    } catch {
      setThemePath(null);
      setThemeTokens([]);
    } finally {
      setLoadingTheme(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (tab !== "theme") return;
    let active = true;
    fetch(`/api/projects/${projectId}/visual-edit/theme`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!active) return;
        const loaded = Array.isArray(payload.tokens) ? (payload.tokens as ThemeToken[]) : [];
        setThemePath(typeof payload.path === "string" ? payload.path : null);
        setThemeTokens(loaded);
        setInitialThemeTokens(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId, tab]);

  function updateElementText(next: string) {
    setTextValue(next);
    setFallbackHint(null);
    if (primary) onPreviewElement(primary.selector, { text: next, className: classValue });
  }

  function updateElementClasses(next: string) {
    setClassValue(next);
    setFallbackHint(null);
    if (primary) onPreviewElement(primary.selector, { text: textValue, className: next });
  }

  function resetElementDraft() {
    if (!primary) return;
    const origText = primary.text ?? "";
    const origClass = primary.attributes.class ?? "";
    setTextValue(origText);
    setClassValue(origClass);
    setFallbackHint(null);
    onPreviewElement(primary.selector, { text: origText, className: origClass });
  }

  async function saveDirectElementEdit() {
    if (!primary || savingElement) return;
    setSavingElement(true);
    setFallbackHint(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/visual-edit/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: primary,
          nextText: textValue,
          nextClassName: classValue,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.updated) {
        setFallbackHint(payload.reason ?? payload.error ?? "Could not patch this JSX element directly.");
        return;
      }
      if (payload.file) onFileSaved(payload.file as ProjectFile);
      toast.success(`Saved directly to ${payload.path} (0 tokens).`);
    } catch (error) {
      setFallbackHint(error instanceof Error ? error.message : "Could not save visual edit.");
    } finally {
      setSavingElement(false);
    }
  }

  function updateTokenValue(index: number, nextVal: string) {
    const updated = themeTokens.map((token, idx) => (idx === index ? { ...token, value: nextVal } : token));
    setThemeTokens(updated);
    onPreviewTheme(updated);
  }

  function resetThemeDraft() {
    setThemeTokens(initialThemeTokens);
    onPreviewTheme([]);
  }

  async function saveThemeTokens() {
    if (!themeTokens.length || savingTheme) return;
    setSavingTheme(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/visual-edit/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: themeTokens }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save theme variables.");
      if (payload.file) onFileSaved(payload.file as ProjectFile);
      if (Array.isArray(payload.tokens)) {
        setThemeTokens(payload.tokens as ThemeToken[]);
        setInitialThemeTokens(payload.tokens as ThemeToken[]);
      }
      onPreviewTheme([]);
      toast.success(`Saved theme variables to ${payload.path ?? "globals.css"} (0 tokens).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save theme variables.");
    } finally {
      setSavingTheme(false);
    }
  }

  const elementChanged =
    Boolean(primary) &&
    (textValue.trim() !== (primary?.text?.trim() ?? "") ||
      classValue.trim() !== (primary?.attributes.class?.trim() ?? ""));

  const themeChanged = JSON.stringify(themeTokens) !== JSON.stringify(initialThemeTokens);
  const sourceLocation = primary?.componentStack?.find((item) => item.source?.file)?.source;

  return (
    <div className="mb-2 rounded-xl border border-white/[0.12] bg-[#1a1a1a] p-3 text-[12px] text-white shadow-[0_10px_28px_rgba(0,0,0,.35)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] pb-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="Direct visual editor">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "element"}
            onClick={() => setTab("element")}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 [@media(pointer:coarse)]:h-10",
              tab === "element" ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
            )}
          >
            <MousePointer2 className="size-3.5" aria-hidden="true" />
            Element
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "theme"}
            onClick={() => {
              setTab("theme");
              if (!themeTokens.length && !loadingTheme) void loadTheme();
            }}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 [@media(pointer:coarse)]:h-10",
              tab === "theme" ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
            )}
          >
            <Palette className="size-3.5" aria-hidden="true" />
            Theme
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close visual editor"
          title="Close visual editor"
          className="grid size-8 place-items-center rounded-md text-white/50 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {tab === "element" ? (
        !primary ? (
          <p className="py-4 text-center text-[12px] text-white/50">
            Click any element in the live preview to edit its text or Tailwind styles directly with zero tokens.
          </p>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="truncate font-medium text-white/85">
                {visualSelectionLabel(primary)}{" "}
                <code className="ml-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/55">
                  &lt;{primary.tagName}&gt;
                </code>
              </span>
              {sourceLocation ? (
                <code className="truncate font-mono text-[11px] text-white/40">
                  {sourceLocation.file}
                  {sourceLocation.line ? `:${sourceLocation.line}` : ""}
                </code>
              ) : null}
            </div>

            {primary.text !== undefined ? (
              <div>
                <label className="block text-[11px] font-medium text-white/55">
                  Text copy
                  <input
                    type="text"
                    value={textValue}
                    onChange={(event) => updateElementText(event.target.value)}
                    placeholder="Element text"
                    className="mt-1 h-8 w-full rounded-lg border border-white/[0.12] bg-[#111111] px-2.5 text-[12.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
                  />
                </label>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <label className="text-[11px] text-white/50">
                Size
                <select
                  value={findActivePreset(classValue, FONT_SIZE_PRESETS)}
                  onChange={(e) => updateElementClasses(swapTailwindGroup(classValue, FONT_SIZE_PRESETS, e.target.value))}
                  className="mt-0.5 h-8 w-full rounded-md border border-white/[0.1] bg-[#111111] px-1.5 text-[11.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-10"
                >
                  <option value="">Auto</option>
                  {FONT_SIZE_PRESETS.filter(Boolean).map((item) => (
                    <option key={item} value={item}>{item.replace("text-", "")}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-white/50">
                Weight
                <select
                  value={findActivePreset(classValue, FONT_WEIGHT_PRESETS)}
                  onChange={(e) => updateElementClasses(swapTailwindGroup(classValue, FONT_WEIGHT_PRESETS, e.target.value))}
                  className="mt-0.5 h-8 w-full rounded-md border border-white/[0.1] bg-[#111111] px-1.5 text-[11.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-10"
                >
                  <option value="">Auto</option>
                  {FONT_WEIGHT_PRESETS.filter(Boolean).map((item) => (
                    <option key={item} value={item}>{item.replace("font-", "")}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-white/50">
                Corners
                <select
                  value={findActivePreset(classValue, RADIUS_PRESETS)}
                  onChange={(e) => updateElementClasses(swapTailwindGroup(classValue, RADIUS_PRESETS, e.target.value))}
                  className="mt-0.5 h-8 w-full rounded-md border border-white/[0.1] bg-[#111111] px-1.5 text-[11.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-10"
                >
                  <option value="">Auto</option>
                  {RADIUS_PRESETS.filter(Boolean).map((item) => (
                    <option key={item} value={item}>{item.replace("rounded-", "")}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-white/50">
                Padding
                <select
                  value={findActivePreset(classValue, PADDING_PRESETS)}
                  onChange={(e) => updateElementClasses(swapTailwindGroup(classValue, PADDING_PRESETS, e.target.value))}
                  className="mt-0.5 h-8 w-full rounded-md border border-white/[0.1] bg-[#111111] px-1.5 text-[11.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-10"
                >
                  <option value="">Auto</option>
                  {PADDING_PRESETS.filter(Boolean).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-white/55">
                Tailwind classes
                <input
                  type="text"
                  value={classValue}
                  onChange={(event) => updateElementClasses(event.target.value)}
                  placeholder="e.g. text-lg font-semibold text-white bg-zinc-900 px-4 py-2 rounded-lg"
                  spellCheck={false}
                  className="mt-1 h-8 w-full rounded-lg border border-white/[0.12] bg-[#111111] px-2.5 font-mono text-[11.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
                />
              </label>
            </div>

            {fallbackHint ? (
              <div role="alert" className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-2.5 text-[11.5px] leading-4 text-amber-200/90">
                <p>{fallbackHint}</p>
                <button
                  type="button"
                  onClick={() => {
                    const parts: string[] = [];
                    if (textValue.trim() !== (primary.text?.trim() ?? "")) {
                      parts.push(`change its text to "${textValue.trim()}"`);
                    }
                    if (classValue.trim() !== (primary.attributes.class?.trim() ?? "")) {
                      parts.push(`update its Tailwind classes to \`${classValue.trim()}\``);
                    }
                    onAskAiInstead(`For the selected <${primary.tagName}> element, ${parts.join(" and ")}.`);
                  }}
                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-2.5 text-[11.5px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-10"
                >
                  <Sparkles className="size-3" aria-hidden="true" />
                  Apply with AI
                </button>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={!elementChanged || savingElement}
                onClick={resetElementDraft}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-white/65 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:h-11"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                Reset
              </button>
              <button
                type="button"
                disabled={!elementChanged || savingElement}
                onClick={() => void saveDirectElementEdit()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
              >
                {savingElement ? <PixelLoader /> : <Wand2 className="size-3.5" aria-hidden="true" />}
                {savingElement ? "Saving…" : "Save directly"}
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {loadingTheme ? (
            <div className="flex items-center justify-center gap-2 py-6 text-white/55">
              <PixelLoader /> <span>Reading theme variables…</span>
            </div>
          ) : themeTokens.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-white/50">
              No CSS custom properties (`--background`, `--primary`, `--radius`) were found in `globals.css` yet.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-white/45">
                Editing <code className="font-mono text-white/70">{themePath}</code> · previews live in iframe
              </p>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {themeTokens.map((token, index) => (
                  <div key={`${token.scope}:${token.name}`} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate font-mono text-[11px] text-white/70" title={`${token.name} (${token.scope})`}>
                      {token.name}
                    </span>
                    {isHexColor(token.value) ? (
                      <input
                        type="color"
                        aria-label={`Color picker for ${token.name}`}
                        value={normalizeSixHex(token.value)}
                        onChange={(event) => updateTokenValue(index, event.target.value)}
                        className="size-7 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent p-0.5"
                      />
                    ) : null}
                    <input
                      type="text"
                      aria-label={`CSS value for ${token.name}`}
                      value={token.value}
                      onChange={(event) => updateTokenValue(index, event.target.value)}
                      spellCheck={false}
                      className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.1] bg-[#111111] px-2 font-mono text-[11.5px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-10"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={!themeChanged || savingTheme}
                  onClick={resetThemeDraft}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-white/65 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Reset
                </button>
                <button
                  type="button"
                  disabled={!themeChanged || savingTheme}
                  onClick={() => void saveThemeTokens()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
                >
                  {savingTheme ? <PixelLoader /> : <Check className="size-3.5" aria-hidden="true" />}
                  {savingTheme ? "Saving…" : "Save theme"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
