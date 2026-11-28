export type ProjectStatus = "draft" | "building" | "publishing" | "ready" | "published" | "error";

/** Who can open a project's live preview URL (independent of Published website access). */
export type PreviewAccessMode = "owner" | "public" | "private";

export type ProjectPreviewShare = {
  id: string;
  projectId: string;
  email: string;
  shareKey: string;
  note: string | null;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
};

export type PreviewAccessState = {
  mode: PreviewAccessMode;
  publicExpiresAt: string | null;
  publicActive: boolean;
  hasPasscode: boolean;
  accessVersion: number;
  activeUntil: string | null;
  previewUrl: string | null;
  isPublished: boolean;
  shares: ProjectPreviewShare[];
};

/** "build" projects make apps; "security" projects review a GitHub repository without changing it. */
export type ProjectMode = "build" | "security";

/** In Build projects: "build" edits code and updates the preview; "plan" inspects read-only and proposes a plan. */
export type BuildChatMode = "build" | "plan";

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
  /** Preview URL access policy: owner-only by default, 24h public, or private email invites. */
  previewAccessMode?: PreviewAccessMode;
  previewPublicExpiresAt?: string | null;
  previewHasPasscode?: boolean;
  previewAccessVersion?: number;
  previewActiveUntil?: string | null;
  /** Project-specific instructions ("Knowledge") automatically included in every Build/Plan prompt. */
  customInstructions?: string;
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

export type AuthMethod = "password" | "oauth" | "passwordless" | "sso";

export type Viewer = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
  authProvider?: string;
  authProviderLabel?: string;
  authMethod?: AuthMethod;
  authSubject?: string;
  isAdmin?: boolean;
};

export type SubscriptionStatus = "inactive" | "active" | "on_hold" | "cancelled" | "expired" | "failed";

export type CreditComplexityTier = "light" | "standard" | "heavy" | "extended";

export type UserSubscription = {
  userId: string;
  planCode: string;
  status: SubscriptionStatus;
  priceCents: number;
  currency: string;
  dodoCustomerId: string | null;
  dodoSubscriptionId: string | null;
  dodoProductId: string | null;
  monthlyCreditsHundredths: number;
  creditsBalanceHundredths: number;
  creditsUsedThisPeriodHundredths: number;
  lifetimeCreditsUsedHundredths: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastPaymentId: string | null;
  lastPaymentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreditUsageEvent = {
  id: string;
  userId: string;
  userEmail?: string;
  userName?: string | null;
  projectId: string | null;
  projectTitle?: string | null;
  messageId: string | null;
  mode: "build" | "plan" | "security";
  complexityTier: CreditComplexityTier;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  filesChanged: number;
  commandsRun: number;
  cloudActions: number;
  durationMs: number;
  creditsHundredths: number;
  description: string;
  createdAt: string;
};

export type AgentRunStage =
  | "sandbox"
  | "setup"
  | "scaffold"
  | "cloud"
  | "agent"
  | "model"
  | "tool"
  | "install"
  | "build"
  | "preview"
  | "probe"
  | "approval"
  | "verification"
  | "github"
  | "persistence";

export type AgentRunTurnMetric = {
  index: number;
  durationMs: number;
  attempts: number;
  messageChars: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  toolCalls: number;
};

export type AgentRunPerformance = {
  schemaVersion: 1;
  timeToFirstPreviewMs: number | null;
  stages: Partial<Record<AgentRunStage, number>>;
  model: {
    turns: number;
    attempts: number;
    durationMs: number;
    contextRefreshes: number;
    turnMetrics: AgentRunTurnMetric[];
  };
  tools: {
    calls: number;
    errors: number;
    durationMs: number;
    unchangedFileRereads?: number;
    byName: Record<string, { calls: number; errors: number; durationMs: number }>;
  };
  commands: {
    count: number;
    failed: number;
    durationMs: number;
    background: number;
    productionBuilds: number;
    installs: number;
    previewStarts: number;
    previewRestarts?: number;
  };
  architecture?: {
    scaffoldVersion: string;
    flags: Record<string, boolean>;
  };
};

export type AgentRunMetricStatus = "completed" | "checkpoint" | "awaiting_user" | "error";

export type AgentRunMetric = {
  id: string;
  projectId: string | null;
  userId: string;
  messageId: string | null;
  mode: "build" | "plan" | "security";
  status: AgentRunMetricStatus;
  errorCategory: string | null;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  performance: AgentRunPerformance;
  createdAt: string;
};

export type BillingSummary = {
  planName: string;
  priceCents: number;
  currency: string;
  monthlyCreditsHundredths: number;
  hasActiveAccess: boolean;
  isAdminBypass: boolean;
  dodoConfigured: boolean;
  subscription: UserSubscription;
  recentUsage: CreditUsageEvent[];
};

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  authProvider: string;
  authProviderLabel: string;
  authMethod: AuthMethod;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string;
  subscriptionStatus: SubscriptionStatus;
  dodoCustomerId: string | null;
  dodoSubscriptionId: string | null;
  creditsBalanceHundredths: number;
  creditsUsedThisPeriodHundredths: number;
  lifetimeCreditsUsedHundredths: number;
  monthlyCreditsHundredths: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  projectCount: number;
  agentRunCount: number;
  totalTokens: number;
};

