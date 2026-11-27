"use client";

import {
  AlertCircle,
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FolderTree,
  Globe2,
  Hammer,
  History,
  ImagePlus,
  Mail,
  MessageSquare,
  Mic,
  Monitor,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Tablet,
  TerminalSquare,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { hasPersistedPrompt, stripInitialBuildParams } from "@/lib/initial-build";
import { HomeSidebar, SidebarMobileTrigger } from "@/components/home-sidebar";
import { GitHubMark } from "@/components/github-mark";
import { AgentQuestionCard, CloudRequestCard } from "@/components/agent-question-card";
import { CLOUD_DECLINED_PROMPT, CLOUD_ENABLED_PROMPT, cloudWireUpPromptFor, formatAnswers, questionRequestFor } from "@/lib/agent-questions";
import { CLOUD_FEATURES, type CloudFeature } from "@/lib/cloud-features";
import { LoadingState, PixelLoader } from "@/components/pixel-loader";
import { useSkillCommands } from "@/components/skills/use-skill-commands";
import { useVoiceInput } from "@/components/use-voice-input";
import { BuildModeMenu } from "@/components/workspace/build-mode-menu";
import { CloudPanel } from "@/components/workspace/cloud-panel";
import { GitPanel, type BuildCheckpoint } from "@/components/workspace/git-panel";
import { PreviewConsolePanel, type ConsoleFilter } from "@/components/workspace/preview-console-panel";
import { TerminalPanel, type TerminalEntry } from "@/components/workspace/terminal-panel";
import { SECURITY_TOOL_ORDER, SECURITY_TOOL_TABS, TOOL_ORDER, TOOL_TABS, ToolLauncher, type ToolTab } from "@/components/workspace/tool-launcher";
import { VisualEditInspector } from "@/components/workspace/visual-edit-inspector";
import { SecretsPanel } from "@/components/secrets-panel";
import { ApprovalCard } from "@/components/security/approval-card";
import { ApprovalModeMenu } from "@/components/security/approval-mode-menu";
import { PullRequestCard, pullRequestDecisionFor } from "@/components/security/pull-request-card";
import { RunChips, type RunChipActivity } from "@/components/security/run-chips";
import type { ThemeToken } from "@/lib/direct-visual-edit";
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRunActivity,
  ApprovalMode,
  Attachment,
  BuildChatMode,
  FileChangeSnapshot,
  GitHubCommitInfo,
  Message,
  PreviewConsoleEntry,
  PreviewConsoleInput,
  Project,
  ProjectFile,
  TerminalCommand,
  Viewer,
  VisualElementSelection,
} from "@/lib/types";
import { checkpointCanRestore } from "@/lib/checkpoints";
import {
  buildConsoleFixPrompt,
  computeConsoleFingerprint,
  isIgnorableConsoleError,
  previewConsoleInputSchema,
  selectActionableConsoleErrors,
} from "@/lib/preview-console";
import { validateUpload } from "@/lib/upload-policy";
import { cn, formatRelativeDate, publishSlugFromTitle } from "@/lib/utils";
import {
  applyVisualSelection,
  parseVisualSelections,
  VISUAL_EDIT_SOURCE,
  VISUAL_EDIT_VERSION,
  visualElementSelectionSchema,
  visualSelectionLabel,
} from "@/lib/visual-edit";
import { ChangeDetails } from "./change-details";
import { CodeWorkbench } from "./code-workbench";
import { AssistantMessageContent, UserMessageContent } from "./message-content";
import { PendingUpload } from "./pending-upload";
import { PreviewPlaceholder } from "./preview-placeholder";

type Activity = {
  id: string;
  name: string;
  label: string;
  status: "running" | "done";
  target?: string;
};

type PreviewDevice = "phone" | "tablet" | "desktop";
type WorkspaceTab = "preview" | ToolTab | "launcher";

type WorkspaceClientProps = {
  initialProject: Project;
  initialMessages: Message[];
  initialFiles: ProjectFile[];
  initialConsoleEntries?: PreviewConsoleEntry[];
  viewer: Viewer;
  initialNow: string;
  initialPrompt?: string;
  initialAttachmentIds?: string[];
  projects: Project[];
  initialCloudEnabled: boolean;
  /** Tab to open first, for example after returning from GitHub. */
  initialTab?: "git";
  /** Result code from the GitHub OAuth callback. */
  githubResult?: string;
  /** Security mode: actions a running agent is still waiting on, so a reloaded page can answer them. */
  initialApproval?: AgentApprovalRequest | null;
  /** Security mode: the Auto / Request review choice made on the home page for the first run. */
  initialApprovalMode?: ApprovalMode;
  /** Wildcard apps domain (e.g. `apps.curatorsite.in`) when direct subdomain publishing is enabled. */
  appsDomain?: string | null;
  /** Idle minutes before a published sandbox scales to zero (0 = runs continuously). */
  publishedAutoStopMinutes?: number;
};

const GITHUB_RESULT_MESSAGES: Record<string, { kind: "success" | "error" | "message"; text: string }> = {
  connected: { kind: "success", text: "GitHub connected. Choose a repository for this project." },
  installed: { kind: "success", text: "Cognix is installed on your GitHub account. Choose a repository for this project." },
  cancelled: { kind: "message", text: "GitHub connection cancelled." },
  denied: { kind: "error", text: "GitHub didn't grant repository access. Connect again and approve the requested access." },
  error: { kind: "error", text: "GitHub couldn't be connected. Try connecting again." },
  not_configured: { kind: "error", text: "GitHub isn't set up on this Cognix server yet." },
  unavailable: { kind: "error", text: "Cognix couldn't reach GitHub. Try connecting again." },
};

const suggestions = ["Add a dashboard", "Create a settings page", "Improve mobile layout"];
const securitySuggestions = ["Run a full security review", "Fix the critical findings", "Check dependencies for known vulnerabilities"];

/** Tools whose result can be shown in the workspace pane, and where. */
const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file", "move_file", "delete_file"]);
const BROWSE_TOOLS = new Set(["list_files", "find_files", "search_files"]);
const SHELL_TOOLS = new Set(["run_command", "get_process_logs", "list_processes", "stop_process"]);

/** The file, command, or query a tool call acted on. Mirrors the server's activity target. */
function activityTarget(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((key) => value[key]).find((item): item is string => typeof item === "string" && item.length > 0);
  if (name === "run_command") return pick("command")?.slice(0, 300);
  if (name === "move_file") return pick("destination", "source");
  if (name === "search_files" || name === "web_search") return pick("query")?.slice(0, 200);
  if (name === "fetch_url") return pick("url")?.slice(0, 300);
  if (name === "neon_database" || name === "resend_email") return pick("action", "name", "sql")?.slice(0, 200);
  return pick("path", "directory")?.slice(0, 300);
}
const acceptedUploads = "image/*,.pdf,.md,.txt,.json";
// react-resizable-panels wraps children in a div with `overflow: auto`. Left as-is, that wrapper scrolls the
// whole chat panel (composer included) once messages overflow. Make it a fixed-height, non-scrolling column.
const WORKSPACE_PANEL_STYLE = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "clip" } as const;

type MessageImage = { key: string; name: string; url: string };
type ComposerUpload = {
  localId: string;
  file: File;
  status: "uploading" | "uploaded" | "error";
  attachment?: Attachment;
};

function subscribeToSiteOrigin() {
  return () => undefined;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function imageAttachmentsFor(message: Message): MessageImage[] {
  if (!Array.isArray(message.metadata.attachments)) return [];
  return message.metadata.attachments.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as { id?: unknown; name?: unknown; contentType?: unknown };
    if (typeof value.contentType !== "string" || !value.contentType.startsWith("image/")) return [];
    if (typeof value.id !== "string") return [];
    const name = typeof value.name === "string" ? value.name : `Attached image ${index + 1}`;
    return [{ key: value.id, name, url: `/api/uploads/${value.id}` }];
  });
}

function MessageImages({ images }: { images: MessageImage[] }) {
  if (!images.length) return null;
  return (
    <div className="message-image-grid" aria-label="Attached images">
      {images.map((image) => (
        <a key={image.key} href={image.url} target="_blank" rel="noreferrer" title={`Open ${image.name}`}>
          <Image src={image.url} alt={image.name} width={148} height={104} unoptimized />
        </a>
      ))}
    </div>
  );
}

