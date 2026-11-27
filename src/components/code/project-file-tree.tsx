"use client";

import type { FileTree as FileTreeModel, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useRef } from "react";
import { gitStatusSignature, treeThemeStyle } from "./pierre";

type ProjectFileTreeProps = {
  paths: string[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
  gitStatus?: GitStatusEntry[];
  /** Expand every folder (used for search results and short change lists). */
  expandAll?: boolean;
  label: string;
};

function ancestorsOf(path: string) {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function allDirectories(paths: readonly string[]) {
  return [...new Set(paths.flatMap(ancestorsOf))];
}

function expandedDirectories(model: FileTreeModel) {
  return model
    .getVisibleRows(0, model.getVisibleCount())
    .filter((row) => row.kind === "directory" && row.isExpanded)
    .map((row) => row.path);
}

function revealPath(model: FileTreeModel, path: string) {
  for (const directory of ancestorsOf(path)) {
    const item = model.getItem(directory) ?? model.getItem(`${directory}/`);
    if (item && "expand" in item && !item.isExpanded()) item.expand();
  }
  const target = model.getItem(path);
  if (!target) return;
  for (const selected of model.getSelectedPaths()) {
    if (selected !== path) model.getItem(selected)?.deselect();
  }
  if (!target.isSelected()) target.select();
  model.scrollToPath(path, { offset: "nearest" });
}

/** Path-first file tree from @pierre/trees with Git status, virtualization, and keyboard navigation. */
export function ProjectFileTree({ paths, selectedPath, onSelectPath, gitStatus = [], expandAll = false, label }: ProjectFileTreeProps) {
  const latest = useRef({ paths: new Set(paths), selectedPath, onSelectPath });
  useEffect(() => {
    latest.current = { paths: new Set(paths), selectedPath, onSelectPath };
  });

  const { model } = useFileTree({
    paths,
    density: "compact",
    icons: { set: "standard", colored: true },
    gitStatus,
    stickyFolders: true,
    // One row per folder (no "src / app" chains), and every folder starts expanded.
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    initialExpandedPaths: allDirectories(paths),
    initialSelectedPaths: selectedPath ? [selectedPath] : undefined,
    onSelectionChange: (selected) => {
      const path = selected.at(-1);
      const current = latest.current;
      // Folders only toggle; files open in the editor or diff view.
      if (!path || !current.paths.has(path) || path === current.selectedPath) return;
      current.onSelectPath(path);
    },
  });

  const pathSignature = paths.join("\n");
  const lastPaths = useRef(pathSignature);
  useEffect(() => {
    if (lastPaths.current === pathSignature) return;
    const previousDirectories = new Set(allDirectories(lastPaths.current ? lastPaths.current.split("\n") : []));
    lastPaths.current = pathSignature;
    const nextPaths = pathSignature ? pathSignature.split("\n") : [];
    // Keep folders the user collapsed collapsed; open folders that are new (or everything in search results).
    const newDirectories = allDirectories(nextPaths).filter((directory) => !previousDirectories.has(directory));
    const keepOpen = expandAll ? allDirectories(nextPaths) : [...new Set([...expandedDirectories(model), ...newDirectories])];
    model.resetPaths(nextPaths, { initialExpandedPaths: keepOpen });
    if (latest.current.selectedPath) revealPath(model, latest.current.selectedPath);
  }, [expandAll, model, pathSignature]);

  const statusSignature = gitStatusSignature(gitStatus);
  const lastStatus = useRef(statusSignature);
  useEffect(() => {
    if (lastStatus.current === statusSignature) return;
    lastStatus.current = statusSignature;
    model.setGitStatus(gitStatus);
  }, [gitStatus, model, statusSignature]);

  useEffect(() => {
    if (!selectedPath) return;
    const selected = model.getSelectedPaths();
    if (selected.length === 1 && selected[0] === selectedPath) return;
    revealPath(model, selectedPath);
  }, [model, selectedPath]);

  // Safety net: if the tree is on screen with files but painted no rows (it was laid out while hidden,
  // or its first render raced a file reload), rebuild it from the current paths.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const host = wrap.querySelector("file-tree-container");
        const visible = wrap.getBoundingClientRect().height > 0;
        const rows = host?.shadowRoot?.querySelectorAll("[role=treeitem]").length ?? 0;
        const current = [...latest.current.paths];
        if (!visible || rows > 0 || current.length === 0) return;
        model.resetPaths(current.sort((a, b) => a.localeCompare(b)), { initialExpandedPaths: allDirectories(current) });
        if (latest.current.selectedPath) revealPath(model, latest.current.selectedPath);
      });
    };
    const observer = new ResizeObserver(check);
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [expandAll, model]);

  return (
    // Sizing is inline on purpose: the virtualized tree needs a real height, and must not collapse
    // if a stylesheet is stale or loads late. It fills its nearest positioned parent.
    <div ref={wrapRef} className="project-file-tree-wrap" style={{ position: "absolute", inset: 0 }}>
      {paths.length === 0 ? <p className="file-search-empty">No files yet. Ask the agent to build something.</p> : null}
      {paths.length === 0 ? null : <FileTree model={model} aria-label={label} className="project-file-tree" style={treeThemeStyle} />}
    </div>
  );
}
