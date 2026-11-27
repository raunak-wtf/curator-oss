"use client";

import { ExternalLink, X } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import { useEffect, useId, useRef, useState } from "react";
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, skillFieldsSchema } from "@/lib/skills";
import type { Skill, SkillDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SkillApiError, skillApi, type FieldErrors } from "./skill-api";

export type SkillEditorState = {
  /** Changes whenever a new draft is loaded so the form resets to it. */
  key: number;
  skillId: string | null;
  status: "loading" | "ready" | "error";
  loadingLabel?: string;
  error?: string;
  retry?: () => void;
  draft: SkillDraft;
};

type SkillEditorDialogProps = {
  state: SkillEditorState | null;
  onClose: () => void;
  onSaved: (skill: Skill, created: boolean) => void;
  onWriteManually: () => void;
};

function headingFor(state: SkillEditorState) {
  if (state.skillId) return `Edit /${state.draft.name}`;
  if (state.draft.source === "ai") return state.status === "ready" ? "Review AI-written skill" : "Create a skill with AI";
  if (state.draft.source === "github") return state.status === "ready" ? "Review skill from GitHub" : "Install a skill from GitHub";
  return "Write a skill";
}

export function SkillEditorDialog({ state, onClose, onSaved, onWriteManually }: SkillEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state && !dialog.open) dialog.showModal();
    if (!state && dialog.open) dialog.close();
  }, [state]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-xl border border-white/10 bg-[#212121] p-0 text-white shadow-2xl backdrop:bg-black/60"
    >
      {state ? (
        <div className="flex max-h-[calc(100dvh-34px)] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] py-2 pl-5 pr-2">
            <h2 id={titleId} className="truncate text-[15px] font-semibold">
              {headingFor(state)}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-50 [@media(pointer:coarse)]:size-11"
            >
              <X className="size-4" />
            </button>
          </header>

          {state.status === "loading" ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center" role="status">
              <PixelLoader size="lg" className="text-white/60" />
              <p className="text-[13px] text-white/70">{state.loadingLabel ?? "Working…"}</p>
              <button type="button" onClick={onClose} className="mt-1 h-8 rounded-lg px-3 text-[13px] font-medium text-white/70 hover:bg-white/[0.07] hover:text-white">
                Cancel
              </button>
            </div>
          ) : state.status === "error" ? (
            <div className="px-5 py-6">
              <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] leading-5 text-red-300">
                {state.error}
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={onWriteManually} className="h-8 rounded-lg px-3 text-[13px] font-medium text-white/75 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:h-11">
                  Write it yourself
                </button>
                {state.retry ? (
                  <button type="button" onClick={state.retry} className="h-8 rounded-lg bg-white px-3 text-[13px] font-semibold text-black hover:bg-white/85 [@media(pointer:coarse)]:h-11">
                    Try again
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <SkillForm
              key={state.key}
              state={state}
              onCancel={onClose}
              onSavingChange={setSaving}
              onSaved={onSaved}
            />
          )}
        </div>
      ) : null}
    </dialog>
  );
}

type SkillFormProps = {
  state: SkillEditorState;
  onCancel: () => void;
  onSavingChange: (saving: boolean) => void;
  onSaved: (skill: Skill, created: boolean) => void;
};

