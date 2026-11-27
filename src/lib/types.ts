export type ProjectStatus = "draft" | "building" | "publishing" | "ready" | "published" | "error";

/** "build" projects make apps; "security" projects review a GitHub repository without changing it. */
export type ProjectMode = "build" | "security";

/** The repository a security project reviews. Cognix's agent never pushes to it; the user commits and pushes from Git Control. */
export type SecuritySource = {
  fullName: string;
  /** Branch currently checked out in the sandbox. Changes are committed on top of it. */
  branch: string;
  /** The repository's default branch, used as the base for pull requests. */
  baseBranch?: string;
  private: boolean;
  /** Commit last imported into (or pushed from) the sandbox, or null before the first review. */
  importedSha: string | null;
  importedAt: string | null;
};

/**
 * How a security project's agent may act.
 * - auto: edits files and runs commands without asking; it still stops for questions it asks itself.
 * - review: asks the user before every file change or command.
 */
export type ApprovalMode = "auto" | "review";

/** One action the agent wants to take, waiting for the user's decision in Request review mode. */
export type AgentApprovalItem = {
  callId: string;
  tool: string;
  kind: "edit" | "command";
  /** Short line such as "Edit src/auth.ts" or "Run npm audit fix". */
  title: string;
  /** The change or command itself, trimmed for display. */
  detail: string;
};

export type AgentApprovalDecision = { callId: string; decision: "allow" | "deny"; note?: string };

export type AgentApprovalRequest = { id: string; items: AgentApprovalItem[]; createdAt: string };

/** A pull request the agent proposed. It opens only after the user approves it in the chat. */
export type PullRequestProposal = {
  title: string;
  body: string;
  /** New branch for the change; Cognix never pushes the agent's work to an existing branch. */
  branch: string;
  commitMessage: string;
};

export type Project = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  status: ProjectStatus;
  coverGradient: string;
  sandboxId: string | null;
  previewUrl: string | null;
  publishSlug: string | null;
  publishedAt: string | null;
  showBadge: boolean;
  publicRemix: boolean;
  mode: ProjectMode;
  securitySource: SecuritySource | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "tool";

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ProjectFile = {
  id: string;
  projectId: string;
  path: string;
  content: string | null;
  size: number;
  updatedAt: string;
};

export type FileChangeSnapshot = {
  path: string;
  before: string | null;
  after: string | null;
  truncated?: boolean;
};

export type AgentRunActivity = {
  id: string;
  name: string;
  label: string;
  status: "done" | "error";
  durationMs: number;
  /** What the tool acted on, such as a file path, command, or search query. */
  target?: string;
};

export type Attachment = {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  contentType: string;
  size: number;
  objectKey: string;
  sandboxPath: string | null;
  createdAt: string;
};

export type ProjectDomainStatus = "pending" | "active" | "error";

export type ProjectDomain = {
  id: string;
  projectId: string;
  ownerId: string;
  hostname: string;
  status: ProjectDomainStatus;
  verificationToken: string;
  managedByProvider: boolean;
  lastError: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DomainRecordType = "TXT" | "CNAME" | "A";

export type DomainDnsRecord = {
  type: DomainRecordType;
  name: string;
  value: string;
  ttl: number;
  purpose: "verification" | "routing";
  note?: string;
};

export type ProjectDomainView = ProjectDomain & {
  records: DomainDnsRecord[];
  url: string;
};

/** Whether this deployment has a public address that customer DNS records can point at. */
export type DomainSetup = {
  ready: boolean;
  cname: string | null;
  ipv4: string | null;
  /** Operator-facing explanation and recovery step when `ready` is false. */
  message: string | null;
};

export type Viewer = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
};

export type VisualElementSource = {
  file: string;
  line?: number;
  column?: number;
};

export type VisualElementComponent = {
  name: string;
  source?: VisualElementSource;
};

export type VisualElementSelection = {
  id: string;
  route: string;
  selector: string;
  tagName: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  styles?: {
    display?: string;
    position?: string;
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
    fontWeight?: string;
    borderRadius?: string;
  };
  componentStack?: VisualElementComponent[];
};

