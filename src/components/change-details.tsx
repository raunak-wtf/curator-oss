"use client";

import { type FileContents, parseDiffFromFile } from "@pierre/diffs";
import { File, FileDiff, type FileDiffOptions, type FileOptions } from "@pierre/diffs/react";
import { FileCode2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { FileChangeSnapshot, ProjectFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { diffsTheme, gitStatusFromChanges } from "./code/pierre";
import { ProjectFileTree } from "./code/project-file-tree";
import { ResizableSidebar } from "./code/resizable-sidebar";

type ChangeDetailsProps = {
  changedPaths: string[];
  fileChanges: FileChangeSnapshot[];
  files: ProjectFile[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
  onOpenFile: (path: string) => void;
};

type DiffStyle = "unified" | "split";

const baseOptions = {
  theme: diffsTheme,
  themeType: "dark",
  disableFileHeader: true,
  overflow: "scroll",
} as const;

const diffOptions: Record<DiffStyle, FileDiffOptions<undefined, undefined>> = {
  unified: { ...baseOptions, diffStyle: "unified", diffIndicators: "bars", lineDiffType: "word-alt", hunkSeparators: "line-info" },
  split: { ...baseOptions, diffStyle: "split", diffIndicators: "bars", lineDiffType: "word-alt", hunkSeparators: "line-info" },
};

const fileOptions: FileOptions<undefined, undefined> = baseOptions;

export function ChangeDetails({
  changedPaths,
  fileChanges,
  files,
  selectedPath,
  onSelectPath,
  onOpenFile,
}: ChangeDetailsProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const snapshot = fileChanges.find((change) => change.path === selectedPath) ?? null;
  const currentFile = files.find((file) => file.path === selectedPath) ?? null;
  const signature = changedPaths.join("\n");
  const gitStatus = useMemo(() => {
    const known = new Map(gitStatusFromChanges(fileChanges).map((entry) => [entry.path, entry]));
    return signature.split("\n").filter(Boolean).map((path) => known.get(path) ?? { path, status: "modified" as const });
  }, [fileChanges, signature]);

  const fileDiff = useMemo(() => {
    if (!snapshot) return null;
    const oldFile: FileContents | null = snapshot.before === null ? null : { name: snapshot.path, contents: snapshot.before };
    const newFile: FileContents | null = snapshot.after === null ? null : { name: snapshot.path, contents: snapshot.after };
    if (!oldFile && !newFile) return null;
    return parseDiffFromFile(oldFile, newFile);
  }, [snapshot]);

  const currentPath = currentFile?.path ?? "";
  const currentText = currentFile?.content ?? null;
  const currentContents = useMemo<FileContents | null>(
    () => (currentText !== null ? { name: currentPath, contents: currentText } : null),
    [currentPath, currentText],
  );

  const additions = fileDiff?.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0) ?? 0;
  const removals = fileDiff?.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0) ?? 0;

  return (
    <div className="change-details">
      <ResizableSidebar storageKey="cognix:changed-files-width" className="change-file-list" aria-label="Edited files" handleLabel="Resize changed files list">
        <div className="change-file-list-heading">
          <strong>Changed files</strong>
          <span className="tabular-nums">{changedPaths.length}</span>
        </div>
        <div className="change-file-tree" style={{ position: "relative", flex: "1 1 0%", minHeight: 0 }}>
          <ProjectFileTree
            paths={changedPaths}
            expandAll
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            gitStatus={gitStatus}
            label="Changed files"
          />
        </div>
      </ResizableSidebar>

      <section className="diff-panel" aria-label={selectedPath ? `Changes in ${selectedPath}` : "File changes"}>
        <header className="diff-header">
          <div className="min-w-0">
            <strong title={selectedPath}>{selectedPath || "No changed file selected"}</strong>
            {snapshot?.truncated ? <span className="diff-truncated"><TriangleAlert className="size-3" aria-hidden="true" /> Large file diff was shortened</span> : null}
          </div>
          <div className="diff-header-actions">
            {fileDiff ? <span className="diff-stats tabular-nums"><b>+{additions}</b><i>-{removals}</i></span> : null}
            {fileDiff ? (
              <div className="diff-style-toggle" role="group" aria-label="Diff layout">
                {(["unified", "split"] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={diffStyle === style}
                    className={cn(diffStyle === style && "is-active")}
                    onClick={() => setDiffStyle(style)}
                  >
                    {style === "unified" ? "Unified" : "Split"}
                  </button>
                ))}
              </div>
            ) : null}
            {selectedPath && snapshot?.after !== null && currentFile
              ? <button type="button" onClick={() => onOpenFile(selectedPath)}>Open file</button>
              : null}
          </div>
        </header>

        {!snapshot && selectedPath ? (
          <div className="diff-unavailable">
            <FileCode2 className="size-5" aria-hidden="true" />
            <strong>Original version unavailable</strong>
            <p>This build predates file-change snapshots. The current file is shown without a comparison.</p>
          </div>
        ) : null}

        <div className="diff-scroll" role="region" aria-label="File diff">
          {fileDiff ? (
            fileDiff.hunks.length
              ? <FileDiff fileDiff={fileDiff} options={diffOptions[diffStyle]} />
              : <div className="diff-empty">No textual changes in this file.</div>
          ) : currentContents ? (
            <File file={currentContents} options={fileOptions} />
          ) : (
            <div className="diff-empty">
              {selectedPath ? "This file is not available in the current version." : "Select a changed file to see its diff."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