function VisualSelectionReferences({
  selections,
  onRemove,
}: {
  selections: VisualElementSelection[];
  onRemove?: (id: string) => void;
}) {
  if (!selections.length) return null;
  return (
    <div className={cn("visual-reference-list", onRemove ? "is-composer" : "is-message")} aria-label="Selected preview elements">
      {selections.map((selection) => (
        <span className="visual-reference-chip" key={selection.id} title={`${selection.route} · ${selection.selector}`}>
          <MousePointer2 className="size-3" aria-hidden="true" />
          <span>
            <strong>{visualSelectionLabel(selection)}</strong>
            <small>{selection.route}</small>
          </span>
          {onRemove ? (
            <button type="button" onClick={() => onRemove(selection.id)} aria-label={`Remove ${visualSelectionLabel(selection)} reference`}>
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function visualSelectionsFor(message: Message) {
  return parseVisualSelections(message.metadata.visualSelections);
}

function changedPathsFor(message: Message) {
  return Array.isArray(message.metadata.changedPaths)
    ? message.metadata.changedPaths.filter((item): item is string => typeof item === "string")
    : [];
}

function fileChangesFor(message: Message): FileChangeSnapshot[] {
  if (!Array.isArray(message.metadata.fileChanges)) return [];
  return message.metadata.fileChanges.filter((item): item is FileChangeSnapshot => {
    if (!item || typeof item !== "object") return false;
    const value = item as Partial<FileChangeSnapshot>;
    return typeof value.path === "string" && (value.after === null || typeof value.after === "string")
      && (value.before === null || typeof value.before === "string");
  });
}

function attachmentIdsFor(message: Message) {
  return Array.isArray(message.metadata.attachmentIds)
    ? message.metadata.attachmentIds.filter((item): item is string => typeof item === "string")
    : [];
}

function commandsFor(message: Message): TerminalCommand[] {
  if (!Array.isArray(message.metadata.commands)) return [];
  return message.metadata.commands.filter((item): item is TerminalCommand => {
    if (!item || typeof item !== "object") return false;
    const value = item as Partial<TerminalCommand>;
    return typeof value.id === "string"
      && typeof value.command === "string"
      && typeof value.output === "string"
      && (value.source === "agent" || value.source === "system")
      && typeof value.durationMs === "number";
  }).map((item) => ({
    ...item,
    background: item.background === true,
    failed: item.failed === true,
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
    startedAt: typeof item.startedAt === "string" ? item.startedAt : message.createdAt,
  }));
}

function GitHubCommitNote({ info, onOpen }: { info: unknown; onOpen: () => void }) {
  if (!info || typeof info !== "object") return null;
  const value = info as Partial<GitHubCommitInfo>;
  if (value.status === "committed" && typeof value.sha === "string" && typeof value.url === "string") {
    return (
      <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-white/50">
        <GitHubMark className="size-3" /> Committed{" "}
        <a href={value.url} target="_blank" rel="noreferrer" className="font-mono text-white/75 hover:text-white">
          {value.sha.slice(0, 7)}
        </a>{" "}
        to GitHub
      </p>
    );
  }
  if (value.status === "diverged" && typeof value.url === "string") {
    return (
      <p className="mt-2.5 text-[11px] leading-5 text-amber-200/90">
        GitHub had changes too, so Cognix pushed to{" "}
        <a href={value.url} target="_blank" rel="noreferrer" className="font-mono text-white/80 hover:text-white">
          {value.branch ?? "cognix-sync"}
        </a>
        .{" "}
        <button type="button" onClick={onOpen} className="font-medium text-white/80 underline-offset-2 hover:underline">
          Resolve in Git Control
        </button>
      </p>
    );
  }
  if (value.status === "error" && typeof value.message === "string") {
    return (
      <p className="mt-2.5 text-[11px] leading-5 text-amber-200/90">
        GitHub commit didn&apos;t go through: {value.message}{" "}
        <button type="button" onClick={onOpen} className="font-medium text-white/80 underline-offset-2 hover:underline">
          Open Git Control
        </button>
      </p>
    );
  }
  return null;
}

function runActivityFor(message: Message): AgentRunActivity[] {
  if (!Array.isArray(message.metadata.activity)) return [];
  return message.metadata.activity.filter((item): item is AgentRunActivity => {
    if (!item || typeof item !== "object") return false;
    const value = item as Partial<AgentRunActivity>;
    return typeof value.id === "string"
      && typeof value.name === "string"
      && typeof value.label === "string"
      && (value.status === "done" || value.status === "error")
      && typeof value.durationMs === "number";
  });
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

function ActivityIcon({ name, running }: { name: string; running: boolean }) {
  if (running) return <PixelLoader />;
  if (name === "read_attachment") return <ImagePlus className="size-3.5" />;
  if (name === "run_command") return <TerminalSquare className="size-3.5" />;
  if (name === "list_files" || name === "find_files") return <FolderTree className="size-3.5" />;
  if (name === "search_files") return <Search className="size-3.5" />;
  if (name === "web_search" || name === "fetch_url") return <Globe2 className="size-3.5" />;
  if (name === "neon_database") return <Database className="size-3.5" />;
  if (name === "resend_email") return <Mail className="size-3.5" />;
  if (name === "read_preview_console") return <SquareTerminal className="size-3.5" />;
  if (name === "get_preview_url" || name === "inspect_preview") return <Play className="size-3.5" />;
  return <FileCode2 className="size-3.5" />;
}

function RunDetails({ message }: { message: Message }) {
  const activity = runActivityFor(message);
  if (!activity.length) return null;
  const duration = typeof message.metadata.runDurationMs === "number"
    ? message.metadata.runDurationMs
    : activity.reduce((total, item) => total + item.durationMs, 0);
  return (
    <details className="run-details">
      <summary>
        <span><TerminalSquare className="size-3.5" /> Run details</span>
        <small>{activity.length} {activity.length === 1 ? "step" : "steps"} · {formatDuration(duration)}</small>
      </summary>
      <div className="run-details-list">
        {activity.map((item, index) => (
          // Older saved runs can contain repeated provider tool IDs, so qualify the key with the position.
          <div className={cn("run-details-row", item.status === "error" && "is-error")} key={`${item.id}-${index}`}>
            <span className="activity-icon is-done"><ActivityIcon name={item.name} running={false} /></span>
            <span title={item.label}>{item.label}</span>
            <small>{formatDuration(item.durationMs)}</small>
          </div>
        ))}
      </div>
    </details>
  );
}

function PreviewDeviceIcon({ device }: { device: PreviewDevice }) {
  if (device === "phone") return <Smartphone className="size-3.5" />;
  if (device === "tablet") return <Tablet className="size-3.5" />;
  return <Monitor className="size-3.5" />;
}

function assistantContent(message: Message) {
  if (message.metadata.error !== true) return message.content;
  if (/controller is already closed/i.test(message.content)) {
    return "## Build interrupted\n\nThe browser refreshed while Cognix was responding. Your saved files were not removed; send the next instruction to continue.";
  }
  if (/reached its tool limit|execution budget/i.test(message.content)) {
    return "## Build checkpoint saved\n\nCognix saved the files completed so far. Continue the build to inspect the existing app, finish the remaining work, and repair the preview without starting over.";
  }
  if (/development server did not start|missingDependency|trying to use TypeScript/i.test(message.content)) {
    return "## Preview needs repair\n\nThe generated development server could not start, but the project files were saved. Ask Cognix to **repair the preview** and it will inspect the current app and continue from those files.";
  }
  if (message.content.length > 1_200) {
    return "## Build paused\n\nThe generated app returned a long server error. Your files were saved; ask Cognix to inspect the preview logs and repair the existing app.";
  }
  return message.content;
}

export function WorkspaceClient({
  initialProject,
  initialMessages,
  initialFiles,
  initialConsoleEntries = [],
  viewer,
  initialNow,
  initialPrompt,
  initialAttachmentIds = [],
  projects,
  initialCloudEnabled,
  initialTab,
  githubResult,
  initialApproval = null,
  initialApprovalMode,
  appsDomain = null,
  publishedAutoStopMinutes = 0,
}: WorkspaceClientProps) {
  const router = useRouter();
  // Security mode: no preview or publishing, Cloud is only Secrets, and the tool pane starts collapsed.
  const security = initialProject.mode === "security";
  // Security mode opens with only the chat; the pane starts collapsed unless a tab was asked for.
  const startCollapsed = security && !initialTab;
  const workbenchPanelRef = usePanelRef();
  const [paneOpen, setPaneOpen] = useState(!security || Boolean(initialTab));
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(initialApprovalMode ?? "auto");
  const [chatMode, setChatMode] = useState<BuildChatMode>("build");
  const [pendingApproval, setPendingApproval] = useState<AgentApprovalRequest | null>(initialApproval);
  const [pullRequestDecisions, setPullRequestDecisions] = useState<Record<string, ReturnType<typeof pullRequestDecisionFor>>>({});
  const [cloudEnabled, setCloudEnabled] = useState(initialCloudEnabled);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRequestError, setCloudRequestError] = useState<string | null>(null);
  const [project, setProject] = useState(initialProject);
  const [messages, setMessages] = useState(initialMessages);
  const [files, setFiles] = useState(initialFiles);
  const [openTabs, setOpenTabs] = useState<ToolTab[]>(() => (initialTab ? [initialTab] : []));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab ?? (security ? "launcher" : "preview"));
  const [lastTab, setLastTab] = useState<"preview" | ToolTab>(initialTab ?? "preview");
  const [selectedCodePath, setSelectedCodePath] = useState(initialFiles[0]?.path ?? "");
  const [detailsMessage, setDetailsMessage] = useState<Message | null>(null);
  const [detailsPath, setDetailsPath] = useState("");
  const [liveCommands, setLiveCommands] = useState<TerminalEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [isPreviewReconnecting, setIsPreviewReconnecting] = useState(Boolean(initialProject.sandboxId) && !security);
  const [visualEditEnabled, setVisualEditEnabled] = useState(false);
  const [visualEditConnecting, setVisualEditConnecting] = useState(false);
  const [visualBridgeReady, setVisualBridgeReady] = useState(false);
  const [visualSelections, setVisualSelections] = useState<VisualElementSelection[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<PreviewConsoleEntry[]>(initialConsoleEntries);
  const [serverLogs, setServerLogs] = useState("");
  const [consoleLoading, setConsoleLoading] = useState(false);
  const [consoleFetchError, setConsoleFetchError] = useState<string | null>(null);
  const [consoleDrawerOpen, setConsoleDrawerOpen] = useState(false);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [consoleFilterRequest, setConsoleFilterRequest] = useState<{ value: ConsoleFilter; nonce: number } | undefined>(undefined);
  const [dismissedErrorFingerprints, setDismissedErrorFingerprints] = useState<Set<string>>(() => new Set());
  const [errorBaselineIso, setErrorBaselineIso] = useState<string | null>(null);
  const fixAttemptsByFingerprintRef = useRef<Map<string, number>>(new Map());
  const pendingConsoleBatchRef = useRef<PreviewConsoleInput[]>([]);
  const consoleFlushTimerRef = useRef<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [uploads, setUploads] = useState<ComposerUpload[]>([]);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  // Mirror of isBuilding readable inside async callbacks without stale closures.
  const isBuildingRef = useRef(isBuilding);
  // Timer that reloads the conversation after an approval when the live stream has already ended.
  const continueWatchRef = useRef<number | null>(null);
  const [restoringMessageId, setRestoringMessageId] = useState<string | null>(null);
  const [cloudFocusRequest, setCloudFocusRequest] = useState(0);
  const [githubRefreshKey, setGithubRefreshKey] = useState(0);
  const [publishSlug, setPublishSlug] = useState(
    initialProject.publishSlug ?? publishSlugFromTitle(initialProject.title),
  );
  const [publishedUrl, setPublishedUrl] = useState(
    initialProject.publishSlug
      ? appsDomain
        ? `https://${initialProject.publishSlug}.${appsDomain}`
        : `/publish/${initialProject.publishSlug}`
      : "",
  );
  const siteOrigin = useSyncExternalStore(
    subscribeToSiteOrigin,
    () => window.location.origin,
    () => "",
  );
  const [isPublishing, setIsPublishing] = useState(false);
  const [domainRefreshKey, setDomainRefreshKey] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isCompact, setIsCompact] = useState(false);
  const [relativeNow, setRelativeNow] = useState(() => new Date(initialNow).getTime());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatPinnedRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startedInitialPrompt = useRef(false);
  const skillCommands = useSkillCommands({ prompt, setPrompt, textareaRef: composerRef, signedIn: true });
  const voice = useVoiceInput((transcript) => setPrompt((current) => (current ? `${current} ${transcript}` : transcript)));
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  function showTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    if (tab !== "launcher") setLastTab(tab);
  }

  /** Security mode: opens the collapsed tool pane at a comfortable width. */
  function expandPane() {
    if (!security) return;
    const panel = workbenchPanelRef.current;
    if (panel?.isCollapsed()) panel.resize(isCompact ? "50%" : "55%");
    setPaneOpen(true);
  }

  function collapsePane() {
    workbenchPanelRef.current?.collapse();
    setPaneOpen(false);
  }

  function openTab(tab: ToolTab) {
    setOpenTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    showTab(tab);
    expandPane();
  }

  function closeTab(tab: ToolTab) {
    const index = openTabs.indexOf(tab);
    const remaining = openTabs.filter((item) => item !== tab);
    setOpenTabs(remaining);
    if (tab === "git") setDetailsMessage(null);
    if (activeTab === tab || lastTab === tab) {
      const fallback: "preview" | "launcher" = security ? "launcher" : "preview";
      const next: WorkspaceTab = remaining[index - 1] ?? remaining[index] ?? fallback;
      if (activeTab === tab) showTab(next);
      else setLastTab(remaining[index - 1] ?? remaining[index] ?? "preview");
      requestAnimationFrame(() => tabRefs.current.get(next)?.focus());
    }
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: "preview" | ToolTab) {
    const order: ("preview" | ToolTab)[] = security ? [...openTabs] : ["preview", ...openTabs];
    const index = order.indexOf(tab);
    let next: "preview" | ToolTab | undefined;
    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order.at(-1);
    else if ((event.key === "Delete" || event.key === "Backspace") && tab !== "preview") {
      event.preventDefault();
      closeTab(tab);
      return;
    }
    if (!next) return;
    event.preventDefault();
    showTab(next);
    tabRefs.current.get(next)?.focus();
  }

  function addUploads(incoming: File[]) {
    const valid: File[] = [];
    for (const file of incoming) {
      const error = validateUpload(file);
      if (error) toast.error(`${file.name || "Attachment"}: ${error}`);
      else valid.push(file);
    }
    const availableSlots = Math.max(0, 10 - uploads.length);
    const accepted = valid.slice(0, availableSlots).map((file) => ({
      localId: crypto.randomUUID(),
      file,
      status: "uploading" as const,
    }));
    if (valid.length > availableSlots) toast.error("You can attach up to 10 files per message.");
    if (!accepted.length) return;
    setUploads((current) => [...current, ...accepted].slice(0, 10));
    for (const item of accepted) void uploadComposerAttachment(item.localId, item.file);
  }

  async function uploadComposerAttachment(localId: string, file: File) {
    setUploads((current) => current.map((item) => item.localId === localId ? { ...item, status: "uploading", attachment: undefined } : item));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/projects/${project.id}/upload`, { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Could not upload ${file.name}.`);
      setUploads((current) => current.map((item) => item.localId === localId
        ? { ...item, status: "uploaded", attachment: payload.attachment as Attachment }
        : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not upload ${file.name}.`;
      setUploads((current) => current.map((item) => item.localId === localId ? { ...item, status: "error", attachment: undefined } : item));
      toast.error(message);
    }
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Stop following a run's server-side continuation when the workspace unmounts.
  useEffect(() => () => {
    if (continueWatchRef.current) window.clearTimeout(continueWatchRef.current);
    if (consoleFlushTimerRef.current) window.clearTimeout(consoleFlushTimerRef.current);
  }, []);

  // Keep the isBuilding ref in step for async callbacks (the approval watcher) that read it later.
  useEffect(() => {
    isBuildingRef.current = isBuilding;
  }, [isBuilding]);

  // Security mode: restore this project's Auto / Request review choice, unless the home page just chose one.
  useEffect(() => {
    if (!security) return;
    try {
      if (initialApprovalMode) {
        window.localStorage.setItem(`cognix:approval-mode:${initialProject.id}`, initialApprovalMode);
        return;
      }
      const saved = window.localStorage.getItem(`cognix:approval-mode:${initialProject.id}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser-only preference after hydration
      if (saved === "review" || saved === "auto") setApprovalMode(saved);
    } catch {
      // Blocked storage: keep the default.
    }
  }, [initialApprovalMode, initialProject.id, security]);

  // Follow new messages only while the reader is at the bottom. Scrolls the chat list itself:
  // scrollIntoView would also scroll every ancestor and shift the whole workspace off screen.
  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller || !chatPinnedRef.current) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: isBuilding && !prefersReducedMotion() ? "smooth" : "auto" });
  }, [messages, activities, isBuilding]);

  useEffect(() => {
    if (!initialProject.sandboxId || security) return;
    let cancelled = false;

    const wait = (delayMs: number) => new Promise((resolve) => window.setTimeout(resolve, delayMs));
    async function reconnectPreview() {
      setIsPreviewReconnecting(true);
      for (let attempt = 0; attempt < 36 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(`/api/projects/${initialProject.id}/preview`, { cache: "no-store" });
          const payload = await response.json();
          if (response.ok && typeof payload.url === "string") {
            if (cancelled) return;
            setVisualBridgeReady(false);
            setProject(payload.project
              ? { ...(payload.project as Project), previewUrl: payload.url }
              : (current) => ({ ...current, previewUrl: payload.url }));
            setPreviewRevision((current) => current + 1);
            setIsPreviewReconnecting(false);
            return;
          }
        } catch {
          // Keep retrying while Daytona wakes the sandbox and starts the dev server.
        }
        await wait(attempt < 6 ? 2_500 : 5_000);
      }
      if (!cancelled) setIsPreviewReconnecting(false);
    }

    void reconnectPreview();
    return () => {
      cancelled = true;
    };
  }, [initialProject.id, initialProject.sandboxId, security]);

  const currentPreviewUrl = project.previewUrl;
  const canPublish = Boolean(project.sandboxId || currentPreviewUrl);
  const resolvedPublishedUrl = publishedUrl && siteOrigin
    ? new URL(publishedUrl, siteOrigin).toString()
    : publishedUrl;
  const publishBaseLabel = appsDomain
    ? "https://"
    : siteOrigin
      ? `${new URL(siteOrigin).host}/publish/`
      : "/publish/";
  const publishDomainSuffix = appsDomain ? `.${appsDomain}` : undefined;
  const projectHost = useMemo(() => {
    if (!currentPreviewUrl) return "Preview will appear here";
    try { return new URL(currentPreviewUrl).host; } catch { return currentPreviewUrl; }
  }, [currentPreviewUrl]);
  const visibleActivities = useMemo(() => [
    ...activities.filter((activity) => activity.name === "read_attachment").slice(-2),
    ...activities.filter((activity) => activity.name !== "read_attachment").slice(-5),
  ], [activities]);
  const previewOrigin = useMemo(() => {
    if (!currentPreviewUrl) return null;
    try { return new URL(currentPreviewUrl).origin; } catch { return null; }
  }, [currentPreviewUrl]);
  const visualChannel = `${project.id}:visual-edit-v1`;

  const postVisualState = useCallback((enabled: boolean, selections: VisualElementSelection[]) => {
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (!frameWindow || !previewOrigin) return;
    frameWindow.postMessage(
      {
        source: VISUAL_EDIT_SOURCE,
        version: VISUAL_EDIT_VERSION,
        channelId: visualChannel,
        type: "configure",
        enabled,
        selections: selections.map((selection) => ({ id: selection.id, selector: selection.selector })),
      },
      previewOrigin,
    );
  }, [previewOrigin, visualChannel]);

  const postVisualElementPreview = useCallback(
    (selector: string, patch: { text?: string; className?: string }) => {
      const frameWindow = previewFrameRef.current?.contentWindow;
      if (!frameWindow || !previewOrigin) return;
      frameWindow.postMessage(
        {
          source: VISUAL_EDIT_SOURCE,
          version: VISUAL_EDIT_VERSION,
          channelId: visualChannel,
          type: "apply_live_preview",
          selector,
          ...patch,
        },
        previewOrigin,
      );
    },
    [previewOrigin, visualChannel],
  );

  const postVisualThemePreview = useCallback(
    (tokens: ThemeToken[]) => {
      const frameWindow = previewFrameRef.current?.contentWindow;
      if (!frameWindow || !previewOrigin) return;
      frameWindow.postMessage(
        {
          source: VISUAL_EDIT_SOURCE,
          version: VISUAL_EDIT_VERSION,
          channelId: visualChannel,
          type: "apply_theme_preview",
          tokens,
        },
        previewOrigin,
      );
    },
    [previewOrigin, visualChannel],
  );

  const flushConsoleBatch = useCallback(async () => {
    if (consoleFlushTimerRef.current) {
      window.clearTimeout(consoleFlushTimerRef.current);
      consoleFlushTimerRef.current = null;
    }
    if (security) return;
    while (pendingConsoleBatchRef.current.length > 0) {
      const batch = pendingConsoleBatchRef.current.splice(0, 60);
      try {
        const response = await fetch(`/api/projects/${project.id}/console`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: batch }),
        });
        if (response.ok) {
          const payload = await response.json().catch(() => null);
          if (payload && Array.isArray(payload.entries)) {
            setConsoleEntries(payload.entries as PreviewConsoleEntry[]);
          }
        }
      } catch {
        // Keep optimistic local entries even if background persistence transiently fails.
        break;
      }
    }
  }, [project.id, security]);

  const enqueueConsoleEntry = useCallback(
    (incoming: PreviewConsoleInput) => {
      if (security) return;
      if (incoming.level === "error" && isIgnorableConsoleError(incoming)) return;
      const fingerprint = computeConsoleFingerprint({
        source: incoming.source,
        level: incoming.level,
        message: incoming.message,
        statusCode: incoming.statusCode,
      });
      const createdAt = incoming.createdAt || new Date().toISOString();

      setConsoleEntries((current) => {
        const last = current.at(-1);
        if (last && last.fingerprint === fingerprint) {
          return [
            ...current.slice(0, -1),
            {
              ...last,
              repeatCount: last.repeatCount + 1,
              createdAt,
              stack: incoming.stack ?? last.stack,
              route: incoming.route ?? last.route,
              statusCode: incoming.statusCode ?? last.statusCode,
            },
          ];
        }
        return [
          ...current.slice(-299),
          {
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            projectId: project.id,
            source: incoming.source,
            level: incoming.level,
            message: incoming.message,
            stack: incoming.stack ?? null,
            route: incoming.route ?? null,
            statusCode: incoming.statusCode ?? null,
            fingerprint,
            repeatCount: 1,
            createdAt,
          },
        ];
      });

      pendingConsoleBatchRef.current.push(incoming);
      if (!consoleFlushTimerRef.current) {
        consoleFlushTimerRef.current = window.setTimeout(() => void flushConsoleBatch(), 900);
      }
    },
    [flushConsoleBatch, project.id, security],
  );

  const loadConsoleSnapshot = useCallback(
    async (options?: { wake?: boolean; silent?: boolean }) => {
      if (security) return;
      if (!options?.silent) {
        setConsoleLoading(true);
        setConsoleFetchError(null);
      }
      try {
        const response = await fetch(
          `/api/projects/${project.id}/console${options?.wake ? "?wake=1" : ""}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load console logs. Try refreshing.");
        }
        setConsoleFetchError(null);
        if (Array.isArray(payload.entries)) {
          setConsoleEntries(payload.entries as PreviewConsoleEntry[]);
        }
        if (typeof payload.serverLogs === "string") {
          setServerLogs(payload.serverLogs);
        }
      } catch (error) {
        if (!options?.silent) {
          setConsoleFetchError(
            error instanceof Error ? error.message : "Could not load console logs. Try refreshing.",
          );
        }
      } finally {
        if (!options?.silent) setConsoleLoading(false);
      }
    },
    [project.id, security],
  );

  const clearConsoleLogs = useCallback(async () => {
    pendingConsoleBatchRef.current = [];
    setConsoleEntries([]);
    setServerLogs("");
    setDismissedErrorFingerprints(new Set());
    try {
      const response = await fetch(`/api/projects/${project.id}/console`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear console.");
    } catch {
      toast.error("Could not clear saved console logs. Try again.");
    }
  }, [project.id]);

  useEffect(() => {
    function handleVisualMessage(event: MessageEvent) {
      if (!previewOrigin || event.origin !== previewOrigin || event.source !== previewFrameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const message = data as Record<string, unknown>;
      if (message.source !== VISUAL_EDIT_SOURCE || message.version !== VISUAL_EDIT_VERSION) return;

      if (message.type === "console_entry") {
        const parsedEntry = previewConsoleInputSchema.safeParse(message.entry);
        if (parsedEntry.success) {
          enqueueConsoleEntry(parsedEntry.data);
        }
        return;
      }

      if (message.type === "ready") {
        setVisualBridgeReady(true);
        postVisualState(visualEditEnabled, visualSelections);
        return;
      }
      if (message.channelId !== visualChannel) return;

      if (message.type === "element_selected") {
        const parsed = visualElementSelectionSchema.safeParse(message.selection);
        if (!parsed.success) return;
        setVisualSelections((current) => applyVisualSelection(current, parsed.data, message.append === true));
        return;
      }
      if (message.type === "closed") {
        setVisualEditEnabled(false);
        return;
      }
      if (message.type === "route_changed") {
        setVisualSelections([]);
      }
    }

    window.addEventListener("message", handleVisualMessage);
    return () => window.removeEventListener("message", handleVisualMessage);
  }, [enqueueConsoleEntry, postVisualState, previewOrigin, visualChannel, visualEditEnabled, visualSelections]);

  // Keep server-side runtime logs & errors synced while preview is live or Console is open
  useEffect(() => {
    if (security || !currentPreviewUrl || isPreviewReconnecting || isBuilding) return;
    const initialTimer = window.setTimeout(() => {
      void loadConsoleSnapshot({ silent: true });
    }, 150);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadConsoleSnapshot({ silent: true });
      }
    }, 12_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [currentPreviewUrl, isBuilding, isPreviewReconnecting, loadConsoleSnapshot, security]);

  useEffect(() => {
    if (visualBridgeReady) postVisualState(visualEditEnabled, visualSelections);
  }, [postVisualState, visualBridgeReady, visualEditEnabled, visualSelections]);

  const toggleVisualEdit = useCallback(async () => {
    if (visualEditEnabled) {
      postVisualState(false, visualSelections);
      setVisualEditEnabled(false);
      return;
    }
    if (!currentPreviewUrl || visualEditConnecting) return;

    setVisualEditConnecting(true);
    setActiveTab("preview");
    setLastTab("preview");
    try {
      const response = await fetch(`/api/projects/${project.id}/visual-edit`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload.error ?? "Visual selection could not connect to this preview.");
      }
      setVisualBridgeReady(false);
      setProject((current) => ({ ...current, previewUrl: payload.url }));
      setPreviewRevision((current) => current + 1);
      setVisualEditEnabled(true);
      toast.message("Select an element in the preview. Hold Ctrl or Cmd to select more.");
    } catch (error) {
      setVisualEditEnabled(false);
      toast.error(error instanceof Error ? error.message : "Visual selection could not connect to this preview.");
    } finally {
      setVisualEditConnecting(false);
    }
  }, [currentPreviewUrl, postVisualState, project.id, visualEditConnecting, visualEditEnabled, visualSelections]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "s" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']")) return;
      if (activeTab !== "preview" || !currentPreviewUrl || security) return;
      event.preventDefault();
      void toggleVisualEdit();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeTab, currentPreviewUrl, security, toggleVisualEdit]);

  useEffect(() => {
    if (!visualEditEnabled || visualEditConnecting || visualBridgeReady) return;
    const timeout = window.setTimeout(() => {
      postVisualState(false, visualSelections);
      setVisualEditEnabled(false);
      toast.error("The preview selector did not connect. Refresh the preview and try again.");
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [postVisualState, visualBridgeReady, visualEditConnecting, visualEditEnabled, visualSelections]);

  const submitPrompt = useCallback(
    async (
      value: string,
      preuploadedIds: string[] = [],
      referencedSelections: VisualElementSelection[] = visualSelections,
      overrideChatMode?: BuildChatMode,
      options?: { preserveComposer?: boolean },
    ) => {
      const cleanPrompt = value.trim();
      const effectiveChatMode: BuildChatMode = security ? "build" : (overrideChatMode ?? chatMode);
      const ignoreComposer = options?.preserveComposer === true;
      if (!cleanPrompt || isBuilding) return;
      if (!ignoreComposer) {
        if (uploads.some((item) => item.status === "uploading")) {
          toast.message("Wait for the image upload to finish before sending.");
          return;
        }
        if (uploads.some((item) => item.status === "error" || !item.attachment)) {
          toast.error("Remove or retry failed attachments before sending.");
          return;
        }
      }
      const uploadedAttachments = ignoreComposer
        ? []
        : uploads.flatMap((item) => (item.attachment ? [item.attachment] : []));
      const attachmentIds = [...preuploadedIds, ...uploadedAttachments.map((item) => item.id)];
      const selectedElements = ignoreComposer ? [] : referencedSelections;
      setIsBuilding(true);
      if (effectiveChatMode === "build") {
        setErrorBaselineIso(new Date().toISOString());
      }
      setProject((current) => ({ ...current, status: "building" }));
      if (!ignoreComposer) setPrompt("");
      // A new run starts: drop any approval left over from a previous (possibly disconnected) run, and stop
      // following an earlier run's server-side continuation.
      setPendingApproval(null);
      if (continueWatchRef.current) {
        window.clearTimeout(continueWatchRef.current);
        continueWatchRef.current = null;
      }
      setActivities([
        {
          id: "status",
          name: "status",
          label: effectiveChatMode === "plan" ? "Inspecting project to prepare plan" : "Preparing your build",
          status: "running",
        },
      ]);

      const userMessage: Message = {
        id: `local-user-${Date.now()}`,
        projectId: project.id,
        role: "user",
        content: cleanPrompt,
        metadata: {
          attachmentIds,
          attachments: uploadedAttachments.map((item) => ({
            id: item.id,
            name: item.name,
            contentType: item.contentType,
            size: item.size,
          })),
          visualSelections: selectedElements,
        },
        createdAt: new Date().toISOString(),
      };
      const assistantId = `local-assistant-${Date.now()}`;
      const assistantMessage: Message = {
        id: assistantId,
        projectId: project.id,
        role: "assistant",
        content: "",
        metadata: { streaming: true },
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, userMessage, assistantMessage]);

      try {
        if (!ignoreComposer) setUploads([]);

        const response = await fetch(`/api/projects/${project.id}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: cleanPrompt,
            attachmentIds,
            visualSelections: selectedElements,
            ...(security ? { approvalMode } : { chatMode: effectiveChatMode }),
          }),
        });
        if (!response.ok || !response.body) {
          const payload = await response.json();
          throw new Error(payload.error ?? "The build could not start.");
        }
        postVisualState(false, []);
        setVisualEditEnabled(false);
        setVisualSelections([]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (event: AgentEvent) => {
          if (event.type === "heartbeat") return;
          if (event.type === "token") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + event.value } : message,
              ),
            );
          }
          if (event.type === "status") {
            setActivities((current) => [
              ...current.map((item) => ({ ...item, status: "done" as const })),
              { id: `status-${Date.now()}`, name: "status", label: event.label, status: "running" },
            ]);
          }
          if (event.type === "tool_start") {
            const friendlyToolName =
              event.name === "neon_database"
                ? "Cloud Database"
                : event.name === "resend_email"
                  ? "Cloud Emails"
                  : event.name === "cloud_storage"
                    ? "Cloud Storage"
                    : event.name === "read_cloud_guide"
                      ? "Reading Cloud guide"
                      : event.name === "read_design_guide"
                        ? "Reading design guide"
                        : event.name === "request_cognix_cloud"
                          ? "Cognix Cloud"
                          : event.name === "read_preview_console"
                            ? "Reading preview console"
                            : event.name.replaceAll("_", " ");
            setActivities((current) => [
              ...current.map((item) => ({ ...item, status: "done" as const })),
              { id: event.id, name: event.name, label: friendlyToolName, status: "running", target: activityTarget(event.name, event.input) },
            ]);
          }
          if (event.type === "approval_request") setPendingApproval(event.approval);
          if (event.type === "approval_resolved") setPendingApproval((current) => (current?.id === event.id ? null : current));
          if (event.type === "tool_result") {
            setActivities((current) =>
              current.map((item) => item.id === event.id ? { ...item, label: event.summary, status: "done" } : item),
            );
          }
          if (event.type === "command_start") {
            setLiveCommands((current) => [
              ...current,
              {
                id: event.id,
                command: event.command,
                source: event.source,
                background: event.background,
                exitCode: null,
                output: "",
                failed: false,
                startedAt: new Date().toISOString(),
                durationMs: 0,
                running: true,
              },
            ]);
          }
          if (event.type === "command_end") {
            setLiveCommands((current) => current.map((item) => item.id === event.id
              ? { ...item, exitCode: event.exitCode, output: event.output, failed: event.failed, durationMs: event.durationMs, running: false }
              : item));
          }
          if (event.type === "attachment_start") {
            setActivities((current) => [
              ...current.map((item) => ({ ...item, status: "done" as const })),
              { id: `attachment-${event.id}`, name: "read_attachment", label: `Reading ${event.path}`, status: "running" },
            ]);
          }
          if (event.type === "attachment_ready") {
            setActivities((current) => current.map((item) => item.id === `attachment-${event.id}`
              ? { ...item, label: `Read ${event.path} · Ready at ${event.appUrl}`, status: "done" }
              : item));
          }
          if (event.type === "cloud_status") {
            setCloudEnabled(event.enabled);
          }
          if (event.type === "preview") {
            setVisualBridgeReady(false);
            setProject((current) => ({
              ...current,
              previewUrl: event.url,
              sandboxId: event.sandboxId ?? current.sandboxId,
              status: "ready",
            }));
            setPreviewRevision((current) => current + 1);
            setActiveTab("preview");
            setLastTab("preview");
          }
          if (event.type === "files_changed") {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) return message;
                const existing = Array.isArray(message.metadata.changedPaths)
                  ? message.metadata.changedPaths.filter((item): item is string => typeof item === "string")
                  : [];
                return {
                  ...message,
                  metadata: { ...message.metadata, changedPaths: [...new Set([...existing, ...event.paths])] },
                };
              }),
            );
            void fetch(`/api/projects/${project.id}/files`)
              .then((result) => result.json())
              .then((payload) => payload.files && setFiles(payload.files));
          }
          if (event.type === "done") {
            // The finished build saves its commands on the message, which the terminal reads from now on.
            if (event.commands) setLiveCommands([]);
            if (event.github) setGithubRefreshKey((current) => current + 1);
            void loadConsoleSnapshot({ silent: true });
            setProject((current) => ({
              ...current,
              status:
                current.status === "published" || current.publishedAt
                  ? "published"
                  : event.chatMode === "plan" && !current.previewUrl
                    ? "draft"
                    : "ready",
            }));
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      id: event.messageId,
                      metadata: {
                        ...message.metadata,
                        streaming: false,
                        ...(event.changedPaths ? { changedPaths: event.changedPaths } : {}),
                        ...(event.fileChanges ? { fileChanges: event.fileChanges } : {}),
                        ...(event.activity ? { activity: event.activity } : {}),
                        ...(event.commands ? { commands: event.commands } : {}),
                        ...(event.questions ? { questions: event.questions } : {}),
                        ...(event.github ? { github: event.github } : {}),
                        ...(event.chatMode ? { chatMode: event.chatMode } : {}),
                        ...(typeof event.runDurationMs === "number" ? { runDurationMs: event.runDurationMs } : {}),
                      },
                    }
                  : message,
              ),
            );
          }
          if (event.type === "error") throw new Error(event.message);
        };

        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) handleEvent(JSON.parse(line) as AgentEvent);
            newline = buffer.indexOf("\n");
          }
        }

        setActivities((current) => current.map((item) => ({ ...item, status: "done" })));
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "";
        const message = /failed to fetch|network|load failed|quic|aborted/i.test(rawMessage)
          ? "The live build connection dropped while Cognix was working. Your sandbox may still be saving changes; wait a moment, refresh the project, then continue the build."
          : rawMessage || "The build paused. Try again.";
        setProject((current) => ({ ...current, status: "error" }));
        toast.error(message);
        setMessages((current) =>
          current.map((item) => item.id === assistantId ? { ...item, content: item.content || message, metadata: { error: true } } : item),
        );
      } finally {
        setIsBuilding(false);
        // Don't clear a pending approval here: if the stream merely dropped, the agent is still waiting
        // server-side (it polls the database), so the card must stay answerable. It is cleared by the
        // approval_resolved event, and reset when the next prompt starts.
        setLiveCommands((current) => current.map((item) => (item.running ? { ...item, running: false } : item)));
      }
    },
    [approvalMode, chatMode, isBuilding, loadConsoleSnapshot, postVisualState, project.id, security, uploads, visualSelections],
  );

  async function restoreCheckpoint(message: Message) {
    const checkpoint = checkpointCanRestore(message);
    if (!checkpoint.canRestore || restoringMessageId || isBuilding) return;
    const confirmed = window.confirm(
      `Restore the project to before this build? ${checkpoint.changes.length} ${checkpoint.changes.length === 1 ? "file" : "files"} will be reverted.`,
    );
    if (!confirmed) return;

    setRestoringMessageId(message.id);
    try {
      const response = await fetch(`/api/projects/${project.id}/checkpoints/${message.id}/restore`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "This checkpoint could not be restored.");
      setMessages((current) => [
        ...current.map((item) => item.id === message.id
          ? { ...item, metadata: { ...item.metadata, restoredAt: payload.restoredAt } }
          : item),
        payload.message as Message,
      ]);
      if (Array.isArray(payload.files)) setFiles(payload.files as ProjectFile[]);
      if (payload.project) setProject(payload.project as Project);
      if (typeof payload.previewUrl === "string") {
        setProject((current) => ({ ...current, previewUrl: payload.previewUrl, status: "ready" }));
        setPreviewRevision((current) => current + 1);
      }
      setDetailsMessage(null);
      setGithubRefreshKey((current) => current + 1);
      if (security) {
        toast.success("Checkpoint restored.");
        return;
      }
      setActiveTab("preview");
      setLastTab("preview");
      toast.success("Checkpoint restored. The preview is updating.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This checkpoint could not be restored.");
    } finally {
      setRestoringMessageId(null);
    }
  }

  useEffect(() => {
    if (!initialTab && !githubResult) return;
    const url = new URL(window.location.href);
    for (const key of ["tab", "github", "github_error"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const result = githubResult ? GITHUB_RESULT_MESSAGES[githubResult] ?? GITHUB_RESULT_MESSAGES.error : null;
    if (result) toast[result.kind](result.text);
  }, [githubResult, initialTab]);

  useEffect(() => {
    if (!initialPrompt) return;
    const cleanLocation = stripInitialBuildParams(window.location.href);
    window.history.replaceState(window.history.state, "", cleanLocation);
    if (startedInitialPrompt.current) return;
    if (hasPersistedPrompt(initialMessages, initialPrompt)) {
      startedInitialPrompt.current = true;
      return;
    }
    window.queueMicrotask(() => {
      if (startedInitialPrompt.current) return;
      startedInitialPrompt.current = true;
      void submitPrompt(initialPrompt, initialAttachmentIds);
    });
  }, [initialPrompt, initialAttachmentIds, initialMessages, submitPrompt]);

  async function refreshPreview() {
    setIsPreviewReconnecting(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/preview`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Preview is not ready yet.");
      setVisualBridgeReady(false);
      setProject(payload.project
        ? { ...(payload.project as Project), previewUrl: payload.url }
        : (current) => ({ ...current, previewUrl: payload.url }));
      setPreviewRevision((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview is not ready yet.");
    } finally {
      setIsPreviewReconnecting(false);
    }
  }

  async function publishProject() {
    if (isPublishing) return;
    setIsPublishing(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: publishSlug }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Run the app successfully before publishing it.");
      setProject(payload.project);
      setPublishedUrl(payload.url);
      if (response.status === 202 || payload.publishing === true) {
        toast.message("Publishing started. Waiting for the production build…");
        await pollPublication(publishSlug, payload.url);
        setDomainRefreshKey((current) => current + 1);
        toast.success(project.publishedAt ? "Publication updated." : "App published.");
        return;
      }
      setDomainRefreshKey((current) => current + 1);
      toast.success(project.publishedAt ? "Publication updated." : "App published.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish this project.");
    } finally {
      setIsPublishing(false);
    }
  }

  async function pollPublication(targetSlug: string, targetUrl: string) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
      const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not check publishing status.");
      const nextProject = payload.project as Project;
      setProject(nextProject);
      if (Array.isArray(payload.messages)) setMessages(payload.messages as Message[]);
      if (nextProject.status === "published" && nextProject.publishedAt && nextProject.publishSlug === targetSlug) {
        setPublishedUrl(targetUrl);
        return;
      }
      if (nextProject.status === "error") {
        throw new Error("Production deployment failed. Check the latest assistant message, fix the issue, and publish again.");
      }
    }
    throw new Error("Publishing is still running. Refresh this project in a moment to check the result.");
  }

  async function unpublishProject() {
    if (isPublishing || !project.publishedAt) return;
    if (!window.confirm("Unpublish this app? Its public URL will stop working and sandbox auto-stop will be restored.")) return;
    setIsPublishing(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/publish`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not unpublish this app.");
      setProject(payload.project);
      toast.success("App unpublished. Sandbox auto-stop is enabled again.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unpublish this app.");
    } finally {
      setIsPublishing(false);
    }
  }

  async function shareProject() {
    try {
      const response = await fetch(`/api/projects/${project.id}/preview`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload.error ?? "Build the app before sharing its preview.");
      }
      setProject(payload.project
        ? { ...(payload.project as Project), previewUrl: payload.url }
        : (current) => ({ ...current, previewUrl: payload.url }));
      await navigator.clipboard.writeText(payload.url);
      toast.success("Fresh preview link copied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Build the app before sharing its preview.");
    }
  }

  function openFile(path: string) {
    setSelectedCodePath(path);
    openTab("code");
  }

  /** Opens an agent action in the workspace pane: files in Files, commands in Shell, PR proposals in Git Control. */
  function canOpenActivity(item: RunChipActivity) {
    return (
      FILE_TOOLS.has(item.name) ||
      BROWSE_TOOLS.has(item.name) ||
      SHELL_TOOLS.has(item.name) ||
      item.name === "neon_database" ||
      item.name === "resend_email" ||
      item.name === "cloud_storage" ||
      item.name === "read_preview_console" ||
      item.name === "propose_pull_request"
    );
  }

  function openActivity(item: RunChipActivity) {
    if (FILE_TOOLS.has(item.name) && item.target && files.some((file) => file.path === item.target)) openFile(item.target);
    else if (FILE_TOOLS.has(item.name) || BROWSE_TOOLS.has(item.name)) openTab("code");
    else if (SHELL_TOOLS.has(item.name)) openTab("terminal");
    else if (item.name === "read_preview_console") {
      showTab("preview");
      setConsoleDrawerOpen(true);
      void loadConsoleSnapshot({ wake: true, silent: true });
    }
    else if (item.name === "neon_database" || item.name === "resend_email" || item.name === "cloud_storage") openTab("cloud");
    else if (item.name === "propose_pull_request") openTab("git");
  }

  /** After a push from Security mode: the chat gains a note and the project's branch and commit change. */
  async function reloadProjectState() {
    try {
      const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (Array.isArray(payload.messages)) setMessages(payload.messages as Message[]);
      if (payload.project) setProject((current) => ({ ...(payload.project as Project), previewUrl: current.previewUrl }));
    } catch {
      toast.error("The push worked, but the page couldn't refresh. Reload the page to see the latest state.");
    }
  }

  /**
   * After the user answers an approval whose live stream has already ended (the request timed out while the
   * agent waited), the agent keeps running on the server with no socket to push to. Poll the conversation so
   * the earlier messages stay put and the continuation appears, until the run is no longer building.
   */
  function watchContinuingRun() {
    if (continueWatchRef.current) return;
    let attempts = 0;
    const stop = () => {
      if (continueWatchRef.current) {
        window.clearTimeout(continueWatchRef.current);
        continueWatchRef.current = null;
      }
    };
    const tick = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
        const payload = await response.json();
        const nextProject = payload.project as Project | undefined;
        // Never clobber a live stream: only adopt the server's messages when nothing is streaming here.
        if (!isBuildingRef.current && Array.isArray(payload.messages)) setMessages(payload.messages as Message[]);
        if (nextProject) {
          setProject((current) => ({ ...nextProject, previewUrl: current.previewUrl }));
          if (nextProject.status !== "building") {
            stop();
            return;
          }
        }
      } catch {
        // Keep trying; a transient failure shouldn't end the watch.
      }
      if (attempts >= 120) {
        stop();
        return;
      }
      continueWatchRef.current = window.setTimeout(() => void tick(), 3_000);
    };
    continueWatchRef.current = window.setTimeout(() => void tick(), 1_200);
  }

  /** The user allowed or denied a Request review action. Keep the chat visible and follow the agent's continuation. */
  function handleApprovalSent() {
    setPendingApproval(null);
    // If the live stream is still delivering, it will show the continuation itself. Otherwise, poll for it.
    if (!isBuildingRef.current) watchContinuingRun();
  }

  function openDetails(message: Message) {
    const paths = changedPathsFor(message);
    if (!paths.length) return;
    setDetailsMessage(message);
    setDetailsPath(paths[0]);
    openTab("git");
  }

  /** Turns Cognix Cloud on or off for the project. Returns whether the change was saved. */
  async function changeCloudEnabled(enabled: boolean, successMessage?: string) {
    if (cloudBusy) return false;
    setCloudBusy(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/cloud`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update Cognix Cloud. Try again.");
      setCloudEnabled(payload.enabled === true);
      if (typeof payload.warning === "string") toast.message(payload.warning);
      else toast.success(successMessage ?? (enabled ? "Cognix Cloud is on." : "Cognix Cloud is off."));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update Cognix Cloud. Try again.";
      toast.error(message);
      setCloudRequestError(message);
      return false;
    } finally {
      setCloudBusy(false);
    }
  }

  async function answerCloudRequest(enable: boolean) {
    setCloudRequestError(null);
    if (enable && !cloudEnabled && !(await changeCloudEnabled(true, "Cognix Cloud is on — continuing your build…"))) return;
    setChatMode("build");
    void submitPrompt(enable ? CLOUD_ENABLED_PROMPT : CLOUD_DECLINED_PROMPT, [], [], "build", { preserveComposer: true });
  }

  /**
   * Enables or disables Cognix Cloud from the Cloud panel, and when turned on, automatically sends
   * a wire-up instruction to the agent so Cognix connects Cloud services into the app right away.
   */
  async function handlePanelCloudToggle(enabled: boolean, feature?: CloudFeature) {
    if (enabled && isBuilding) {
      toast.message("Wait for the current build to finish before turning on Cognix Cloud.");
      return;
    }
    setCloudRequestError(null);
    const changed = await changeCloudEnabled(
      enabled,
      enabled ? "Cognix Cloud is on — wiring it into your app…" : undefined,
    );
    if (!changed || !enabled || security) return;
    const lastMessage = messages[messages.length - 1];
    const pendingCloudQuestion =
      lastMessage?.role === "assistant" ? questionRequestFor(lastMessage) : null;
    const wirePrompt =
      !feature && pendingCloudQuestion?.kind === "enable_cloud"
        ? CLOUD_ENABLED_PROMPT
        : cloudWireUpPromptFor(feature);
    setChatMode("build");
    void submitPrompt(wirePrompt, [], [], "build", { preserveComposer: true });
  }

  function askAgent(text: string) {
    setPrompt(text);
    requestAnimationFrame(() => {
      const composer = composerRef.current;
      if (!composer) return;
      composer.focus();
      composer.setSelectionRange(text.length, text.length);
    });
  }

  /** After GitHub changes land in the project: reload files and the chat (it gains a checkpoint), then the preview. */
  async function reloadAfterGitHubSync() {
    try {
      const [projectResponse, filesResponse] = await Promise.all([
        fetch(`/api/projects/${project.id}`, { cache: "no-store" }),
        fetch(`/api/projects/${project.id}/files`, { cache: "no-store" }),
      ]);
      const projectPayload = await projectResponse.json();
      const filesPayload = await filesResponse.json();
      if (Array.isArray(projectPayload.messages)) setMessages(projectPayload.messages as Message[]);
      if (Array.isArray(filesPayload.files)) setFiles(filesPayload.files as ProjectFile[]);
    } catch {
      toast.error("GitHub changes were synced, but the page couldn't refresh. Reload the page to see them.");
    }
    setPreviewRevision((current) => current + 1);
  }

  /** Opens the Cloud tab and moves focus to the public address, where publishing and domains are managed. */
  function openPublishSettings() {
    if (!isPublishing && !publishSlug) setPublishSlug(project.publishSlug ?? publishSlugFromTitle(project.title));
    openTab("cloud");
    setCloudFocusRequest((current) => current + 1);
  }

  const terminalEntries: TerminalEntry[] = [
    ...messages.flatMap((message) => commandsFor(message).map((command) => ({ ...command, running: false }))),
    ...liveCommands,
  ];
  const terminalRunning = liveCommands.some((item) => item.running);
  const consoleErrorCount = useMemo(
    () => (security ? 0 : consoleEntries.filter((entry) => entry.level === "error" && !isIgnorableConsoleError(entry)).length),
    [consoleEntries, security],
  );
  const actionableConsoleErrors = useMemo(
    () =>
      security
        ? []
        : selectActionableConsoleErrors(consoleEntries, {
            afterIso: errorBaselineIso,
            dismissedFingerprints: dismissedErrorFingerprints,
          }),
    [consoleEntries, dismissedErrorFingerprints, errorBaselineIso, security],
  );

  const handleFixConsoleErrors = useCallback(
    (targetErrors: PreviewConsoleEntry[]) => {
      if (!targetErrors.length || isBuilding || security) return;
      let nextAttempt = 1;
      for (const entry of targetErrors) {
        const prev = fixAttemptsByFingerprintRef.current.get(entry.fingerprint) ?? 0;
        const updated = prev + 1;
        fixAttemptsByFingerprintRef.current.set(entry.fingerprint, updated);
        if (updated > nextAttempt) nextAttempt = updated;
      }
      setErrorBaselineIso(new Date().toISOString());
      setChatMode("build");
      const fixPrompt = buildConsoleFixPrompt(targetErrors, nextAttempt);
      void submitPrompt(fixPrompt, [], [], "build", { preserveComposer: true });
    },
    [isBuilding, security, submitPrompt],
  );

  const dismissDetectedErrors = useCallback(() => {
    setDismissedErrorFingerprints((current) => {
      const next = new Set(current);
      for (const item of actionableConsoleErrors) next.add(item.fingerprint);
      return next;
    });
  }, [actionableConsoleErrors]);
  const builds: BuildCheckpoint[] = messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    const paths = changedPathsFor(message);
    if (!paths.length || message.metadata.streaming === true) return [];
    return [{
      message,
      summary: typeof message.metadata.summary === "string"
        ? message.metadata.summary
        : `Updated ${paths.length} ${paths.length === 1 ? "file" : "files"}`,
      fileCount: paths.length,
      canRestore: checkpointCanRestore(message).canRestore,
      restored: typeof message.metadata.restoredAt === "string",
    }];
  });
  const latestBuild = builds.reduce<BuildCheckpoint | null>(
    (latest, build) => (!latest || build.message.createdAt > latest.message.createdAt ? build : latest),
    null,
  );
  const tabs: ("preview" | ToolTab)[] = security ? [...openTabs] : ["preview", ...openTabs];
  // Like Lovable: the preview is always live; the published site only changes when the user publishes again.
  const lastChangeAt = messages.reduce<string | null>((latest, message) => {
    const changed = changedPathsFor(message).length > 0 || message.metadata.checkpointRestore === true;
    return changed && message.metadata.streaming !== true && (!latest || message.createdAt > latest) ? message.createdAt : latest;
  }, null);
  const hasUnpublishedChanges = Boolean(project.publishedAt && (isBuilding || (lastChangeAt && lastChangeAt > project.publishedAt)));
  const toolButton =
    "flex size-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11";
  const tabMeta = security ? SECURITY_TOOL_TABS : TOOL_TABS;
  const activeSuggestions = security ? securitySuggestions : suggestions;

  function chooseApprovalMode(next: ApprovalMode) {
    setApprovalMode(next);
    try {
      window.localStorage.setItem(`cognix:approval-mode:${project.id}`, next);
      window.localStorage.setItem("cognix:approval-mode:last", next);
    } catch {
      // Blocked storage: the choice still applies until the page reloads.
    }
  }

  return (
    <div className="workspace-frame">
      {skillCommands.dialogs}
      <HomeSidebar
        viewer={viewer}
        projects={projects}
        mobileOpen={sidebarOpen}
        onMobileOpenChange={setSidebarOpen}
        onNewChat={() => router.push("/")}
        defaultOpen={false}
        activeProjectId={project.id}
      />

      <Group orientation={isCompact ? "vertical" : "horizontal"} className="min-w-0 flex-1" id="cognix-workspace">
        <Panel
          id="chat"
          style={WORKSPACE_PANEL_STYLE}
          defaultSize={startCollapsed ? "100%" : isCompact ? "52%" : "38%"}
          minSize={isCompact ? "240px" : "340px"}
          maxSize={security ? "100%" : isCompact ? "72%" : "60%"}
        >
          <section className={cn("flex h-full min-h-0 flex-col", isCompact ? "p-2 pb-1" : "py-3 pl-3 pr-1", security && !paneOpen && "workspace-chat-wide")} aria-label="Chat">
            <div className="flex min-h-0 flex-1 flex-col overflow-clip rounded-2xl border border-white/[0.08] bg-[#1c1c1c]">
              <header className="chat-header">
                <div className="flex min-w-0 items-center gap-1">
                  <SidebarMobileTrigger onOpen={() => setSidebarOpen(true)} />
                  <div className="min-w-0">
                    <h1 className="truncate text-[13px] font-semibold">{project.title}</h1>
                    <p className="mt-0.5 text-[11px] text-white/40">{security ? (project.status === "building" ? "Working now" : project.securitySource ? `${project.securitySource.fullName} · ${project.securitySource.branch}` : "No repository attached") : project.status === "building" ? "Building now" : project.status === "publishing" ? "Publishing production" : project.status === "error" ? "Build needs attention" : hasUnpublishedChanges ? "Changes not published yet" : project.publishedAt ? "Published · up to date" : "All changes saved"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {security ? (
                    <span className="hidden items-center gap-1.5 text-[11px] text-white/35 sm:inline-flex">
                      <ShieldCheck className="size-3.5" aria-hidden="true" /> Security
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-white/35"><History className="size-3.5" /> Saved automatically</span>
                  )}
                  {security ? (
                    <button
                      type="button"
                      className={toolButton}
                      aria-expanded={paneOpen}
                      aria-controls="workspace-pane"
                      aria-label={paneOpen ? "Close the workspace pane" : "Open the workspace pane"}
                      title={paneOpen ? "Close the workspace pane" : "Open files, shell, secrets, and Git Control"}
                      onClick={() => {
                        if (paneOpen) {
                          collapsePane();
                          return;
                        }
                        if (!openTabs.length) setActiveTab("launcher");
                        expandPane();
                      }}
                    >
                      {paneOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                    </button>
                  ) : null}
                </div>
              </header>

              <div
                ref={chatScrollRef}
                className="chat-scroll"
                aria-live="polite"
                onScroll={(event) => {
                  const target = event.currentTarget;
                  chatPinnedRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
                }}
              >
                {messages.length === 0 && !isBuilding ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <MessageSquare className="size-5 text-white/30" aria-hidden="true" />
                    <p className="text-[13px] font-medium text-white/75">No messages yet</p>
                    <p className="max-w-xs text-[12px] leading-5 text-white/45">{security ? "Prompt the security agent to review, explain, or fix this repository." : "Describe what to build below. Cognix will write the code and show it in the preview."}</p>
                  </div>
                ) : null}
                {messages.map((message, messageIndex) => {
                  const summary = typeof message.metadata.summary === "string" ? message.metadata.summary : null;
                  const changedPaths = changedPathsFor(message);
                  const messageFileChanges = fileChangesFor(message);
                  const changeSummary = summary ?? (changedPaths.length
                    ? `Updated ${changedPaths.length} ${changedPaths.length === 1 ? "file" : "files"}`
                    : null);
                  const isStreamingMessage = message.metadata.streaming === true;
                  const messageImages = message.role === "user" ? imageAttachmentsFor(message) : [];
                  const messageSelections = message.role === "user" ? visualSelectionsFor(message) : [];
                  const checkpoint = checkpointCanRestore(message);
                  const wasRestored = typeof message.metadata.restoredAt === "string";
                  const previousUserMessage = message.metadata.error === true
                    ? [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === "user")
                    : undefined;
                  const isToolLimitError = message.metadata.error === true
                    && /reached its tool limit|execution budget/i.test(message.content);
                  const questionRequest = message.role === "assistant" ? questionRequestFor(message) : null;
                  const isLatestMessage = messageIndex === messages.length - 1;
                  return (
                    <article key={message.id} className={cn("chat-message", message.role === "user" ? "is-user" : "is-assistant")}>
                      {message.role === "user" ? (
                        <div className="user-message-bubble"><MessageImages images={messageImages} /><VisualSelectionReferences selections={messageSelections} /><UserMessageContent content={message.content} /></div>
                      ) : (
                        <div className="assistant-message-body">
                          {message.content ? <AssistantMessageContent content={assistantContent(message)} /> : isStreamingMessage ? <LoadingState label="Thinking" /> : null}
                          {changeSummary ? (
                            <div className="change-summary-card">
                              <div className="flex items-center gap-2">
                                <span className="grid size-6 place-items-center rounded-md bg-emerald-400/12 text-emerald-300"><Check className="size-3.5" /></span>
                                <strong>{changeSummary}</strong>
                                {wasRestored ? <span className="checkpoint-restored">Restored</span> : null}
                              </div>
                              {changedPaths.length ? (
                                <ul className="changed-path-list">
                                  {changedPaths.slice(0, 5).map((filePath) => {
                                    const wasDeleted = messageFileChanges.find((change) => change.path === filePath)?.after === null;
                                    return (
                                      <li key={filePath}>
                                        <button type="button" disabled={wasDeleted} onClick={() => openFile(filePath)}>
                                          <code>{filePath}</code>{wasDeleted ? <span>deleted</span> : null}
                                        </button>
                                      </li>
                                    );
                                  })}
                                  {changedPaths.length > 5 ? <li>+{changedPaths.length - 5} more</li> : null}
                                </ul>
                              ) : null}
                              <div className={cn("mt-3 grid gap-2", (security ? 1 : 2) + (checkpoint.canRestore ? 1 : 0) === 3 ? "grid-cols-3" : (security ? 1 : 2) + (checkpoint.canRestore ? 1 : 0) === 2 ? "grid-cols-2" : "grid-cols-1")}>
                                <button type="button" onClick={() => openDetails(message)} disabled={!changedPaths.length} title={changedPaths.length ? "Review edited files" : "No files changed in this build"}>Details</button>
                                {security ? null : <button type="button" onClick={() => showTab("preview")}>Preview</button>}
                                {checkpoint.canRestore ? (
                                  <button
                                    type="button"
                                    className="checkpoint-restore-button"
                                    onClick={() => void restoreCheckpoint(message)}
                                    disabled={Boolean(restoringMessageId) || isBuilding}
                                    title="Revert the files changed by this build"
                                  >
                                    {restoringMessageId === message.id ? <PixelLoader size="sm" /> : <RotateCcw className="size-3" />}
                                    {restoringMessageId === message.id ? "Restoring" : "Restore"}
                                  </button>
                                ) : null}
                              </div>
                              <GitHubCommitNote info={message.metadata.github} onOpen={() => openTab("git")} />
                            </div>
                          ) : null}
                          {security ? (
                            <RunChips
                              activities={runActivityFor(message)}
                              fileChanges={messageFileChanges}
                              canOpen={canOpenActivity}
                              onOpenActivity={openActivity}
                              onOpenFile={(filePath) => (files.some((file) => file.path === filePath) ? openFile(filePath) : openDetails(message))}
                            />
                          ) : (
                            <RunDetails message={message} />
                          )}
                          {questionRequest?.kind === "pull_request" ? (
                            <PullRequestCard
                              key={message.id}
                              projectId={project.id}
                              messageId={message.id}
                              proposal={questionRequest.proposal}
                              repository={project.securitySource?.fullName ?? null}
                              baseBranch={project.securitySource?.baseBranch ?? project.securitySource?.branch ?? null}
                              decision={pullRequestDecisions[message.id] ?? pullRequestDecisionFor(message.metadata)}
                              canAct={!isBuilding && !message.id.startsWith("local-")}
                              onDone={(decision) => {
                                setPullRequestDecisions((current) => ({ ...current, [message.id]: decision }));
                                if (decision?.status === "opened") {
                                  setGithubRefreshKey((current) => current + 1);
                                  void reloadProjectState();
                                }
                              }}
                            />
                          ) : null}
                          {questionRequest && questionRequest.kind !== "pull_request" && isLatestMessage && !isBuilding ? (
                            questionRequest.kind === "enable_cloud" ? (
                              cloudEnabled && !cloudBusy && !cloudRequestError ? (
                                <button
                                  type="button"
                                  onClick={() => void submitPrompt(CLOUD_ENABLED_PROMPT)}
                                  className="mt-3 inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:h-11"
                                >
                                  Cognix Cloud is on. Continue the build
                                </button>
                              ) : (
                                <CloudRequestCard
                                  reason={questionRequest.reason}
                                  featureLabels={questionRequest.features.map((feature) => CLOUD_FEATURES[feature].label)}
                                  busy={cloudBusy}
                                  error={cloudRequestError}
                                  onEnable={() => void answerCloudRequest(true)}
                                  onDecline={() => void answerCloudRequest(false)}
                                />
                              )
                            ) : (
                              <AgentQuestionCard
                                key={message.id}
                                questions={questionRequest.questions}
                                onSubmit={(answers) => void submitPrompt(formatAnswers(questionRequest, answers))}
                              />
                            )
                          ) : null}
                          {!security && message.metadata.chatMode === "plan" && !isStreamingMessage && !questionRequest && !isBuilding ? (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setChatMode("build");
                                  void submitPrompt(
                                    "Implement the approved plan above step by step, run the full production build, and verify the live preview.",
                                    [],
                                    [],
                                    "build",
                                  );
                                }}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [@media(pointer:coarse)]:h-11"
                              >
                                <Hammer className="size-3.5" aria-hidden="true" />
                                Build this plan
                              </button>
                            </div>
                          ) : null}
                          {message.metadata.error === true && previousUserMessage ? (
                            <button
                              type="button"
                              className="retry-build-button"
                              disabled={isBuilding}
                              onClick={() => void submitPrompt(
                                isToolLimitError
                                  ? "Continue and complete the previous request from the existing project files. Inspect what is already implemented, finish the missing requirements, run checks, and repair the live preview."
                                  : previousUserMessage.content,
                                attachmentIdsFor(previousUserMessage),
                                visualSelectionsFor(previousUserMessage),
                              )}
                            >
                              <RotateCcw className="size-3.5" /> {isToolLimitError ? "Continue build" : "Retry this build"}
                            </button>
                          ) : null}
                        </div>
                      )}
                      <time>{formatRelativeDate(message.createdAt, relativeNow)}</time>
                    </article>
                  );
                })}

                {isBuilding && activities.length && security ? (
                  <RunChips
                    live
                    activities={activities.map((activity) => ({ ...activity }))}
                    canOpen={canOpenActivity}
                    onOpenActivity={openActivity}
                    onOpenFile={openFile}
                  />
                ) : null}
                {security && pendingApproval ? (
                  <ApprovalCard key={pendingApproval.id} projectId={project.id} approval={pendingApproval} onSent={handleApprovalSent} />
                ) : null}
                {isBuilding && activities.length && !security ? (
                  <details className="agent-activity-card">
                    <summary title="Show build activity">
                      <span className="sr-only">Show build activity, {activities.length} steps</span>
                      <span className="activity-icon-strip" aria-hidden="true">
                        {visibleActivities.map((activity) => (
                          <span
                            key={activity.id}
                            className={cn("activity-icon", activity.status === "done" && "is-done")}
                            title={activity.label}
                          >
                            <ActivityIcon name={activity.name} running={activity.status === "running"} />
                          </span>
                        ))}
                      </span>
                      <ChevronDown className="activity-disclosure-icon size-3.5" aria-hidden="true" />
                    </summary>
                    <div className="agent-activity-list">
                      <p>Build activity</p>
                      {activities.map((activity) => (
                        <div key={activity.id} className="activity-row">
                          <span className={cn("activity-icon", activity.status === "done" && "is-done")}><ActivityIcon name={activity.name} running={activity.status === "running"} /></span>
                          <span className="truncate">{activity.label}</span>
                          {activity.status === "done" ? <Check className="ml-auto size-3.5 text-emerald-400" /> : null}
                        </div>
                      ))}
                      {terminalRunning ? (
                        <button type="button" className="mt-1 text-[11px] font-medium text-white/60 hover:text-white" onClick={() => openTab("terminal")}>
                          Watch in Terminal
                        </button>
                      ) : null}
                    </div>
                  </details>
                ) : null}
                <div ref={chatEndRef} />
              </div>
            </div>

            <div className="chat-composer-wrap shrink-0 pt-2">
              {!security && visualEditEnabled ? (
                <VisualEditInspector
                  projectId={project.id}
                  selections={visualSelections}
                  onPreviewElement={postVisualElementPreview}
                  onPreviewTheme={postVisualThemePreview}
                  onFileSaved={(saved) =>
                    setFiles((current) => {
                      const exists = current.some((item) => item.path === saved.path);
                      return exists
                        ? current.map((item) => (item.path === saved.path ? saved : item))
                        : [...current, saved].sort((a, b) => a.path.localeCompare(b.path));
                    })
                  }
                  onAskAiInstead={(nextPrompt) => {
                    setChatMode("build");
                    askAgent(nextPrompt);
                  }}
                  onClose={() => {
                    postVisualThemePreview([]);
                    postVisualState(false, visualSelections);
                    setVisualEditEnabled(false);
                  }}
                />
              ) : null}
              <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-0.5">
                {activeSuggestions.map((suggestion) => <button key={suggestion} type="button" className="suggestion-chip" onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}
              </div>
              <div className="rounded-2xl bg-white/[0.035]">
                <div
                  className={cn(
                    "relative rounded-xl border border-white/[0.12] bg-[#212121] px-3 pb-2 pt-3 transition-colors duration-200 focus-within:border-white/25",
                    isDraggingUpload && "border-white/30 bg-[#262626]",
                  )}
                  onDragEnter={(event) => { event.preventDefault(); setIsDraggingUpload(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingUpload(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDraggingUpload(false);
                    addUploads(Array.from(event.dataTransfer.files));
                  }}
                >
                  {visualSelections.length ? (
                    <div className="visual-composer-context">
                      <div className="visual-composer-heading">
                        <span><MousePointer2 className="size-3" /> {visualSelections.length} selected {visualSelections.length === 1 ? "element" : "elements"}</span>
                        <button type="button" onClick={() => { setVisualSelections([]); postVisualState(visualEditEnabled, []); }}>Clear</button>
                      </div>
                      <VisualSelectionReferences
                        selections={visualSelections}
                        onRemove={(id) => setVisualSelections((current) => current.filter((selection) => selection.id !== id))}
                      />
                    </div>
                  ) : null}
                  {uploads.length ? (
                    <div className="pending-upload-list" aria-label="Files ready to send">
                      {uploads.map((item) => (
                        <PendingUpload
                          key={item.localId}
                          file={item.file}
                          status={item.status}
                          uploadedUrl={item.attachment ? `/api/uploads/${item.attachment.id}` : undefined}
                          onRemove={() => setUploads((current) => current.filter((upload) => upload.localId !== item.localId))}
                          onRetry={() => void uploadComposerAttachment(item.localId, item.file)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {skillCommands.menu}
                  <textarea
                    ref={composerRef}
                    value={prompt}
                    rows={2}
                    placeholder={
                      security
                        ? "Ask about this repository, or type / for skills…"
                        : chatMode === "plan"
                          ? "Ask a question or plan a feature (read-only)…"
                          : "Ask anything, or type / for skills…"
                    }
                    aria-label={security ? "Message the security agent" : "Continue building this app"}
                    {...skillCommands.textareaProps}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      skillCommands.syncCaret(event);
                    }}
                    onPaste={(event) => {
                      const images = Array.from(event.clipboardData.items)
                        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                        .map((item) => item.getAsFile())
                        .filter((file): file is File => Boolean(file))
                        .map((file, index) => file.name
                          ? file
                          : new File([file], `pasted-image-${Date.now()}-${index + 1}.png`, { type: file.type || "image/png" }));
                      if (images.length) {
                        event.preventDefault();
                        addUploads(images);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (skillCommands.onKeyDown(event)) return;
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (!skillCommands.runCommand(prompt)) void submitPrompt(prompt);
                      }
                    }}
                    className="block max-h-[200px] min-h-[48px] w-full resize-none bg-transparent px-1.5 text-[14px] leading-6 text-white outline-none placeholder:text-white/40 [&:focus-visible]:outline-none"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-0.5">
                      <input ref={fileInputRef} className="sr-only" type="file" multiple accept={acceptedUploads} onChange={(event) => { addUploads(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
                      <button type="button" className={toolButton} aria-label="Attach files" title="Attach files" onClick={() => fileInputRef.current?.click()}><Plus className="size-4" /></button>
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Mention"
                        title="Mention"
                        onClick={() => {
                          setPrompt((current) => (current && !/\s$/.test(current) ? `${current} @` : `${current}@`));
                          composerRef.current?.focus();
                        }}
                      >
                        <AtSign className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      {security ? (
                        <ApprovalModeMenu value={approvalMode} onChange={chooseApprovalMode} disabled={isBuilding} />
                      ) : (
                        <BuildModeMenu value={chatMode} onChange={setChatMode} disabled={isBuilding} />
                      )}
                      <button
                        type="button"
                        onClick={voice.start}
                        className={cn(toolButton, voice.listening && "bg-red-500/15 text-red-400 hover:bg-red-500/20 hover:text-red-300")}
                        title="Voice dictation"
                        aria-label={voice.listening ? "Listening for dictation" : "Voice dictation"}
                        aria-pressed={voice.listening}
                      >
                        <Mic className="size-4" />
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full transition-colors duration-150 [@media(pointer:coarse)]:size-11",
                          prompt.trim() && !isBuilding && uploads.every((item) => item.status === "uploaded")
                            ? "bg-white text-black hover:bg-white/85"
                            : "cursor-not-allowed bg-white/[0.12] text-white/45",
                        )}
                        onClick={() => {
                          if (!skillCommands.runCommand(prompt)) void submitPrompt(prompt);
                        }}
                        disabled={!prompt.trim() || isBuilding || uploads.some((item) => item.status !== "uploaded")}
                        aria-label="Send prompt"
                        title={uploads.some((item) => item.status === "uploading") ? "Waiting for uploads" : uploads.some((item) => item.status === "error") ? "Retry or remove failed uploads" : "Send prompt"}
                      >
                        {isBuilding || uploads.some((item) => item.status === "uploading") ? <PixelLoader /> : <ArrowUp className="size-4 stroke-[2.25]" />}
                      </button>
                    </div>
                  </div>
                  {isDraggingUpload ? <div className="chat-drop-overlay"><ImagePlus className="size-5" /> Drop images or files here</div> : null}
                </div>
                {/* Security mode drops this footer row once the chat has started; the composer stands on its own. */}
                {security ? null : (
                <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-white/45">
                  <span className="truncate">Cognix can make mistakes. Check important info.</span>
                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    <button type="button" onClick={skillCommands.openMenu} className="rounded px-0.5 transition-colors hover:text-white/75" aria-label="Show skills and slash commands">
                      <kbd className="font-sans font-semibold text-white/70">/</kbd> skills
                    </button>
                    <span>
                      <kbd className="font-sans font-semibold text-white/70">@</kbd> mention
                    </span>
                  </div>
                </div>
                )}
              </div>
            </div>
          </section>
        </Panel>

        <Separator className={cn("workspace-resizer", security && !paneOpen && "is-collapsed")} />

        <Panel
          id="workbench"
          style={WORKSPACE_PANEL_STYLE}
          minSize={isCompact ? "180px" : "420px"}
          {...(security
            ? {
                collapsible: true,
                collapsedSize: "0%",
                panelRef: workbenchPanelRef,
                ...(startCollapsed ? { defaultSize: "0%" } : {}),
                onResize: (size: { asPercentage: number }) => setPaneOpen(size.asPercentage > 0.5),
              }
            : {})}
        >
          <section
            id="workspace-pane"
            className={cn("flex h-full min-h-0 flex-col", isCompact ? "p-2 pt-1" : "py-3 pl-1 pr-3")}
            aria-label="Workspace"
            hidden={security && !paneOpen}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-clip rounded-2xl border border-white/[0.1] bg-[#141414]">
              <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-2">
                <div role="tablist" aria-label="Workspace tabs" className="flex min-w-0 items-center gap-1 overflow-x-auto">
                  {tabs.map((tab) => {
                    const meta = tab === "preview" ? { label: "Preview", icon: Globe2 } : tabMeta[tab];
                    const selected = activeTab === tab;
                    return (
                      <div
                        key={tab}
                        className={cn(
                          "flex h-8 shrink-0 items-center rounded-lg transition-colors [@media(pointer:coarse)]:h-11",
                          selected ? "bg-white/[0.1] text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white",
                        )}
                      >
                        <button
                          ref={(node) => {
                            if (node) tabRefs.current.set(tab, node);
                            else tabRefs.current.delete(tab);
                          }}
                          type="button"
                          role="tab"
                          id={`workspace-tab-${tab}`}
                          aria-selected={selected}
                          aria-controls={`workspace-panel-${tab}`}
                          tabIndex={selected || (activeTab === "launcher" && lastTab === tab) ? 0 : -1}
                          onClick={() => showTab(tab)}
                          onKeyDown={(event) => onTabKeyDown(event, tab)}
                          className={cn("flex h-full items-center gap-2 rounded-lg text-[12.5px] font-medium", tab === "preview" ? "px-3" : "pl-3 pr-1")}
                        >
                          <meta.icon className="size-3.5" aria-hidden="true" />
                          {meta.label}
                          {tab === "terminal" && terminalRunning ? (
                            <span className="size-1.5 rounded-full bg-sky-400 animate-pulse motion-reduce:animate-none" aria-label="Running a command" />
                          ) : null}
                          {tab === "preview" && consoleErrorCount > 0 ? (
                            <span className="rounded-full bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 tabular-nums leading-none">
                              {consoleErrorCount}
                            </span>
                          ) : null}
                        </button>
                        {tab !== "preview" ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => closeTab(tab)}
                            aria-label={`Close ${meta.label}`}
                            title={`Close ${meta.label}`}
                            className="mr-0.5 grid size-8 place-items-center rounded-md text-white/45 hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:size-11"
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab !== "launcher") {
                      setActiveTab("launcher");
                      return;
                    }
                    if (security) {
                      const back = openTabs.find((tab) => tab === lastTab) ?? openTabs[0];
                      if (back) showTab(back);
                      else collapsePane();
                      return;
                    }
                    showTab(lastTab);
                  }}
                  aria-label="Open a tool"
                  aria-pressed={activeTab === "launcher"}
                  title={security ? "Open Shell, Files, Secrets, or Git Control" : "Open Terminal, Files/Code, Cloud, or Git Control"}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg transition-colors [@media(pointer:coarse)]:size-11",
                    activeTab === "launcher" ? "bg-white/[0.1] text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  <Plus className="size-4" />
                </button>

                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {project.sandboxId ? (
                    <a
                      className="toolbar-button toolbar-expandable"
                      href={`/api/projects/${project.id}/export`}
                      download
                      aria-label="Download project"
                      title="Download the project source without dependencies or secrets"
                    >
                      <Download className="size-3.5" /><span className="toolbar-control-label">Download</span>
                    </a>
                  ) : (
                    <button type="button" className="toolbar-button toolbar-expandable" disabled aria-label="Download project" title="Build the app before downloading it">
                      <Download className="size-3.5" /><span className="toolbar-control-label">Download</span>
                    </button>
                  )}
                  {security ? (
                    <button type="button" className={toolButton} onClick={collapsePane} aria-label="Close the workspace pane" title="Close the workspace pane">
                      <PanelRightClose className="size-4" />
                    </button>
                  ) : null}
                  {security ? null : <button type="button" className="toolbar-button toolbar-expandable" onClick={() => void shareProject()} disabled={!currentPreviewUrl} aria-label="Share preview" title={currentPreviewUrl ? "Copy preview link" : "Build the app to enable sharing"}><Share2 className="size-3.5" /><span className="toolbar-control-label">Share</span></button>}
                  {security ? null : <button
                    type="button"
                    className="publish-button toolbar-expandable relative"
                    onClick={openPublishSettings}
                    aria-label={project.status === "publishing" || isPublishing ? "Publishing app, open publish settings" : hasUnpublishedChanges ? "Update the published app with the latest changes" : project.publishedAt ? "Manage publication and domains" : "Publish app"}
                    title="Publishing and custom domains"
                  >
                    {project.status === "publishing" || isPublishing ? <PixelLoader /> : <Rocket className="size-3.5" />}
                    <span className="toolbar-control-label">{project.status === "publishing" || isPublishing ? "Publishing" : hasUnpublishedChanges ? "Update" : project.publishedAt ? "Published" : "Publish"}</span>
                    {hasUnpublishedChanges && !isPublishing ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-300" aria-hidden="true" /> : null}
                  </button>}
                </div>
              </header>

              <div className="relative min-h-0 flex-1">
                {/* Preview stays mounted behind other tabs so the running app does not reload. Security mode has no preview. */}
                {security ? null : (
                <div
                  role="tabpanel"
                  id="workspace-panel-preview"
                  aria-labelledby="workspace-tab-preview"
                  hidden={activeTab !== "preview"}
                  className="h-full min-h-0 flex-col data-[shown=true]:flex"
                  data-shown={activeTab === "preview"}
                >
                  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] px-2">
                    <label className="preview-device-select toolbar-expandable" title="Preview viewport">
                      <PreviewDeviceIcon device={previewDevice} />
                      <span className="toolbar-control-label">{previewDevice === "phone" ? "Phone" : previewDevice === "tablet" ? "Tablet" : "Desktop"}</span>
                      <select value={previewDevice} onChange={(event) => setPreviewDevice(event.target.value as PreviewDevice)} aria-label="Preview device">
                        <option value="phone">Phone</option>
                        <option value="tablet">Tablet</option>
                        <option value="desktop">Desktop</option>
                      </select>
                      <ChevronDown className="size-3" aria-hidden="true" />
                    </label>
                    <button
                      type="button"
                      className={cn("visual-edit-button toolbar-expandable", visualEditEnabled && "is-active")}
                      onClick={() => void toggleVisualEdit()}
                      disabled={!currentPreviewUrl || visualEditConnecting}
                      aria-pressed={visualEditEnabled}
                      aria-label={visualEditEnabled ? "Exit element selection" : "Select preview elements"}
                      title={visualEditEnabled ? "Exit element selection" : "Select elements in the preview (S)"}
                    >
                      {visualEditConnecting ? <PixelLoader /> : <MousePointer2 className="size-3.5" />}
                      <span className="toolbar-control-label">{visualEditEnabled ? "Done" : "Select"}</span>
                    </button>
                    <div className="preview-address">
                      <button type="button" aria-label="Refresh preview" onClick={() => void refreshPreview()} disabled={isPreviewReconnecting}>{isPreviewReconnecting ? <PixelLoader /> : <RefreshCw className="size-3.5" />}</button>
                      <span>{projectHost}</span>
                      {currentPreviewUrl ? <a href={currentPreviewUrl} target="_blank" rel="noreferrer" aria-label="Open preview in a new tab"><ExternalLink className="size-3.5" /></a> : null}
                    </div>
                    <button
                      type="button"
                      className={cn(
                        "visual-edit-button ml-auto gap-1.5 px-2.5",
                        consoleDrawerOpen && "is-active",
                        consoleErrorCount > 0 && !consoleDrawerOpen && "border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-400/60 hover:bg-rose-500/15",
                      )}
                      onClick={() => {
                        setConsoleDrawerOpen((open) => {
                          const next = !open;
                          if (next) void loadConsoleSnapshot({ wake: true, silent: true });
                          return next;
                        });
                      }}
                      aria-expanded={consoleDrawerOpen}
                      aria-controls="preview-console-drawer"
                      aria-label={
                        consoleErrorCount > 0
                          ? `Toggle sandbox console (${consoleErrorCount} ${consoleErrorCount === 1 ? "error" : "errors"})`
                          : "Toggle sandbox console"
                      }
                      title="Open live sandbox & preview console"
                    >
                      <SquareTerminal className="size-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline text-[11px] font-medium">Console</span>
                      {consoleErrorCount > 0 ? (
                        <span className="rounded-full bg-rose-500/30 px-1.5 py-0.5 text-[9.5px] font-semibold text-rose-100 tabular-nums leading-none">
                          {consoleErrorCount}
                        </span>
                      ) : null}
                    </button>
                  </div>
                  <div className="relative flex min-h-0 flex-1 flex-col">
                    <div className={cn("relative min-h-0 flex-1", consoleDrawerOpen && consoleExpanded && "hidden")}>
                      {currentPreviewUrl && !isPreviewReconnecting ? (
                        <div className={cn("preview-frame-wrap", `is-${previewDevice}`)}>
                          <div className="preview-device-stage">
                            <iframe
                              key={`${currentPreviewUrl}:${previewRevision}`}
                              ref={previewFrameRef}
                              title={`${project.title} ${previewDevice} preview`}
                              src={currentPreviewUrl}
                              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                              onLoad={() => postVisualState(visualEditEnabled, visualSelections)}
                            />
                          </div>
                          {visualEditEnabled ? (
                            <div className={cn("visual-edit-hint", !visualBridgeReady && "is-connecting")}>
                              {visualBridgeReady ? <MousePointer2 className="size-3.5" /> : <PixelLoader />}
                              <span>{visualBridgeReady ? "Click an element · Ctrl/Cmd-click to add · Esc to exit" : "Connecting element selector…"}</span>
                            </div>
                          ) : null}
                          <div className="preview-floating-tools"><button type="button" aria-label="Copy preview URL" title="Copy preview URL" onClick={() => { void navigator.clipboard.writeText(currentPreviewUrl); toast.success("Preview link copied."); }}><Copy className="size-4" /></button></div>
                        </div>
                      ) : <PreviewPlaceholder reconnecting={isPreviewReconnecting} />}

                      {!isBuilding && actionableConsoleErrors.length > 0 ? (
                        <div
                          role="status"
                          aria-live="polite"
                          className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-rose-500/35 bg-[#191215]/95 px-3.5 py-2.5 text-white shadow-2xl backdrop-blur-md transition-opacity motion-reduce:transition-none"
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-300" aria-hidden="true">
                            <AlertCircle className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <strong className="text-[12.5px] font-semibold text-rose-100 tabular-nums">
                                {actionableConsoleErrors.length === 1
                                  ? "Runtime error detected"
                                  : `${actionableConsoleErrors.length} runtime errors detected`}
                              </strong>
                              {actionableConsoleErrors[actionableConsoleErrors.length - 1]?.route ? (
                                <span className="truncate rounded-full bg-white/[0.08] px-2 py-0.5 font-mono text-[10px] text-white/65">
                                  {actionableConsoleErrors[actionableConsoleErrors.length - 1].route}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-white/70">
                              {actionableConsoleErrors[actionableConsoleErrors.length - 1]?.message}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setConsoleDrawerOpen(true);
                                setConsoleFilterRequest({ value: "errors", nonce: Date.now() });
                                void loadConsoleSnapshot({ wake: true, silent: true });
                              }}
                              className="inline-flex min-h-8 items-center rounded-lg border border-white/15 bg-white/[0.05] px-2.5 text-[11.5px] font-medium text-white/85 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
                            >
                              Logs
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFixConsoleErrors(actionableConsoleErrors)}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [@media(pointer:coarse)]:min-h-11"
                            >
                              <Sparkles className="size-3.5" aria-hidden="true" />
                              Fix error
                            </button>
                            <button
                              type="button"
                              onClick={dismissDetectedErrors}
                              aria-label="Dismiss runtime error alert"
                              title="Dismiss alert"
                              className="grid size-8 place-items-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c7dff] [@media(pointer:coarse)]:size-11"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {consoleDrawerOpen ? (
                      <div
                        id="preview-console-drawer"
                        className={cn(
                          "min-h-0 border-t border-white/[0.1]",
                          consoleExpanded ? "flex-1 border-t-0" : isCompact ? "h-52 shrink-0" : "h-64 shrink-0",
                        )}
                      >
                        <PreviewConsolePanel
                          entries={consoleEntries}
                          serverLogs={serverLogs}
                          loading={consoleLoading}
                          error={consoleFetchError}
                          isBuilding={isBuilding}
                          filterRequest={consoleFilterRequest}
                          onRefresh={() => void loadConsoleSnapshot({ wake: true })}
                          onClear={() => void clearConsoleLogs()}
                          onFixErrors={handleFixConsoleErrors}
                          expanded={consoleExpanded}
                          onToggleExpand={() => setConsoleExpanded((value) => !value)}
                          onCloseDrawer={() => {
                            setConsoleDrawerOpen(false);
                            setConsoleExpanded(false);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
                )}

                {/* Open tool tabs stay mounted so unsaved code edits and terminal scroll survive tab switches. */}
                {openTabs.includes("terminal") ? (
                  <div role="tabpanel" id="workspace-panel-terminal" aria-labelledby="workspace-tab-terminal" hidden={activeTab !== "terminal"} className="h-full">
                    <TerminalPanel
                      entries={terminalEntries}
                      isBuilding={isBuilding}
                      {...(security
                        ? {}
                        : {
                            serverLogs,
                            serverErrors: actionableConsoleErrors,
                            loadingServerLogs: consoleLoading,
                            onRefreshServerLogs: () => void loadConsoleSnapshot({ wake: true }),
                            onFixServerErrors: handleFixConsoleErrors,
                          })}
                    />
                  </div>
                ) : null}
                {openTabs.includes("code") ? (
                  <div role="tabpanel" id="workspace-panel-code" aria-labelledby="workspace-tab-code" hidden={activeTab !== "code"} className="h-full">
                    <CodeWorkbench
                      projectId={project.id}
                      files={files}
                      latestChanges={latestBuild ? fileChangesFor(latestBuild.message) : undefined}
                      selectedPath={selectedCodePath}
                      onSelectPath={openFile}
                      onFilesChange={setFiles}
                    />
                  </div>
                ) : null}
                {openTabs.includes("cloud") ? (
                  <div role="tabpanel" id="workspace-panel-cloud" aria-labelledby="workspace-tab-cloud" hidden={activeTab !== "cloud"} className="h-full">
                    {security ? (
                      <div className="h-full overflow-y-auto bg-[#0a0a0a]">
                        <SecretsPanel projectId={project.id} />
                      </div>
                    ) : (
                    <CloudPanel
                      project={project}
                      slug={publishSlug}
                      publishBaseLabel={publishBaseLabel}
                      publishDomainSuffix={publishDomainSuffix}
                      publishedAutoStopMinutes={publishedAutoStopMinutes}
                      publishedUrl={resolvedPublishedUrl}
                      canPublish={canPublish}
                      isPublishing={isPublishing}
                      isBuilding={isBuilding}
                      hasUnpublishedChanges={hasUnpublishedChanges}
                      domainRefreshKey={domainRefreshKey}
                      focusRequest={cloudFocusRequest}
                      cloudEnabled={cloudEnabled}
                      cloudBusy={cloudBusy}
                      onSetCloudEnabled={(enabled, feature) => void handlePanelCloudToggle(enabled, feature)}
                      onAskAgent={askAgent}
                      onProjectChange={(next) => {
                        if (!project.publishedAt && publishSlug === publishSlugFromTitle(project.title)) {
                          setPublishSlug(publishSlugFromTitle(next.title));
                        }
                        setProject((current) => ({ ...next, previewUrl: current.previewUrl }));
                      }}
                      onSlugChange={setPublishSlug}
                      onPublish={() => void publishProject()}
                      onUnpublish={() => void unpublishProject()}
                    />
                    )}
                  </div>
                ) : null}
                {openTabs.includes("git") ? (
                  <div role="tabpanel" id="workspace-panel-git" aria-labelledby="workspace-tab-git" hidden={activeTab !== "git"} className="h-full">
                    <GitPanel
                      builds={builds}
                      selectedId={detailsMessage?.id ?? null}
                      details={detailsMessage ? (
                        <ChangeDetails
                          changedPaths={changedPathsFor(detailsMessage)}
                          fileChanges={fileChangesFor(detailsMessage)}
                          files={files}
                          selectedPath={detailsPath}
                          onSelectPath={setDetailsPath}
                          onOpenFile={openFile}
                        />
                      ) : null}
                      projectId={project.id}
                      projectTitle={project.title}
                      githubRefreshKey={githubRefreshKey}
                      canCommit={Boolean(project.sandboxId) && !isBuilding}
                      onFilesChanged={() => void reloadAfterGitHubSync()}
                      restoringMessageId={restoringMessageId}
                      isBuilding={isBuilding}
                      relativeNow={relativeNow}
                      onSelect={openDetails}
                      onBack={() => setDetailsMessage(null)}
                      onRestore={(message) => void restoreCheckpoint(message)}
                      security={security ? {
                        source: project.securitySource,
                        onPushed: () => {
                          void reloadProjectState();
                        },
                      } : undefined}
                    />
                  </div>
                ) : null}
                {activeTab === "launcher" ? (
                  <ToolLauncher
                    openTabs={openTabs}
                    onOpen={openTab}
                    tools={tabMeta}
                    order={security ? SECURITY_TOOL_ORDER : TOOL_ORDER}
                    onCancel={() => {
                      if (!security) {
                        showTab(lastTab);
                        return;
                      }
                      const back = openTabs.find((tab) => tab === lastTab) ?? openTabs[0];
                      if (back) showTab(back);
                      else collapsePane();
                    }}
                  />
                ) : null}
              </div>
            </div>
          </section>
        </Panel>
      </Group>
    </div>
  );
}