export type AgentEvent =
  | { type: "heartbeat"; at: string }
  | { type: "status"; label: string }
  | { type: "token"; value: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; summary: string }
  | { type: "command_start"; id: string; command: string; source: TerminalCommandSource; background: boolean }
  | { type: "command_end"; id: string; exitCode: number | null; output: string; failed: boolean; durationMs: number }
  | { type: "attachment_start"; id: string; path: string }
  | { type: "attachment_ready"; id: string; path: string; appUrl: string }
  | { type: "preview"; url: string; sandboxId?: string }
  | { type: "files_changed"; paths: string[] }
  /** Request review mode: the run waits until the user allows or denies these actions. */
  | { type: "approval_request"; approval: AgentApprovalRequest }
  | { type: "approval_resolved"; id: string; decisions: AgentApprovalDecision[] }
  | {
      type: "done";
      messageId: string;
      changedPaths?: string[];
      fileChanges?: FileChangeSnapshot[];
      activity?: AgentRunActivity[];
      commands?: TerminalCommand[];
      questions?: AgentQuestionRequest;
      github?: GitHubCommitInfo;
      runDurationMs?: number;
    }
  | { type: "error"; message: string };

/** Who started a terminal command: the agent's run_command tool, or Cognix's own install and server steps. */
export type TerminalCommandSource = "agent" | "system";

/** A command run in the project sandbox, shown read-only in the Terminal tab. Output is truncated and secret values are redacted. */
export type TerminalCommand = {
  id: string;
  command: string;
  source: TerminalCommandSource;
  background: boolean;
  exitCode: number | null;
  output: string;
  failed: boolean;
  startedAt: string;
  durationMs: number;
};

export type ProjectSecret = {
  id: string;
  projectId: string;
  name: string;
  managedBy: "user" | "cloud";
  updatedAt: string;
};

export type ProjectCloudStatus = "disabled" | "provisioning" | "ready" | "error";

export type ProjectCloud = {
  projectId: string;
  status: ProjectCloudStatus;
  neonProjectId: string | null;
  neonRegion: string | null;
  storageEnabled: boolean;
  appTokenHash: string | null;
  authEnabled: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillSource = "ai" | "github" | "manual";

export type Skill = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Editable fields of a skill, used for AI drafts, GitHub imports, and manual writing. */
export type SkillDraft = {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  sourceUrl: string | null;
};

export type AgentQuestion = {
  question: string;
  /** "single" shows radio options and advances on choice; "multiple" shows checkboxes. */
  type: "single" | "multiple";
  options: string[];
};

/** What the agent paused to ask. Stored on the assistant message and answered in the chat. */
export type AgentQuestionRequest =
  | { kind: "questions"; questions: AgentQuestion[] }
  | { kind: "enable_cloud"; reason: string; features: ("database" | "storage" | "auth" | "email")[] }
  | { kind: "pull_request"; proposal: PullRequestProposal };

/** The connected GitHub account. Never includes the access token. */
export type GitHubConnection = {
  ownerId: string;
  githubUserId: string;
  login: string;
  avatarUrl: string | null;
  scopes: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRepository = {
  projectId: string;
  ownerId: string;
  repoId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  autoCommit: boolean;
  syncBaseSha: string | null;
  syncedPaths: string[];
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
  lastPushedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What the browser sees about a linked repository. */
export type ProjectRepositoryView = Omit<ProjectRepository, "syncedPaths" | "ownerId">;

/** Result of a commit, saved on the build message when Cognix commits automatically. */
export type GitHubCommitInfo =
  | { status: "committed"; sha: string; url: string; filesChanged: number }
  | { status: "unchanged" }
  | { status: "diverged"; branch: string; url: string }
  | { status: "error"; message: string; code: string };

/**
 * How Cognix and the linked branch compare. `base` is the commit Cognix last synced with.
 * - in_sync: same files, same commit
 * - local_ahead: Cognix has changes GitHub doesn't
 * - remote_ahead: GitHub has commits Cognix doesn't
 * - diverged: both changed since the last sync
 */
export type GitSyncState = "in_sync" | "local_ahead" | "remote_ahead" | "diverged";

export type GitSyncStatus = {
  state: GitSyncState;
  branch: string;
  head: string;
  base: string | null;
  localChanges: number;
  remoteCommits: number;
  checkedAt: string;
};

/** A commit on the synced branch, labelled by which side of the two-way sync made it. */
export type RepositoryCommit = {
  sha: string;
  shortSha: string;
  title: string;
  author: string;
  avatarUrl: string | null;
  date: string;
  url: string;
  /** "cognix" for commits Cognix's agent made; "github" for commits pushed from anywhere else. */
  source: "cognix" | "github";
  /** False for GitHub commits Cognix hasn't pulled into the project yet. */
  inCognix: boolean;
};

/** Git details saved from the last fetch, so Git Control opens without waiting on GitHub. */
export type RepositoryCache = {
  sync: GitSyncStatus | null;
  commits: RepositoryCommit[] | null;
  /** When the commits were fetched; null when a push or pull made them out of date. */
  commitsFetchedAt: string | null;
};
