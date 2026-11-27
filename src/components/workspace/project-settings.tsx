"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { RemixDialog } from "@/components/remix-dialog";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

type Setting = "showBadge" | "publicRemix";

/** Project settings: name, the "Edit with Curator" badge, sharing for remixes, and remixing. */
export function ProjectSettings({ project, onProjectChange }: { project: Project; onProjectChange: (project: Project) => void }) {
  const [title, setTitle] = useState(project.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [instructions, setInstructions] = useState(project.customInstructions ?? "");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [saving, setSaving] = useState<Setting | null>(null);
  const [remixOpen, setRemixOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const nameId = useId();
  const instructionsId = useId();
  const remixLink = typeof window === "undefined" ? `/remix/${project.id}` : `${window.location.origin}/remix/${project.id}`;

  async function save(patch: Partial<Pick<Project, "title" | "customInstructions" | Setting>>) {
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Couldn't save the setting. Try again.");
    onProjectChange(payload.project as Project);
  }

  async function toggle(setting: Setting, value: boolean) {
    setSaving(setting);
    try {
      await save({ [setting]: value });
      toast.success(
        setting === "showBadge"
          ? value ? "Badge shown on the published app." : "Badge hidden on the published app."
          : value ? "Public remixing is on." : "Public remixing is off.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || next === project.title || savingTitle) return;
    setSavingTitle(true);
    try {
      await save({ title: next });
      toast.success("Project renamed.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingTitle(false);
    }
  }

  const card = "rounded-lg border border-white/10 bg-white/[0.02] p-4";

  return (
    <section aria-labelledby="project-settings-heading" className="space-y-4">
      <div>
        <h2 id="project-settings-heading" className="text-lg font-semibold tracking-tight text-white">
          Project settings
        </h2>
        <p className="mt-1 text-[13px] text-white/55">How this project appears and who can copy it.</p>
      </div>

      <form onSubmit={(event) => void rename(event)} className={card}>
        <label htmlFor={nameId} className="text-[13px] font-medium text-white">
          Project name
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id={nameId}
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.12] bg-[#101010] px-3 text-[13px] text-white outline-none focus:border-white/35 [@media(pointer:coarse)]:h-11"
          />
          <button
            type="submit"
            disabled={savingTitle || !title.trim() || title.trim() === project.title}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:h-11"
          >
            {savingTitle ? <PixelLoader /> : null} Save
          </button>
        </div>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (savingInstructions || instructions === (project.customInstructions ?? "")) return;
          setSavingInstructions(true);
          void save({ customInstructions: instructions })
            .then(() => toast.success("Project knowledge saved."))
            .catch((error: Error) => toast.error(error.message))
            .finally(() => setSavingInstructions(false));
        }}
        className={card}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor={instructionsId} className="text-[13px] font-medium text-white">
            Project knowledge
          </label>
          <span className="text-[11.5px] tabular-nums text-white/40">
            {instructions.length.toLocaleString()} / 12,000
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-white/50">
          Persistent brand guidelines, UI conventions, domain terminology, or API notes automatically included in every Build and Plan prompt for this project.
        </p>
        <textarea
          id={instructionsId}
          rows={5}
          maxLength={12000}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Example: Target audience is freelance interior designers. Keep tone editorial and concise, use USD currency formatting, and require admin approval on public listings…"
          className="mt-2.5 block w-full resize-y rounded-lg border border-white/[0.12] bg-[#101010] px-3 py-2 text-[13px] leading-5 text-white outline-none placeholder:text-white/30 focus:border-white/35"
        />
        <div className="mt-2.5 flex items-center justify-end gap-2">
          {instructions !== (project.customInstructions ?? "") ? (
            <button
              type="button"
              disabled={savingInstructions}
              onClick={() => setInstructions(project.customInstructions ?? "")}
              className="inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-medium text-white/65 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11"
            >
              Discard
            </button>
          ) : null}
          <button
            type="submit"
            disabled={savingInstructions || instructions === (project.customInstructions ?? "")}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
          >
            {savingInstructions ? <PixelLoader /> : null} Save knowledge
          </button>
        </div>
      </form>

      <div className={card}>
        <Toggle
          label="Show “Edit with Curator” badge"
          description="A small badge in the bottom-right corner of your published app and custom domains. Changes apply right away, without republishing."
          checked={project.showBadge}
          busy={saving === "showBadge"}
          onChange={(value) => void toggle("showBadge", value)}
        />
      </div>

      <div className={card}>
        <Toggle
          label="Public remixing"
          description="Anyone with the remix link can preview the latest version and make their own copy of the code. They never get access to this project, its chat, or its secrets."
          checked={project.publicRemix}
          busy={saving === "publicRemix"}
          onChange={(value) => void toggle("publicRemix", value)}
        />
        {project.publicRemix ? (
          <div className="mt-3 flex h-9 items-center rounded-lg border border-white/[0.12] bg-[#101010] [@media(pointer:coarse)]:h-11">
            <code className="min-w-0 flex-1 truncate px-3 font-mono text-[12px] text-white/75" title={remixLink}>
              {remixLink}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(remixLink);
                setCopied(true);
                toast.success("Remix link copied.");
              }}
              aria-label="Copy remix link"
              className="grid size-8 shrink-0 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
            >
              {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
            </button>
            <a
              href={remixLink}
              target="_blank"
              rel="noreferrer"
              aria-label="Open remix page"
              className="grid size-8 shrink-0 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        ) : null}
        {project.publicRemix && project.showBadge ? (
          <p className="mt-2 text-[11.5px] text-white/40">The badge on your published app links to this remix page.</p>
        ) : null}
      </div>

      <div className={cn(card, "flex flex-wrap items-center justify-between gap-3")}>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white">Remix project</p>
          <p className="mt-0.5 text-[12px] leading-5 text-white/50">Make an independent copy to try a big change safely or start a variation.</p>
        </div>
        <button
          type="button"
          onClick={() => setRemixOpen(true)}
          disabled={!project.sandboxId}
          title={project.sandboxId ? undefined : "Build the project first"}
          className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 disabled:opacity-40 [@media(pointer:coarse)]:h-11"
        >
          <Copy className="size-3.5" aria-hidden="true" /> Remix
        </button>
      </div>

      <RemixDialog open={remixOpen} projectId={project.id} projectTitle={project.title} canIncludeHistory onClose={() => setRemixOpen(false)} />
    </section>
  );
}

function Toggle({
  label,
  description,
  checked,
  busy,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-white">
          {label}
        </label>
        <p id={`${id}-description`} className="mt-0.5 text-[12px] leading-5 text-white/50">
          {description}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-description`}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-12",
          checked ? "bg-emerald-500" : "bg-white/20",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none [@media(pointer:coarse)]:size-6",
            checked ? "translate-x-[18px] [@media(pointer:coarse)]:translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