function SkillForm({ state, onCancel, onSavingChange, onSaved }: SkillFormProps) {
  const [name, setName] = useState(state.draft.name);
  const [description, setDescription] = useState(state.draft.description);
  const [body, setBody] = useState(state.draft.body);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { name: useId(), description: useId(), body: useId() };
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const imported = !state.skillId && state.draft.source !== "manual";

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const parsed = skillFieldsSchema.safeParse({ name, description, body });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({ name: fieldErrors.name?.[0], description: fieldErrors.description?.[0], body: fieldErrors.body?.[0] });
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    onSavingChange(true);
    try {
      const skill = state.skillId
        ? await skillApi.update(state.skillId, parsed.data)
        : await skillApi.create({ ...state.draft, ...parsed.data });
      onSaved(skill, !state.skillId);
    } catch (error) {
      if (error instanceof SkillApiError && Object.keys(error.fieldErrors).length) setErrors(error.fieldErrors);
      else if (error instanceof SkillApiError && /named \//.test(error.message)) setErrors({ name: error.message });
      else setFormError(error instanceof Error ? error.message : "Could not save the skill. Try again.");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  const input =
    "w-full rounded-lg border bg-[#191919] px-3 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-white/35";
  const borderFor = (field: keyof FieldErrors) => (errors[field] ? "border-red-400/60" : "border-white/[0.12]");

  return (
    <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {imported ? (
          <p className="rounded-lg bg-white/[0.05] px-3 py-2 text-[12px] leading-5 text-white/60">
            Review this skill before saving. Its instructions are sent to the AI every time you use it.
            {state.draft.sourceUrl ? (
              <>
                {" "}
                <a href={state.draft.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-white/80 hover:text-white">
                  View source <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </>
            ) : null}
          </p>
        ) : null}

        <div>
          <label htmlFor={ids.name} className="text-[12px] font-medium text-white/75">
            Name
          </label>
          <div className={cn("mt-1.5 flex h-9 items-center rounded-lg border bg-[#191919] focus-within:border-white/35 [@media(pointer:coarse)]:h-11", borderFor("name"))}>
            <span className="pl-3 font-mono text-[13px] text-white/40" aria-hidden="true">
              /
            </span>
            <input
              ref={firstFieldRef}
              id={ids.name}
              value={name}
              maxLength={SKILL_NAME_MAX}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={`${ids.name}-hint`}
              placeholder="api-conventions"
              className="h-full min-w-0 flex-1 bg-transparent pl-0.5 pr-3 font-mono text-[13px] text-white outline-none placeholder:text-white/30 [&:focus-visible]:outline-none"
            />
          </div>
          <p id={`${ids.name}-hint`} className={cn("mt-1 text-[11.5px]", errors.name ? "text-red-300" : "text-white/40")}>
            {errors.name ?? "Type this after / in a prompt to use the skill."}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={ids.description} className="text-[12px] font-medium text-white/75">
              Description
            </label>
            <span className="text-[11px] text-white/35 tabular-nums">
              {description.length}/{SKILL_DESCRIPTION_MAX}
            </span>
          </div>
          <input
            id={ids.description}
            value={description}
            maxLength={SKILL_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? `${ids.description}-error` : undefined}
            placeholder="What the skill does and when to use it"
            className={cn(input, "mt-1.5 h-9 [@media(pointer:coarse)]:h-11", borderFor("description"))}
          />
          {errors.description ? (
            <p id={`${ids.description}-error`} className="mt-1 text-[11.5px] text-red-300">
              {errors.description}
            </p>
          ) : null}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={ids.body} className="text-[12px] font-medium text-white/75">
              Instructions
            </label>
            <span className="text-[11px] text-white/35 tabular-nums">
              {body.length.toLocaleString("en-US")}/{SKILL_BODY_MAX.toLocaleString("en-US")}
            </span>
          </div>
          <textarea
            id={ids.body}
            value={body}
            maxLength={SKILL_BODY_MAX}
            rows={14}
            spellCheck={false}
            onChange={(event) => setBody(event.target.value)}
            aria-invalid={Boolean(errors.body)}
            aria-describedby={`${ids.body}-hint`}
            placeholder={"# Skill title\n\nTell the AI what to do, step by step. Markdown works."}
            className={cn(input, "mt-1.5 resize-y py-2 font-mono leading-5", borderFor("body"))}
          />
          <p id={`${ids.body}-hint`} className={cn("mt-1 text-[11.5px]", errors.body ? "text-red-300" : "text-white/40")}>
            {errors.body ?? "Markdown. Write it as directions to the AI, like a SKILL.md file."}
          </p>
        </div>

        {formError ? (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-300">
            {formError}
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-lg px-3 text-[13px] font-medium text-white/75 hover:bg-white/[0.07] hover:text-white disabled:opacity-50 [@media(pointer:coarse)]:h-11"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-lg bg-white px-3 text-[13px] font-semibold text-black hover:bg-white/85 disabled:opacity-60 [@media(pointer:coarse)]:h-11"
        >
          {saving ? "Saving…" : state.skillId ? "Save changes" : "Save skill"}
        </button>
      </footer>
    </form>
  );
}