export type AdminOverviewStats = {
  totalUsers: number;
  newUsersLast7Days: number;
  newUsersLast30Days: number;
  activeSubscribers: number;
  estimatedMrrCents: number;
  totalProjects: number;
  totalAgentRuns: number;
  totalCreditsUsedHundredths: number;
  totalTokens: number;
  providerBreakdown: {
    provider: string;
    label: string;
    method: AuthMethod;
    count: number;
    percentage: number;
  }[];
  methodBreakdown: {
    method: AuthMethod;
    label: string;
    count: number;
    percentage: number;
  }[];
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
  | { type: "cloud_status"; enabled: boolean }
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
      chatMode?: BuildChatMode;
      runDurationMs?: number;
      creditsChargedHundredths?: number;
      complexityTier?: CreditComplexityTier;
      totalTokens?: number;
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


export type AnalyticsDevice = "desktop" | "mobile" | "tablet";

export type AnalyticsEventRecord = {
  projectId: string;
  hostname: string;
  path: string;
  referrerHost: string | null;
  device: AnalyticsDevice;
  visitorHash: string;
  statusCode: number;
  createdAt?: string;
};

export type ProjectAnalyticsSummary = {
  days: number;
  totalPageviews: number;
  uniqueVisitors: number;
  dailySeries: { date: string; pageviews: number; visitors: number }[];
  topPaths: { path: string; views: number; visitors: number }[];
  topReferrers: { referrer: string; views: number }[];
  topHosts: { hostname: string; views: number }[];
  devices: { device: AnalyticsDevice; views: number; percentage: number }[];
};

export type PublishCheckSeverity = "critical" | "warning" | "info";

export type PublishCheckIssue = {
  id: string;
  category: "security" | "seo";
  severity: PublishCheckSeverity;
  title: string;
  detail: string;
  file?: string;
  line?: number;
  fixHint: string;
};

export type PublishCheckReport = {
  score: number;
  readyToPublish: boolean;
  checkedFileCount: number;
  checkedAt: string;
  securityIssues: PublishCheckIssue[];
  seoIssues: PublishCheckIssue[];
};

export type PreviewConsoleSource = "browser" | "network" | "server";
export type PreviewConsoleLevel = "log" | "info" | "warn" | "error";

export type PreviewConsoleEntry = {
  id: string;
  projectId: string;
  source: PreviewConsoleSource;
  level: PreviewConsoleLevel;
  message: string;
  stack: string | null;
  route: string | null;
  statusCode: number | null;
  fingerprint: string;
  repeatCount: number;
  createdAt: string;
};

export type PreviewConsoleInput = {
  source: PreviewConsoleSource;
  level: PreviewConsoleLevel;
  message: string;
  stack?: string | null;
  route?: string | null;
  statusCode?: number | null;
  createdAt?: string;
};
