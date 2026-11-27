"use client";

import { ArrowUp, AtSign, FileEdit, MessageCircleDashed, Mic, Plus } from "lucide-react";
import { PixelLoader } from "@/components/pixel-loader";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppDither } from "@/components/dither-backdrop";
import { HomeSidebar, SidebarMobileTrigger } from "@/components/home-sidebar";
import { PendingUpload } from "@/components/pending-upload";
import { ApprovalModeMenu } from "@/components/security/approval-mode-menu";
import { RepoSelector } from "@/components/security/repo-selector";
import { useSkillCommands } from "@/components/skills/use-skill-commands";
import type { ApprovalMode, Project, Viewer } from "@/lib/types";
import { validateUpload } from "@/lib/upload-policy";
import { cn } from "@/lib/utils";

type HomeShellProps = {
  viewer?: Viewer | null;
  projects?: Project[];
  /** Security mode only: repository preselected from `?repo=owner/name`. */
  initialRepository?: string | null;
};

export const SECURITY_PATH = "/security-scanner";

export function HomeShell({ viewer, projects = [], initialRepository = null }: HomeShellProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  // The URL decides the mode: Security mode lives at /security-scanner.
  const pathname = usePathname();
  const mode: "code" | "security" = pathname?.startsWith(SECURITY_PATH) ? "security" : "code";
  const [repository, setRepository] = useState<string | null>(initialRepository);
  // Security mode: how the agent acts on its first run. Defaults to the last choice made anywhere.
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("auto");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cognix:approval-mode:last");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser-only preference after hydration
      if (saved === "review" || saved === "auto") setApprovalMode(saved);
    } catch {
      // Blocked storage: keep the default.
    }
  }, []);

  function chooseApprovalMode(next: ApprovalMode) {
    setApprovalMode(next);
    try {
      window.localStorage.setItem("cognix:approval-mode:last", next);
    } catch {
      // Blocked storage: the choice still applies to this prompt.
    }
  }
  const [files, setFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const skillCommands = useSkillCommands({ prompt, setPrompt, textareaRef, signedIn: Boolean(viewer) });

  function addFiles(incoming: File[]) {
    const valid: File[] = [];
    for (const file of incoming) {
      const error = validateUpload(file);
      if (error) toast.error(`${file.name || "Attachment"}: ${error}`);
      else valid.push(file);
    }
    setFiles((current) => {
      const next = [...current];
      for (const file of valid) {
        if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
          next.push(file);
        }
      }
      if (next.length > 10) toast.error("You can attach up to 10 files per project.");
      return next.slice(0, 10);
    });
  }

  async function handleSubmit() {
    if (isCreating || skillCommands.runCommand(prompt)) return;
    const security = mode === "security";
    // In Security mode, a chosen repository with an empty prompt runs a full review.
    const trimmed = prompt.trim() || (security && repository ? `Run a full security review of ${repository}.` : "");
    if (trimmed.length < 2) return;
    setIsCreating(true);

    try {
      const effectivePrompt = trimmed;
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(security ? { prompt: effectivePrompt, mode: "security", repository: repository ?? undefined } : { prompt: effectivePrompt }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create the project.");

      const attachmentIds: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const upload = await fetch(`/api/projects/${payload.project.id}/upload`, {
          method: "POST",
          body: formData,
        });
        const uploadPayload = await upload.json();
        if (!upload.ok) throw new Error(uploadPayload.error ?? `Could not upload ${file.name}.`);
        attachmentIds.push(uploadPayload.attachment.id);
      }

      const search = new URLSearchParams({ prompt: effectivePrompt });
      if (attachmentIds.length) search.set("attachments", attachmentIds.join(","));
      if (security) search.set("approvalMode", approvalMode);
      router.push(`/projects/${payload.project.id}?${search.toString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong. Try again.");
      setIsCreating(false);
    }
  }

  function handleVoiceInput() {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) {
          setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };
      recognition.start();
    } catch {
      setIsListening(false);
      toast.error("Could not activate microphone.");
    }
  }

  const canSubmit = (prompt.trim().length >= 2 || (mode === "security" && Boolean(repository))) && !isCreating;

  /** Switches mode by changing the URL in place, so the typed prompt and attachments stay. */
  function switchMode(next: "code" | "security") {
    if (next === mode) return;
    const url = next === "security" ? `${SECURITY_PATH}${repository ? `?repo=${encodeURIComponent(repository)}` : ""}` : "/";
    window.history.pushState(null, "", url);
  }

  function chooseRepository(next: string | null) {
    setRepository(next);
    window.history.replaceState(null, "", next ? `${SECURITY_PATH}?repo=${encodeURIComponent(next)}` : SECURITY_PATH);
    textareaRef.current?.focus();
  }

  function startNewChat() {
    setPrompt("");
    setFiles([]);
    textareaRef.current?.focus();
  }

  const modeButton = "inline-flex h-7 items-center rounded-full px-3 text-[13px] font-medium transition-colors duration-150";
  const toolButton =
    "flex size-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#191919] text-white">
      <HomeSidebar
        viewer={viewer ?? null}
        projects={projects}
        mobileOpen={sidebarOpen}
        onMobileOpenChange={setSidebarOpen}
        onNewChat={startNewChat}
      />

      {/* Main Surface */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#191919]">
        {/* Top Header Row */}
        <header className="relative z-20 flex h-12 shrink-0 items-center justify-between px-2 md:justify-end md:px-3">
          <SidebarMobileTrigger onOpen={() => setSidebarOpen(true)} />
          <button
            type="button"
            className={toolButton}
            title="Chat actions"
            aria-label="Chat actions"
          >
            <MessageCircleDashed className="size-4" />
          </button>
        </header>

        {/* Center Stage */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-24">
          {/* Wordmark and Code / Security switch */}
          <div className="mb-3 flex w-full max-w-[656px] items-center justify-between gap-3 px-1">
            <h1 className="flex min-w-0 items-center gap-2 text-[24px] font-semibold tracking-[-0.03em] text-white">
              <Image
                src="/cognix-logo-192.png"
                alt=""
                width={24}
                height={24}
                priority
                className="size-6 shrink-0 rounded object-contain"
              />
              <span className="truncate">
                Cognix
                {mode === "security" && <span className="text-[#38bdf8]"> Security</span>}
              </span>
            </h1>

            {/* Mode Switch: Code / Security */}
            <div role="group" aria-label="Mode" className="inline-flex shrink-0 items-center rounded-full bg-white/[0.05] p-0.5">
              <button
                type="button"
                aria-pressed={mode === "code"}
                onClick={() => switchMode("code")}
                className={cn(modeButton, mode === "code" ? "bg-white/[0.1] font-semibold text-white" : "text-white/55 hover:text-white")}
              >
                Code
              </button>
              <button
                type="button"
                aria-pressed={mode === "security"}
                onClick={() => switchMode("security")}
                className={cn(modeButton, mode === "security" ? "bg-white/[0.1] font-semibold text-white" : "text-white/55 hover:text-white")}
              >
                Security
              </button>
            </div>
          </div>

          {/* Composer frame: card plus disclaimer row */}
          <div className="w-full max-w-[656px] rounded-2xl bg-white/[0.035]">
            <div
              className={cn(
                "relative rounded-xl border border-white/[0.12] bg-[#212121] px-3 pb-2 pt-3 transition-colors duration-200 focus-within:border-white/25",
                isDragging && "border-white/30 bg-[#262626]",
              )}
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              {files.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2" aria-label="Attached files">
                  {files.map((file, index) => (
                    <PendingUpload
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      file={file}
                      onRemove={() => setFiles((curr) => curr.filter((_, i) => i !== index))}
                    />
                  ))}
                </div>
              )}

              {skillCommands.menu}

              <textarea
                ref={textareaRef}
                rows={1}
                value={prompt}
                {...skillCommands.textareaProps}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  skillCommands.syncCaret(e);
                }}
                onKeyDown={(e) => {
                  if (skillCommands.onKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={
                  mode === "security"
                    ? repository
                      ? `Ask about ${repository}, or press Enter for a full review`
                      : "Ask security questions, review vulnerabilities, or @mention"
                    : "Ask anything, or type / for skills"
                }
                aria-label={mode === "security" ? "Describe what to review" : "Describe what you want to build"}
                className="block min-h-[44px] max-h-[220px] w-full resize-none bg-transparent px-1.5 text-[15px] leading-6 text-white outline-none placeholder:text-white/40 [&:focus-visible]:outline-none"
              />

              {/* Composer Toolbar */}
              <div className="mt-1 flex items-center justify-between gap-2">
                {/* Left action tools */}
                <div className="flex items-center gap-0.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.md,.txt,.json,.csv,.doc,.docx"
                    className="hidden"
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []));
                      e.currentTarget.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={toolButton}
                    title="Add files"
                    aria-label="Add files"
                  >
                    <Plus className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.info("Canvas workspace ready.")}
                    className={toolButton}
                    title="Workspace document"
                    aria-label="Workspace document"
                  >
                    <FileEdit className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt((prev) => `${prev} @`);
                      textareaRef.current?.focus();
                    }}
                    className={toolButton}
                    title="Mention"
                    aria-label="Mention"
                  >
                    <AtSign className="size-3.5" />
                  </button>
                </div>

                {/* Right action tools (no model selector) */}
                <div className="flex items-center gap-1">
                  {mode === "security" ? <ApprovalModeMenu value={approvalMode} onChange={chooseApprovalMode} disabled={isCreating} /> : null}
                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    className={cn(toolButton, isListening && "bg-red-500/15 text-red-400 hover:bg-red-500/20 hover:text-red-300")}
                    title="Voice dictation"
                    aria-label={isListening ? "Listening for dictation" : "Voice dictation"}
                    aria-pressed={isListening}
                  >
                    <Mic className="size-4" />
                  </button>

                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => void handleSubmit()}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full transition-colors duration-150 [@media(pointer:coarse)]:size-11",
                      canSubmit ? "bg-white text-black hover:bg-white/85" : "cursor-not-allowed bg-white/[0.12] text-white/45",
                    )}
                    aria-label={isCreating ? "Creating project…" : "Send message"}
                  >
                    {isCreating ? (
                      <PixelLoader className="text-black" />
                    ) : (
                      <ArrowUp className="size-4 stroke-[2.25]" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Disclaimer and shortcuts; in Security mode the left side picks the repository to review */}
            <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-white/45">
              {mode === "security" ? (
                <div className="-ml-2 min-w-0">
                  <RepoSelector signedIn={Boolean(viewer)} value={repository} onChange={chooseRepository} />
                </div>
              ) : (
                <span className="truncate">Cognix can make mistakes. Check important info.</span>
              )}
              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                <button
                  type="button"
                  onClick={skillCommands.openMenu}
                  className="rounded px-0.5 transition-colors hover:text-white/75"
                  aria-label="Show skills and slash commands"
                >
                  <kbd className="font-sans font-semibold text-white/70">/</kbd> skills
                </button>
                <span>
                  <kbd className="font-sans font-semibold text-white/70">@</kbd> mention
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mountain Dither Backdrop */}
        <AppDither className="inset-x-0 bottom-0 z-0 h-[40%] opacity-70 [mask-image:linear-gradient(to_top,black_35%,transparent)]" />
      </main>
      {skillCommands.dialogs}
    </div>
  );
}
