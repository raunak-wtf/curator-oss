import type { CSSProperties } from "react";
import type { GitStatusEntry } from "@pierre/trees";
import type { FileChangeSnapshot } from "@/lib/types";

// Dark tree palette matched to the workspace chrome (#121212 panels, violet selection).
export const treeThemeStyle = {
  height: "100%",
  "--trees-theme-sidebar-bg": "#121212",
  "--trees-theme-sidebar-fg": "rgba(255,255,255,.62)",
  "--trees-theme-sidebar-header-fg": "rgba(255,255,255,.75)",
  "--trees-theme-sidebar-border": "rgba(255,255,255,.07)",
  "--trees-theme-list-hover-bg": "rgba(255,255,255,.05)",
  "--trees-theme-list-active-selection-bg": "rgba(83,72,210,.42)",
  "--trees-theme-list-active-selection-fg": "#ffffff",
  "--trees-theme-focus-ring": "#8b7bff",
  "--trees-theme-input-bg": "rgba(255,255,255,.04)",
  "--trees-theme-input-fg": "rgba(255,255,255,.82)",
  "--trees-theme-input-border": "rgba(255,255,255,.11)",
  "--trees-theme-scrollbar-thumb": "rgba(255,255,255,.14)",
  "--trees-theme-git-added-fg": "#52d69a",
  "--trees-theme-git-modified-fg": "#e7bf78",
  "--trees-theme-git-deleted-fg": "#ff8585",
  "--trees-theme-git-renamed-fg": "#7cc4ff",
  "--trees-theme-git-untracked-fg": "#52d69a",
  "--trees-theme-git-ignored-fg": "rgba(255,255,255,.3)",
} as CSSProperties;

export const diffsTheme = "pierre-dark";

export function gitStatusFromChanges(changes: FileChangeSnapshot[]): GitStatusEntry[] {
  return changes.map((change) => ({
    path: change.path,
    status: change.before === null ? "added" : change.after === null ? "deleted" : "modified",
  }));
}

export function gitStatusSignature(entries: readonly GitStatusEntry[]) {
  return entries.map((entry) => `${entry.status}:${entry.path}`).join("\n");
}
