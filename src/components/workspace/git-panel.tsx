"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { GitHistory, type BuildCheckpoint } from "./git-history";
import type { GitSyncInfo } from "./github-repository";
import { GitHubSection } from "./github-section";
import type { ReactNode } from "react";
import { SecurityGitSection } from "@/components/security/security-git-section";
import type { Message, SecuritySource } from "@/lib/types";

export type { BuildCheckpoint };

type GitPanelProps = {
  builds: BuildCheckpoint[];
  selectedId: string | null;
  details: ReactNode;
  projectId: string;
  projectTitle: string;
  /** Changes after each build so the GitHub section reloads its last commit. */
  githubRefreshKey: number;
  canCommit: boolean;
  onFilesChanged: () => void;
  restoringMessageId: string | null;
  isBuilding: boolean;
  relativeNow: number;
  onSelect: (message: Message) => void;
  onBack: () => void;
  onRestore: (message: Message) => void;
  /** Security mode: show the manual commit-and-push section instead of GitHub sync. */
  security?: { source: SecuritySource | null; onPushed: () => void };
};

export function GitPanel({
  builds,
  selectedId,
  details,
  projectId,
  projectTitle,
  githubRefreshKey,
  canCommit,
  onFilesChanged,
  restoringMessageId,
  isBuilding,
  relativeNow,
  onSelect,
  onBack,
  onRestore,
  security,
}: GitPanelProps) {
  const [syncInfo, setSyncInfo] = useState<GitSyncInfo & { linked: boolean }>({ state: null, head: null, lastPushedAt: null, linked: false });
  const handleSync = useCallback((info: GitSyncInfo) => {
    setSyncInfo((current) => {
      const linked = info.state !== null || info.head !== null;
      return current.state === info.state && current.head === info.head && current.lastPushedAt === info.lastPushedAt && current.linked === linked
        ? current
        : { ...info, linked };
    });
  }, []);
  const selected = builds.find((build) => build.message.id === selectedId);

  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-2 py-1.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-white/70 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:h-11"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> All checkpoints
          </button>
          <span className="min-w-0 truncate text-[12.5px] text-white/50">{selected.summary}</span>
        </div>
        <div className="min-h-0 flex-1">{details}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#0a0a0a]">
      <div className="mx-auto w-full max-w-3xl p-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Git Control</h2>
          <p className="mt-1 max-w-md text-[13px] leading-5 text-white/55">
            {security
              ? "Review the agent's changes, then commit and push them yourself. Checkpoints let you undo any run."
              : "Save this project to GitHub, and use Cognix's checkpoints to review or undo any build."}
          </p>
        </div>

        <div className="mt-5">
          {security ? (
            <SecurityGitSection
              projectId={projectId}
              source={security.source}
              refreshKey={githubRefreshKey}
              canCommit={canCommit}
              onPushed={security.onPushed}
            />
          ) : (
            <GitHubSection projectId={projectId} projectTitle={projectTitle} refreshKey={githubRefreshKey} canCommit={canCommit} onFilesChanged={onFilesChanged} onSync={handleSync} />
          )}
        </div>

        <GitHistory
          projectId={projectId}
          builds={builds}
          sync={syncInfo}
          refreshKey={githubRefreshKey}
          restoringMessageId={restoringMessageId}
          isBuilding={isBuilding}
          relativeNow={relativeNow}
          onSelect={onSelect}
          onRestore={onRestore}
        />
      </div>
    </div>
  );
}
