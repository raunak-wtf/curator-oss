"use client";

import { Cloud, FileCode2, GitBranch, KeyRound, TerminalSquare } from "lucide-react";
import { useEffect, useRef, type ComponentType } from "react";

export type ToolTab = "terminal" | "code" | "cloud" | "git";

type ToolMeta = { label: string; description: string; icon: ComponentType<{ className?: string }> };

export const TOOL_TABS: Record<ToolTab, ToolMeta> = {
  terminal: { label: "Terminal", description: "Watch the commands Cognix runs", icon: TerminalSquare },
  code: { label: "Files/Code", description: "Browse and edit project files", icon: FileCode2 },
  cloud: { label: "Cloud", description: "Publish, custom domains, and secrets", icon: Cloud },
  git: { label: "Git Control", description: "Checkpoints, diffs, and restore", icon: GitBranch },
};

/** Security mode has no preview or publishing: Cloud is only Secrets, and Git Control is where the user pushes. */
export const SECURITY_TOOL_TABS: Record<ToolTab, ToolMeta> = {
  terminal: { label: "Shell", description: "Commands the agent runs in the sandbox", icon: TerminalSquare },
  code: { label: "Files", description: "Browse and edit the repository's files", icon: FileCode2 },
  cloud: { label: "Secrets", description: "Environment variables for this project", icon: KeyRound },
  git: { label: "Git Control", description: "Review changes, commit, push, and open pull requests", icon: GitBranch },
};

export const TOOL_ORDER: ToolTab[] = ["terminal", "code", "cloud", "git"];
/** The security agent works in chat; these panes expose its repository and command context. */
export const SECURITY_TOOL_ORDER: ToolTab[] = ["terminal", "code", "cloud", "git"];

type ToolLauncherProps = {
  openTabs: ToolTab[];
  onOpen: (tab: ToolTab) => void;
  onCancel: () => void;
  tools?: Record<ToolTab, ToolMeta>;
  order?: ToolTab[];
};

export function ToolLauncher({ openTabs, onOpen, onCancel, tools = TOOL_TABS, order = TOOL_ORDER }: ToolLauncherProps) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div
      className="flex h-full items-center justify-center overflow-y-auto p-6"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <section aria-labelledby="tool-launcher-heading" className="w-full max-w-sm">
        <h2 id="tool-launcher-heading" className="mb-3 text-center text-[13px] font-medium text-white/50">
          Open a tool
        </h2>
        <ul className="space-y-2">
          {order.map((tab, index) => {
            const tool = tools[tab];
            const isOpen = openTabs.includes(tab);
            return (
              <li key={tab}>
                <button
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  onClick={() => onOpen(tab)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.07]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/75">
                    <tool.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-white">{tool.label}</span>
                    <span className="block truncate text-[12px] text-white/45">{tool.description}</span>
                  </span>
                  {isOpen ? <span className="shrink-0 text-[11px] text-white/35">Open</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
