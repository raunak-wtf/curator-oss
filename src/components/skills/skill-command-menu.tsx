"use client";

import { BookOpen, GitBranch, PencilLine, Sparkles, Wand2 } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import type { ComponentType } from "react";
import type { SkillCommand } from "@/lib/skills";
import type { Skill } from "@/lib/types";
import { cn } from "@/lib/utils";

export type SlashMenuItem =
  | { kind: "command"; name: SkillCommand; description: string; argumentHint?: string }
  | { kind: "skill"; name: string; description: string; skill: Skill };

export const COMMAND_ITEMS: Extract<SlashMenuItem, { kind: "command" }>[] = [
  { kind: "command", name: "create-skill", description: "Ask AI to write a skill", argumentHint: "what it should do" },
  { kind: "command", name: "install-skill", description: "Install a skill from GitHub", argumentHint: "GitHub link" },
  { kind: "command", name: "new-skill", description: "Write a skill yourself" },
  { kind: "command", name: "skills", description: "Manage your skills" },
];

const commandIcons: Record<SkillCommand, ComponentType<{ className?: string }>> = {
  "create-skill": Wand2,
  "install-skill": GitBranch,
  "new-skill": PencilLine,
  skills: BookOpen,
};

type SkillCommandMenuProps = {
  id: string;
  items: SlashMenuItem[];
  activeIndex: number;
  skillsStatus: "idle" | "loading" | "ready" | "error";
  onRetryLoad: () => void;
  onHighlight: (index: number) => void;
  onSelect: (item: SlashMenuItem) => void;
};

export function optionId(menuId: string, index: number) {
  return `${menuId}-option-${index}`;
}

export function SkillCommandMenu({ id, items, activeIndex, skillsStatus, onRetryLoad, onHighlight, onSelect }: SkillCommandMenuProps) {
  const firstSkillIndex = items.findIndex((item) => item.kind === "skill");
  const hasCommands = items.some((item) => item.kind === "command");

  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#252525] text-left text-white shadow-2xl">
      <div id={id} role="listbox" aria-label="Slash commands and skills" className="max-h-72 overflow-y-auto p-1">
        {hasCommands ? <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-white/40" aria-hidden="true">Commands</p> : null}
        {items.map((item, index) => {
          const Icon = item.kind === "command" ? commandIcons[item.name] : Sparkles;
          return (
            <div key={`${item.kind}-${item.name}`}>
              {index === firstSkillIndex ? (
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-white/40" aria-hidden="true">
                  Your skills
                </p>
              ) : null}
              <div
                id={optionId(id, index)}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => index !== activeIndex && onHighlight(index)}
                onClick={() => onSelect(item)}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 [@media(pointer:coarse)]:min-h-11",
                  index === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.05]",
                )}
              >
                <Icon className="size-4 shrink-0 text-white/55" aria-hidden="true" />
                <span className="shrink-0 font-mono text-[12.5px] text-white">
                  /{item.name}
                  {item.kind === "command" && item.argumentHint ? (
                    <span className="text-white/35"> {`<${item.argumentHint}>`}</span>
                  ) : null}
                </span>
                <span className="min-w-0 truncate text-[12.5px] text-white/50">{item.description}</span>
              </div>
            </div>
          );
        })}
        {skillsStatus === "loading" ? (
          <p className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-white/45" role="status">
            <PixelLoader /> Loading your skills…
          </p>
        ) : null}
        {skillsStatus === "error" ? (
          <p className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-white/45">
            Could not load your skills.
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onRetryLoad}
              className="font-medium text-white/80 hover:text-white"
            >
              Retry
            </button>
          </p>
        ) : null}
      </div>
      <p className="hidden border-t border-white/[0.06] px-3 py-1.5 text-[11px] text-white/35 sm:block" aria-hidden="true">
        ↑↓ to move · Enter to select · Esc to close
      </p>
    </div>
  );
}
