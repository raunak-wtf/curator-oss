"use client";

import type { FileContents } from "@pierre/diffs";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import { EditProvider, File, type FileEditChangeHandler, type FileOptions } from "@pierre/diffs/react";
import { Save, Search, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import type { FileChangeSnapshot, ProjectFile } from "@/lib/types";
import { diffsTheme, gitStatusFromChanges } from "./code/pierre";
import { ProjectFileTree } from "./code/project-file-tree";
import { ResizableSidebar } from "./code/resizable-sidebar";

const createEditor: EditorFactory<undefined, undefined> = (editorType, options, editStateKey) =>
  new Editor(editorType, options, editStateKey);

const fileOptions: FileOptions<undefined, undefined> = {
  theme: diffsTheme,
  themeType: "dark",
  disableFileHeader: true,
  overflow: "scroll",
};

type CodeWorkbenchProps = {
  projectId: string;
  files: ProjectFile[];
  /** Snapshots from the latest build, shown as Git status in the tree. */
  latestChanges?: FileChangeSnapshot[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
  onFilesChange: Dispatch<SetStateAction<ProjectFile[]>>;
};

export function CodeWorkbench({ projectId, files, latestChanges = [], selectedPath, onSelectPath, onFilesChange }: CodeWorkbenchProps) {
  const fallbackFile = files[0] ?? null;
  const selectedFile = files.find((file) => file.path === selectedPath) ?? fallbackFile;
  const activePath = selectedFile?.path ?? "";
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const allPaths = useMemo(() => files.map((file) => file.path).sort((a, b) => a.localeCompare(b)), [files]);
  const searchPaths = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    return files
      .filter((file) => file.path.toLowerCase().includes(normalized) || file.content?.toLowerCase().includes(normalized))
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
  }, [files, query]);
  const existing = useMemo(() => new Set(allPaths), [allPaths]);
  const gitStatus = useMemo(
    () => gitStatusFromChanges(latestChanges).filter((entry) => existing.has(entry.path)),
    [existing, latestChanges],
  );

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!selectedFile || selectedFile.content !== null) return;

    let cancelled = false;
    void fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(selectedFile.path)}`)
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? "Could not read this file.");
        onFilesChange((current) => current.map((item) => (item.path === selectedFile.path ? payload.file : item)));
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not read this file.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedFile, onFilesChange]);

  const noMatches = searchPaths !== null && searchPaths.length === 0;

  return (
    <EditProvider createEditor={createEditor}>
      <div className="code-workbench">
        <ResizableSidebar storageKey="cognix:file-tree-width" className="file-explorer" aria-label="Project files" handleLabel="Resize file tree">
          <div className="file-search">
            <Search className="size-3.5" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="Search code"
              aria-label="Search project files and code"
            />
            {query
              ? <button type="button" onClick={() => setQuery("")} aria-label="Clear code search"><X className="size-3" /></button>
              : <kbd>Ctrl P</kbd>}
          </div>
          <div className="file-tree-host" style={{ position: "relative", flex: "1 1 0%", minHeight: 0 }}>
            {noMatches ? (
              <p className="file-search-empty">
                No files or code match “{query.trim()}”.{" "}
                <button type="button" onClick={() => setQuery("")}>Clear search</button>
              </p>
            ) : null}
            <div hidden={noMatches}>
              <ProjectFileTree
                paths={noMatches ? allPaths : (searchPaths ?? allPaths)}
                expandAll={searchPaths !== null}
                selectedPath={activePath}
                onSelectPath={onSelectPath}
                gitStatus={gitStatus}
                label={searchPaths ? "Code search results" : "Project file tree"}
              />
            </div>
          </div>
        </ResizableSidebar>

        {selectedFile ? (
          <FileEditor
            key={`${selectedFile.path}:${selectedFile.content === null ? "loading" : "ready"}`}
            projectId={projectId}
            file={selectedFile}
            onFilesChange={onFilesChange}
          />
        ) : (
          <section className="code-editor-panel">
            <div className="grid h-full place-items-center text-sm text-white/35">No project files yet. Ask the agent to build something.</div>
          </section>
        )}
      </div>
    </EditProvider>
  );
}

function FileEditor({
  projectId,
  file,
  onFilesChange,
}: {
  projectId: string;
  file: ProjectFile;
  onFilesChange: Dispatch<SetStateAction<ProjectFile[]>>;
}) {
  const isLoading = file.content === null;
  // The editor owns the document after mount; keep the input object stable so saves don't reset it.
  const [initialFile] = useState<FileContents>(() => ({
    name: file.path,
    contents: file.content ?? "",
    cacheKey: `${projectId}:${file.path}:${file.updatedAt}`,
  }));
  const draft = useRef(initialFile.contents);
  const saved = useRef(initialFile.contents);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const lineCount = initialFile.contents ? initialFile.contents.split("\n").length : 0;

  const handleEditChange: FileEditChangeHandler<undefined, undefined> = (event) => {
    draft.current = event.file.contents;
    setIsDirty(draft.current !== saved.current);
  };

  async function saveFile() {
    const content = draft.current;
    if (content === saved.current || isSaving || isLoading) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save this file.");
      onFilesChange((current) => current.map((item) => (item.path === file.path ? payload.file : item)));
      saved.current = content;
      setIsDirty(draft.current !== content);
      toast.success(`Saved ${file.path}`);
    } catch (error) {
      toast.error(error instanceof Error ? `${error.message} Try saving again.` : "Could not save this file. Try saving again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="code-editor-panel"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saveFile();
        }
      }}
    >
      <div className="code-tabbar">
        <span className="code-tab" title={file.path}>
          {file.path}
          {isDirty ? <span className="code-tab-dirty" aria-label="Unsaved changes" /> : null}
        </span>
        <div className="flex items-center gap-1">
          {lineCount ? <span className="code-line-count">{lineCount} {lineCount === 1 ? "line" : "lines"}</span> : null}
          <button type="button" className="save-code-button" onClick={() => void saveFile()} disabled={!isDirty || isSaving || isLoading} title="Save (Ctrl S)">
            <Save className="size-3.5" aria-hidden="true" /> {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="code-view-scroll" role="region" aria-busy={isLoading} aria-label={`Editing ${file.path}`}>
        {isLoading ? (
          <div className="editor-loading"><PixelLoader /> Reading file…</div>
        ) : (
          <File
            file={initialFile}
            options={fileOptions}
            edit
            onEditChange={handleEditChange}
            onEditComplete={() => "accept"}
          />
        )}
      </div>
    </section>
  );
}
