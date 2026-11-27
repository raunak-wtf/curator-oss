# CONTEXT.md — Cognix AI App Builder

Deep architectural reference for AI coding agents working in this repository. Pair this document with [AGENTS.md](AGENTS.md) for product and UI rules.

---

## 1. Product & High-Level Architecture

**Cognix** (also referred to as **Curator** in selected user-facing strings such as the published-app badge and `curator.codes` edge config) is a Next.js App Router host application that runs two distinct workspace modes per project:

1. **Build Mode (`mode: "build"`)** — Prompt-to-full-stack-app builder. Each project gets a dedicated Daytona Node.js sandbox where an OpenAI-compatible coding agent edits files, runs builds, and serves a live dev preview (port `3000`) plus immutable production releases (port `3001`), with Cognix Cloud guides, visual element selection, checkpoints/restore, custom domains, two-way GitHub sync, reusable `/skills`, and public remixing.
2. **Security Mode (`mode: "security"`, entry `/security-scanner`)** — Chat-first application security workspace for auditing and fixing a user's GitHub repository inside an isolated sandbox. The main agent independently performs reviews with its file, search, shell, process, and web tools, guided by the always-on first-party methodology in `src/lib/ai/security-methodology.ts` (quick/standard/deep/full profiles; recon, source and supply-chain analysis, evidence-gated validation, correlation, risk, and remediation reporting). There is no separate scanner tool, preview, or publishing; the agent can never commit/push directly (it proposes pull requests or waits for the user to push from Git Control), and file writes/commands can require per-action chat approval (`approvalMode: "review"`).

### Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js `16.2.10` (App Router, `src/proxy.ts`), React `19.2.4`, TypeScript `5` |
| Styling & UI | Tailwind CSS v4 (`@import "tailwindcss"`), Geist Sans & Mono, `lucide-react`, `sonner`, `react-resizable-panels`, `react-markdown` + `remark-gfm` |
| Code & Diffs | `@pierre/diffs` (code editor + unified/split diffs), `@pierre/trees` (file explorer with Git status) |
| Auth | Auth0 v4 (`@auth0/nextjs-auth0`) via `src/proxy.ts` and `src/lib/auth0.ts` |
| Database | Neon PostgreSQL (`@neondatabase/serverless`) + Drizzle ORM (`drizzle-orm`, `drizzle-kit`), with an in-memory fallback when `DATABASE_URL` is unset |
| Sandboxes | Daytona (`@daytona/sdk`) — `node:22-bookworm` containers |
| AI Provider | `openai` SDK targeting any OpenAI-compatible Chat Completions endpoint (streaming + tool calling + vision) |
| Storage | Private Google Cloud Storage (`@google-cloud/storage`), with an in-memory fallback when `GOOGLE_STORAGE_BUCKET` is unset |
| Edge / Custom Domains | Cloudflare for SaaS + Cloudflare Worker (`cloudflare/edge-worker.js`) acting as a Daytona custom preview proxy |
| Validation & Testing | Zod v4 (`zod`), Vitest v4 (`vitest run`), ESLint 9 (`eslint-config-next`) |

---

## 2. Hard Architectural Boundaries & Security Invariants

Agents **must** preserve these boundaries (see also [AGENTS.md](AGENTS.md)):

- **Persistence boundary:** All database queries go through `src/lib/store.ts` (never import `db` directly in routes or components). Every new store function must support both Drizzle (`db`) and the `globalThis.__cognixMemoryStore` fallback used when `DATABASE_URL` is unset.
- **Sandbox boundary:** All Daytona operations go through `src/lib/daytona.ts`.
- **Storage boundary:** All GCS operations go through `src/lib/storage.ts`.
- **Secret isolation:**
  - Never expose host/provider keys via `NEXT_PUBLIC_*` or copy host credentials into sandboxes.
  - Project secrets and GitHub OAuth tokens are encrypted at rest with AES-256-GCM (`src/lib/secrets-crypto.ts` using 32-byte base64 `COGNIX_SECRETS_KEY`).
  - Build-mode agent file tools (`src/lib/ai/tools.ts`), file routes, snapshots, exports, and GitHub sync reject `.env*` files.
  - A Security-mode import may contain repository `.env*` files, but agent file/list/search tools exclude them and the Security prompt forbids shell bypasses or loading `../.cognix-env`. Reviews inspect ordinary source/configuration with masked evidence and report environment-file contents as a coverage gap. Pushing new/edited `.env*` files or any file containing a project secret value (`>= 8` chars) is blocked server-side.
  - Terminal output (`src/lib/ai/terminal-log.ts`) redacts known project secret values before streaming or persistence.
- **GitHub isolation:** GitHub tokens never enter any sandbox. All Git reads, commits, branch updates, and PR creation happen on the Cognix server via GitHub's REST / Git Data API. Cognix never force-pushes user branches (only its own `cognix-sync` branch on divergence).
- **Custom-domain isolation:** Requests arriving on an attached customer hostname are rewritten by `src/proxy.ts` exclusively to `/domain/[host]` and never reach Auth0, builder pages, or `/api/*`. Direct requests to `/domain/*` on the builder host are rewritten to `/_cognix-not-found` to prevent header spoofing.
- **SSRF protection:** `fetch_url` and `web_search` in `src/lib/ai/tools.ts` enforce `assertPublicUrl` (HTTP/HTTPS only, ports 80/443, no credentials, DNS-resolved private/loopback/link-local IPs blocked, max 3 redirects, max 1 MB text body).

---

## 3. Repository Map

```text
├── AGENTS.md                        # Product conventions, required checks, UI rules
├── CLAUDE.md                        # Imports @AGENTS.md
├── CONTEXT.md                       # This file
├── Infra/                           # Human + AI-agent setup docs, Caddy/Traefik configs, systemd units, DNS & Daytona edge proxy
├── vm/                              # Live VM Caddyfile & zero-dep Node Daytona custom preview proxy
├── cloudflare/
│   ├── edge-worker.js               # Cloudflare Worker: Daytona custom preview proxy for custom domains
│   └── wrangler.toml                # Worker config (COGNIX_ORIGIN = https://curator.codes)
├── drizzle/                         # Ordered SQL migrations: 0000_initial.sql .. 0010_agent_approvals.sql
├── drizzle.config.ts                # Loads .env.local via @next/env before targeting DATABASE_URL
├── next.config.ts                   # devIndicators: false
├── vitest.config.ts                 # Node env, includes src/**/*.test.ts, @ -> ./src
└── src/
    ├── proxy.ts                     # Next.js 16 proxy: domain probe, custom-domain rewrite, Auth0 middleware
    ├── app/                         # Next.js App Router pages & API route handlers
    │   ├── layout.tsx               # Geist fonts, dark viewport (#080808), Sonner <Toaster />
    │   ├── globals.css              # Tailwind v4 + custom theme tokens & workspace/landing styles
    │   ├── page.tsx                 # HomeShell (Build mode composer + sidebar)
    │   ├── security-scanner/page.tsx# HomeShell in Security mode (?repo=owner/name)
    │   ├── projects/[projectId]/page.tsx       # WorkspaceClient (auth required; refreshes dev preview)
    │   ├── publish/[slug]/[[...path]]/page.tsx # Permanent published app iframe + deep-link forwarding
    │   ├── domain/[host]/page.tsx              # Internal rewrite target for custom domains
    │   ├── remix/[projectId]/page.tsx          # Public/owner remix preview + RemixButton
    │   ├── github/connected/page.tsx           # OAuth/App installation callback landing page
    │   └── api/                                # All server route handlers (see Section 8)
    ├── components/
    │   ├── home-shell.tsx           # Root composer (Code/Security toggle, uploads, voice, /skills)
    │   ├── home-sidebar.tsx         # Collapsible sidebar (localStorage["cognix:sidebar"], rename/delete/remix)
    │   ├── workspace-client.tsx     # Main project IDE shell (~2.1k lines): chat, NDJSON stream, resizable panels, preview, visual edit
    │   ├── code-workbench.tsx       # @pierre/diffs editor + @pierre/trees file explorer + Ctrl+P/Ctrl+S
    │   ├── change-details.tsx       # @pierre/diffs unified/split diff viewer for build checkpoints
    │   ├── code/                    # pierre.ts theme/status helpers, project-file-tree.tsx, resizable-sidebar.tsx
    │   ├── workspace/               # tool-launcher, cloud-panel, publish-section, project-settings, terminal-panel, git-panel, git-history, git-cache, github-section, github-repository
    │   ├── security/                # security-git-section, approval-card, approval-mode-menu, pull-request-card, repo-selector, run-chips
    │   ├── skills/                  # use-skill-commands, skill-command-menu, skill-editor-dialog, skills-manager-dialog, skill-api
    │   ├── landing/                 # Marketing landing sections (nav, hero, demo, features, showcase, comparison, faq, cta, footer)
    │   └── *.tsx                    # agent-question-card, custom-domains-panel, secrets-panel, message-content, pending-upload, preview-placeholder, published-app-frame, remix-button/dialog, pixel-loader, dither-backdrop, user-avatar, etc.
    └── lib/
        ├── types.ts                 # Shared domain types (Project, Message, AgentEvent, GitHub, Skills, Approvals, etc.)
        ├── auth0.ts                 # Auth0Client, getViewer(), requireViewer()
        ├── identity.ts              # canonicalAccountId() — sha256 verified email -> account|<40 hex>
        ├── http.ts                  # errorResponse() (handles Response, ZodError, custom .status), notFound()
        ├── db/index.ts              # Drizzle neon-http client + isDatabaseConfigured
        ├── db/schema.ts             # 12 PostgreSQL tables (Drizzle schema)
        ├── store.ts                 # All DB queries + globalThis.__cognixMemoryStore fallback
        ├── daytona.ts               # Sandboxes, dev preview (3000), published app (3001), proxy targets, snapshots, env sync
        ├── storage.ts               # Private GCS upload/download/signed-read/delete + memory fallback
        ├── secrets-crypto.ts        # AES-256-GCM encryptSecret/decryptSecret via COGNIX_SECRETS_KEY
        ├── env-files.ts             # Secret name/value validation, .env* path checks, dotenv rendering
        ├── domains.ts               # Hostname validation, DNS record generation, verification evaluation, edge header auth
        ├── dns.ts                   # DoH lookups (cloudflare-dns.com), HTTP/HTTPS serving probe, Cloudflare DNS & SaaS custom hostnames
        ├── publish-url.ts           # Origin resolution, safeAppPath(), publishedFrameUrl()
        ├── checkpoints.ts           # Checkpoint validation & restorability checks
        ├── visual-edit.ts           # Zod schemas & helpers for VisualElementSelection (max 5)
        ├── visual-edit-bridge.ts    # Injected public/__cognix_visual_edit.js + root layout script marker
        ├── cloud-features.ts        # Cognix Cloud feature catalog & required env var names
        ├── agent-questions.ts       # Parsing/formatting ask_user, enable_cloud, and pull_request metadata
        ├── skills.ts                # Slash-command parsing, SKILL.md frontmatter parser, GitHub URL resolver
        ├── remix.ts                 # Async project cloning (startRemix, badgeHrefFor, remixUrlFor)
        ├── tar.ts                   # Pure-Node gzipped tar extractor (ustar, GNU long, PAX) with path-traversal & size guards
        ├── upload-policy.ts         # 15 MB cap & allowed MIME whitelist (images, PDF, md, txt, json)
        ├── initial-build.ts         # URL param cleanup & duplicate prompt detection
        ├── utils.ts                 # cn(), titleFromPrompt(), safeFileName(), publishSlugFromTitle(), formatRelativeDate()
        ├── ai/                      # Coding & Security agent runtime (Section 6)
        └── github/                  # GitHub OAuth/App auth, REST client, two-way sync, security repo import/push (Section 7)
```

---

## 4. Database Schema (`src/lib/db/schema.ts`)

Migrations live in `drizzle/0000_initial.sql` through `drizzle/0010_agent_approvals.sql`. All project-scoped tables cascade on `projects.id` deletion.

| Table | Primary Key | Purpose & Key Columns |
| --- | --- | --- |
| `users` | `id` (text) | Canonical user ID (`account\|<sha256[:40]>` for verified emails, else Auth0 `sub`). `ensureUser()` merges legacy unverified rows by lowercase email. |
| `projects` | `id` (uuid) | `ownerId`, `title`, `description`, `status` (`draft\|building\|publishing\|ready\|published\|error`), `coverGradient`, `sandboxId`, `previewUrl`, `publishSlug` (unique), `publishedAt`, `showBadge`, `publicRemix`, `mode` (`build\|security`), `securitySource` (jsonb). |
| `messages` | `id` (uuid) | `projectId`, `role` (`user\|assistant\|tool`), `content`, `metadata` (jsonb: `activity`, `commands`, `changedPaths`, `fileChanges`, `questions`, `github`, `githubSync`, `security`, `securityPush`, `pullRequestDecision`, `restoredAt`, `visualSelections`, `attachments`, `remixedFrom`, `error`). |
| `project_files` | `id` (uuid) | Unique `(projectId, path)`. Mirror of UTF-8 source files for the Code tab (`content`, `size`). |
| `attachments` | `id` (uuid) | `projectId`, `ownerId`, `name`, `contentType`, `size`, `objectKey` (GCS key), `sandboxPath`. |
| `project_domains` | `id` (uuid) | `hostname` (unique), `status` (`pending\|active\|error`), `verificationToken`, `managedByProvider`, `lastError`, `verifiedAt`, `lastCheckedAt`. Max 5 per project. |
| `project_secrets` | `id` (uuid) | Unique `(projectId, name)`. AES-256-GCM `ciphertext`, `iv`, `authTag`, `managedBy` (`user\|cloud`). |
| `project_cloud` | `projectId` (uuid) | `status` (`disabled\|provisioning\|ready\|error`), `neonProjectId`, `neonRegion`, `storageEnabled`, `appTokenHash`, `authEnabled`, `lastError`. |
| `skills` | `id` (uuid) | Unique `(ownerId, name)`. `description`, `body`, `source` (`ai\|github\|manual`), `sourceUrl`. Max 100 per user. |
| `github_connections` | `ownerId` (text) | One GitHub connection per user. Encrypted `token*` and optional expiring GitHub App `refresh*` fields, `githubUserId`, `login`, `avatarUrl`, `scopes`. |
| `project_repositories` | `projectId` (uuid) | Linked repo (`repoId`, `fullName`, `htmlUrl`, `defaultBranch`, `private`, `autoCommit`), 3-way sync state (`syncBaseSha`, `syncedPaths`), last commit info, and cached `cachedSync` / `cachedCommits` / `commitsFetchedAt`. |
| `agent_approvals` | `id` (uuid) | Security mode `review` approvals: `items` (jsonb), `decisions` (jsonb), `status` (`pending\|resolved\|expired`). Polled by the running agent. |

---

## 5. Sandbox, Preview & Publishing Lifecycle (`src/lib/daytona.ts`)

### Critical Path Convention
- **Daytona Filesystem API (`sandbox.fs.*`)** resolves relative paths from the sandbox `WORKDIR` — always use `getProjectFsRoot()` (`"app"`), e.g., `app/src/app/page.tsx`.
- **Daytona Process API (`sandbox.process.*`)** runs shell commands — always use `await getProjectRoot(sandbox)` (`<workDir>/app`).

### Ports & Process Sessions
- **Development preview (port `3000`):**
  - Agent background commands run in session `cognix-<projectId[:12]>`.
  - Cognix-managed dev server runs in session `cognix-preview-<projectId[:12]>` via `npm run dev -- --hostname 0.0.0.0 --port 3000`.
  - Signed preview URLs have a 1-hour TTL and are verified up to 5 times with `X-Daytona-Skip-Preview-Warning: true` because Daytona's external proxy can trail local readiness.
- **Published production app (port `3001`):**
  - Triggered asynchronously via `POST /api/projects/[projectId]/publish` (`status: 202`, guarded by `globalThis.__cognixPublishJobs`).
  - `deployPublishedApp()` pauses the port `3000` dev server (to free RAM), copies workspace files into sibling `.cognix-published-<projectId>/staging-<ts>`, clones `node_modules` via `cp -al` (hard links, falling back to symlink), injects `.cognix-build-limits.cjs` (`NODE_OPTIONS=--max-old-space-size=512 --require=...` and caps `os.cpus()`/`availableParallelism()` to `1`), runs `npm run build`, atomically swaps `staging` -> `current` (saving `previous`), starts production server on port `3001` in session `cognix-published-<projectId[:12]>`, rolls back to `previous` on failure, and resumes the dev server in `finally`.
  - Sets `autoStopInterval=0`, `autoArchiveInterval=0`, `autoDeleteInterval=-1` so published apps stay live. Unpublishing (`stopPublishedApp`) restores `autoStopInterval=30` and `autoArchiveInterval=1440`.
  - Runtime URLs (`__cognixPublishedRuntimes`) and edge proxy targets (`__cognixPublishedProxyTargets`) are cached in memory for 45 minutes (30-second health-recheck grace window) with concurrent request coalescing.

### Custom Domains & Cloudflare Edge Worker
- Two serving modes:
  1. **Direct / iframe fallback:** `src/proxy.ts` rewrites non-app hostnames to `/domain/[host]` (which renders `<PublishedAppFrame />` pointing at the signed Daytona URL with deep-linked path/query).
  2. **Zero-config Cloudflare for SaaS (`cloudflare/edge-worker.js`, recommended):** Attaching a domain registers a Cloudflare custom hostname (`registerEdgeHostname` in `src/lib/dns.ts`). The edge worker calls `GET /api/edge/resolve?host=<host>` (authenticated with `x-cognix-edge-secret`), caches the Daytona port `3001` upstream + headers for 60s, proxies HTTP + WebSockets straight to Daytona (no iframe), injects the "Edit with Curator" badge via `HTMLRewriter`, strips visitor `x-cognix-*` and `x-daytona-*` headers, and serves an auto-reloading 503 restarting page on 502/504 while marking the host stale (`?fresh=1` next lookup).
- Verification (`verifyProjectDomain` in `src/lib/dns.ts`): checks `TXT _cognix-challenge.<host>` + `CNAME`/`A` via Cloudflare DoH, **and** probes `https://<host>/.well-known/cognix-domain-check` to ensure traffic actually reaches Cognix.

---

## 6. AI Coding & Security Agent Runtime (`src/lib/ai/*`)

### Streaming Transport (`POST /api/projects/[projectId]/agent`)
- Returns **`application/x-ndjson; charset=utf-8`** (newline-delimited JSON objects of type `AgentEvent`, NOT SSE).
- Sends `heartbeat` every 10s (`maxDuration = 900`). If the browser disconnects, `streamOpen` becomes `false` while `runAgent()` continues and persists the final assistant message and files.
- `AgentEvent` types: `heartbeat`, `status`, `token`, `tool_start`, `tool_result`, `command_start`, `command_end`, `attachment_start`, `attachment_ready`, `preview`, `files_changed`, `approval_request`, `approval_resolved`, `done`, `error`.

### Execution Loop (`src/lib/ai/runner.ts`)
1. Ensures sandbox (`ensureSandbox`), creates `app/`.
   - **Security mode:** runs `importSecuritySource()` (pulls latest branch tarball unless local unpushed changes exist, records baseline in sibling `.cognix-git`).
   - **Build mode:** ensures visual edit bridge (`ensureVisualEditBridge`), and if a GitHub repo is linked, runs `pullBeforeBuild()` to pull remote-ahead commits.
2. Stages attachments into `uploads/<id>-<safeName>` and `public/user-uploads/<id>-<safeName>` (exposing stable `/user-uploads/...` URLs to the app).
3. Builds system prompt (`buildSystemPrompt` or `buildSecurityPrompt`) injecting invoked `/skills` (up to `SKILLS_PER_PROMPT = 5`), Cognix Cloud state + secret names (never values), and GitHub context. Build mode injects the always-on first-party frontend taste pack from `src/lib/ai/frontend-taste.ts`; Security mode instead injects the always-on security review pack from `src/lib/ai/security-methodology.ts`. Neither pack consumes a user's slash-skill allowance or leaks into the other mode. History is trimmed to the last 20 user/assistant messages.
4. Runs up to `resolveAgentMaxTurns()` (default `80`, env `AGENT_MAX_TURNS` clamped `20..120`). Every `28` turns (`AGENT_CONTEXT_REFRESH_INTERVAL`), compacts the conversation back to system prompt + original prompt + changed file list.
5. **Multimodal fallback:** On turn 0, if the provider rejects native `file` parts with HTTP 400/415/422, retries automatically with `includeNativeFiles: false` (keeping `image_url` parts and inline text).
6. **Build-mode completion gate:** When the model stops calling tools, if `!previewReady || !productionBuildPassed`, the runner nudges it up to 2 times to run a production build (`isProductionBuildCommand`), verify responsive viewports, start the dev server, and call `get_preview_url`. Any file-mutating tool resets `productionBuildPassed = false`.
7. **Post-loop (Build mode):** Ensures `package.json` exists, re-ensures visual edit bridge, installs deps / starts dev server on port `3000` if unhealthy, gets signed preview URL, and if a GitHub repo is linked and files changed, generates a commit message (`writeCommitMessage`) and auto-commits (`runGitHubCommit`).
8. **Interactive pause:** Calling `ask_user`, `request_cognix_cloud`, or `propose_pull_request` ends the turn early (`finishWithQuestions`) and stores the structured `AgentQuestionRequest` in `messages.metadata.questions`. The user's reply arrives as the next chat message (or PR approval endpoint).

### Tool Sets
- **Core sandbox & web tools (`src/lib/ai/tools.ts`, 16 tools):** `list_files`, `find_files`, `read_file`, `write_file`, `edit_file`, `search_files`, `move_file`, `delete_file`, `run_command`, `get_process_logs`, `list_processes`, `stop_process`, `inspect_preview`, `web_search`, `fetch_url`, `get_preview_url`.
- **Interactive & Cloud tools (`src/lib/ai/interactive-tools.ts`, `src/lib/ai/cloud-tools.ts`):** `ask_user`, `request_cognix_cloud`, `read_cloud_guide` (serves server-only guides in `src/lib/ai/cloud-guides.ts` for `database`, `storage`, `email`, `auth` [Better Auth]), plus Build-mode Cloud provider tools unlocked when Cognix Cloud is on:
  - `neon_database` (`src/lib/cloud/neon.ts`): Server-side Neon API v2 integration (`NEON_API_KEY`) strictly scoped to the project's isolated `project_cloud.neon_project_id`. Provisions Neon Postgres 17, syncs pooled `DATABASE_URL` + direct `DIRECT_URL` (`managedBy: "cloud"`), runs SQL/schema introspection, and manages copy-on-write branches, point-in-time restores, databases, roles, compute endpoints/read replicas, and snapshots.
  - `resend_email` (`src/lib/cloud/resend.ts`): Server-side Resend REST API integration using the project's user-connected `RESEND_API_KEY` (`EMAIL_FROM`) for domains, DNS verification, emails/batch sends, audiences, contacts, broadcasts, and webhooks.
- **Build-mode GitHub tool (`src/lib/ai/github-tool.ts`):** `commit_to_github` (only exposed when a repo is linked).
- **Security-mode differences (`src/lib/ai/security-prompt.ts`, `src/lib/ai/security-tools.ts`):**
  - Excludes `get_preview_url`, `inspect_preview`, `request_cognix_cloud`, `read_cloud_guide`, `commit_to_github`.
  - Adds `propose_pull_request`.
  - Generic “scan/audit/review” prompts default to the built-in standard profile. The main agent performs the removed scanner's staged methodology itself: repository intelligence, dependency/supply-chain review, secrets/configuration, static source analysis, IaC/cloud, evidence-gated validation, skeptical verification, coverage criticism, deduplication/risk, and remediation reporting. Dynamic testing is never implied by Auto approval or a “full review”; unavailable analyzers and unsafe runtime checks become explicit coverage gaps or no-severity `Needs validation` leads.
  - In `approvalMode: "review"`, batches all `APPROVAL_TOOLS` (`write_file`, `edit_file`, `move_file`, `delete_file`, `run_command`) in a turn, inserts a row in `agent_approvals`, emits `approval_request`, and polls the DB every `1.5s` for up to `10m` (`APPROVAL_TIMEOUT_MS`). Choosing "Allow everything for this run" adds a `{ callId: "*", decision: "allow" }` sentinel.

---

## 7. GitHub Integration & Two-Way Sync (`src/lib/github/*`)

- **App types (`oauth.ts`, `app-auth.ts`):** Supports both OAuth Apps and GitHub Apps (detected by `GITHUB_CLIENT_ID` starting with `Iv`).
  - OAuth flow uses S256 PKCE + `state` stored inside AES-256-GCM encrypted `cognix_github_oauth` cookie (`path: /api/github`, 10m TTL). GitHub App install flow (`/apps/<slug>/installations/new`) validates `state` without PKCE.
  - Expiring GitHub App user tokens auto-refresh 5m before expiry (`requireToken` in `sync.ts`).
  - When `GITHUB_APP_PRIVATE_KEY` is configured on a GitHub App, commits authenticate with a per-repo installation token (`contents: write`, cached in memory) so commits appear as `<slug>[bot]` with `Co-authored-by:` user attribution—after `assertUserCanPush()` verifies the user still has push permission.
- **Two-way sync (`sync.ts`):**
  - Serialized per project via an in-memory promise queue (`exclusive()`).
  - Compares 3 trees: `base` (`syncBaseSha`), `local` (sandbox `readProjectSnapshot` excluding `node_modules`, `.next`, `.git`, `.env*`, `*.log`, `uploads`), and `remote` (branch head).
  - States: `in_sync`, `local_ahead`, `remote_ahead`, `diverged`.
  - On `diverged`: pushes Cognix's commit onto `cognix-sync` (the only branch Cognix ever force-updates) and directs the user to merge on GitHub or choose "Use GitHub's version" (which pulls with `discardLocal: true` and writes a restorable checkpoint).
  - Files existing only on GitHub (e.g., `README.md`, CI workflows) are never deleted unless they appear in `syncedPaths`.
  - Sync status and recent commits are cached in `project_repositories` (`cachedSync`, `cachedCommits`) and in browser `localStorage` (`src/components/workspace/git-cache.ts`, 5m TTL).
- **Security mode Git (`security-source.ts`):**
  - Downloads branch tarball (max 100 MB), strips symlinks, mirrors up to 3,000 text files into `project_files`, and maintains a local Git repo at `../.cognix-git` (sibling to `app/`, invisible to agent tools) to compute `git diff --cached` respecting `.gitignore`.
  - Only pushes when the user explicitly commits/pushes from Git Control or approves a `propose_pull_request` card.

---

## 8. Other Key Subsystems

- **Visual Edit (`src/lib/visual-edit.ts`, `src/lib/visual-edit-bridge.ts`):** Injects `public/__cognix_visual_edit.js` and a `{/* cognix:visual-edit:start */}...{/* cognix:visual-edit:end */}` `<script>` tag before `</body>` in the generated app's root layout. Captures up to 5 selected elements (CSS selector, computed styles, rect, route, React Fiber component stack) over origin-validated `postMessage` (`channelId`). Passed to the agent inside `<visual_selection_context>` as untrusted hints.
- **Checkpoints & Restore (`src/lib/checkpoints.ts`, `checkpoints/[messageId]/restore/route.ts`):** File-mutating tools capture before/after snapshots (up to 100 files, 200K chars each). Restoration verifies current sandbox files still match `change.after` (allowing the visual-edit script marker on layout files), reverts files + `project_files`, runs `npm install` if `package*.json` changed, marks `restoredAt`, and auto-commits the revert to GitHub in Build mode.
- **Skills (`src/lib/skills.ts`, `src/app/api/skills/*`, `src/components/skills/*`):** Per-account reusable `SKILL.md` instructions (YAML frontmatter + Markdown body, max 20K chars, max 100/account). Built-in slash commands: `/create-skill <desc>` (LLM draft via `completeText`), `/install-skill <github-url>` (imports public GitHub `SKILL.md`), `/new-skill`, `/skills`. Prompts mentioning `/skill-name` inject up to 5 matching skills into the system prompt. Separately, `src/lib/ai/frontend-taste.ts` defines three always-on, non-persisted Build-mode skills for product art direction, visual composition, and production interaction polish; they do not appear in the slash-skill UI or consume the per-prompt limit.
- **Cognix Cloud (`src/lib/cloud-features.ts`, `src/lib/ai/cloud-guides.ts`, `api/projects/[projectId]/cloud`):** Toggling Cloud on marks `project_cloud.status = "ready"`, unlocks `read_cloud_guide` for `database` (Drizzle + `pg`), `storage` (S3 presigned URLs), `email` (Resend), and `auth` (Better Auth), and auto-generates `BETTER_AUTH_SECRET` if missing.
- **Public Remix (`src/lib/remix.ts`, `src/app/remix/[projectId]/page.tsx`, `api/projects/[projectId]/remix`):** Owners can always remix (optionally including chat history); others can remix when `project.publicRemix === true`. Copies source files asynchronously via `copyProjectSandbox` — never copies secrets, custom domains, publish state, GitHub links, or cloud settings. Rate-limited to 5 remixes per 10 minutes per user.

---

## 9. API Route Inventory (`src/app/api/`)

All routes except `/api/health`, `/api/edge/resolve`, `/api/edge/allow-domain`, and `/api/github/callback` (which redirects to login) require a verified Auth0 session via `requireViewer()` / `getViewer()` and scope records by `ownerId`.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/health` | `GET` | Service readiness booleans (`auth0`, `neon`, `daytona`, `model`, `googleStorage`). Public. |
| `/api/edge/resolve` | `GET` | Edge proxy lookup (`?host=&fresh=1`), authenticated by `x-cognix-edge-secret`. Resolves Lovable-style random preview slugs `<adj>-<noun>-<hex8>.<COGNIX_APPS_DOMAIN>` (Daytona port 3000), `<name>.<COGNIX_APPS_DOMAIN>` (port 3001), and attached custom domains (port 3001). |
| `/api/edge/allow-domain` | `GET` | Caddy On-Demand TLS `ask` webhook (`?domain=&secret=`), authenticated by `COGNIX_EDGE_SECRET`. Approves (`200`) builder hosts, `COGNIX_APPS_DOMAIN` subdomains, and registered custom domains. |
| `/api/projects` | `GET`, `POST` | List owner's projects; create `build` or `security` project (validates repo access for security mode). |
| `/api/projects/[projectId]` | `GET`, `PATCH`, `DELETE` | Fetch project + messages; update title/description/showBadge/publicRemix; delete sandbox (required first), domains, GCS objects, and DB row. |
| `/api/projects/[projectId]/agent` | `POST` | Run build/security agent loop; streams NDJSON `AgentEvent`s (`maxDuration = 900`). |
| `/api/projects/[projectId]/agent/approvals/[approvalId]` | `POST` | Submit allow/deny decisions (`allowRestOfRun`) for a paused Request review run. |
| `/api/projects/[projectId]/files` | `GET`, `PATCH` | List mirrored files or fetch single file from sandbox (`?path=`); save user edit to sandbox + DB. |
| `/api/projects/[projectId]/preview` | `GET` | Ensure dev server on port 3000 and return fresh signed Daytona preview URL. |
| `/api/projects/[projectId]/publish` | `POST`, `DELETE` | Queue async production deploy on port 3001 (`202`); stop published server and unpublish. |
| `/api/projects/[projectId]/export` | `GET` | Download `.tar.gz` of project source (excludes `node_modules`, `.next`, `.git`, `.env*`, `*.log`). |
| `/api/projects/[projectId]/upload` | `POST` | Validate (15 MB, MIME whitelist), store in private GCS, optionally upload to sandbox `uploads/`. |
| `/api/uploads/[attachmentId]` | `GET` | Stream private GCS attachment bytes to its owner. |
| `/api/projects/[projectId]/checkpoints/[messageId]/restore` | `POST` | Revert files from an assistant checkpoint snapshot (conflict-checked; auto-commits revert in Build mode). |
| `/api/projects/[projectId]/visual-edit` | `POST` | Inject visual-edit bridge into Next.js root layout and return preview URL. |
| `/api/projects/[projectId]/secrets` | `GET`, `PUT`, `DELETE` | List secret names (never values); encrypt + upsert/delete secret and sync `.env.local` (or `../.cognix-env`). |
| `/api/projects/[projectId]/cloud` | `GET`, `PUT` | Read or toggle Cognix Cloud; auto-provisions `BETTER_AUTH_SECRET` and (when `NEON_API_KEY` is set) the project's isolated Neon PostgreSQL database (`DATABASE_URL` + `DIRECT_URL`). |
| `/api/projects/[projectId]/cloud/database` | `GET`, `POST` | Read Neon overview/tables or run managed Neon operations (provision, SQL, branches, endpoints, roles, databases, snapshots). |
| `/api/projects/[projectId]/cloud/resend` | `GET`, `POST`, `DELETE` | Connect/verify/disconnect user's `RESEND_API_KEY` + `EMAIL_FROM` and manage Resend domains, emails, audiences, contacts, broadcasts, and webhooks. |
| `/api/projects/[projectId]/cloud/auth` | `GET`, `POST` | Inspect Better Auth codebase + live PostgreSQL auth tables/users/sessions (`src/lib/cloud/better-auth.ts`) and rotate secrets or manage users/sessions. |
| `/api/projects/[projectId]/remix` | `POST` | Start async project copy for owner or public remixer (rate-limited 5 / 10m). |
| `/api/projects/[projectId]/domains` | `GET`, `POST` | List custom domains + `domainSetup()`; attach domain (registers Cloudflare SaaS hostname + auto-provisions DNS if configured). |
| `/api/projects/[projectId]/domains/[domainId]` | `DELETE` | Remove provider DNS + Cloudflare custom hostname (best effort) and detach domain. |
| `/api/projects/[projectId]/domains/[domainId]/verify` | `POST` | Self-heal managed DNS/edge registration, verify DoH records + HTTPS probe. |
| `/api/github/connect` | `GET` | Start GitHub OAuth or App install flow (`?mode=install&returnTo=`). |
| `/api/github/callback` | `GET` | Verify encrypted state/PKCE cookie, exchange code, save tokens, auto-redirect to App install if needed. |
| `/api/github/connection` | `GET`, `DELETE` | Read connected GitHub account; revoke grant/token and disconnect. |
| `/api/github/access` | `GET` | Return GitHub App/OAuth repo management URL and installation selection. |
| `/api/github/repos` | `GET` | List pushable repos (default) or readable repos (`?access=read` for Security mode). |
| `/api/projects/[projectId]/github` | `GET`, `POST`, `DELETE` | Get repo link + cached sync/commits; create or link repo + initial push; unlink repo. |
| `/api/projects/[projectId]/github/sync` | `GET`, `POST` | Compute 3-way sync status; pull (`discardLocal`) or push pending changes. |
| `/api/projects/[projectId]/github/branches` | `GET`, `POST`, `PUT` | List branches; create & switch branch; switch active branch and load its files. |
| `/api/projects/[projectId]/github/commits` | `GET` | List recent commits labeled by source (`cognix` vs `github`) and `inCognix`. |
| `/api/projects/[projectId]/security/changes` | `GET` | List uncommitted sandbox changes tracked by `.cognix-git`. |
| `/api/projects/[projectId]/security/commit-message` | `POST` | Generate a conventional commit message from pending security changes. |
| `/api/projects/[projectId]/security/push` | `POST` | Commit & push security changes (existing branch fast-forward or new branch + optional PR). |
| `/api/projects/[projectId]/security/pull-request` | `POST` | Approve (create branch + push + open PR) or decline an agent's `propose_pull_request` card. |
| `/api/skills` | `GET`, `POST` | List owner's skills; create skill. |
| `/api/skills/[skillId]` | `PATCH`, `DELETE` | Update or delete skill. |
| `/api/skills/generate` | `POST` | Generate a `SkillDraft` via `completeText`. |
| `/api/skills/import` | `POST` | Fetch & parse a public GitHub `SKILL.md` into a `SkillDraft`. |

---

## 10. Frontend Patterns & Key Components

- **Theme & Accessibility (`src/app/globals.css`, `AGENTS.md`):**
  - Dark-first palette (`--background: #080808`, workspace `#141414`/`#191919`, `--accent: #6d5dfc`), Geist Sans/Mono, visible `:focus-visible` outline (`#9f94ff`), `tabular-nums` on durations/counts/timestamps, ellipsis character (`…`), `prefers-reduced-motion` honored (`PixelLoader`, transitions), 32 px desktop / 44 px coarse-pointer (`[@media(pointer:coarse)]`) targets.
- **Workspace Layout (`src/components/workspace-client.tsx`):**
  - Full-viewport fixed frame (`.workspace-frame`) with `HomeSidebar` + `react-resizable-panels` (`Group` / `Panel` / `Separator`). Note `WORKSPACE_PANEL_STYLE` overrides `react-resizable-panels`'s default `overflow: auto` with `overflow: clip` + flex column so chat headers and composers remain pinned.
  - Tool tabs (`src/components/workspace/tool-launcher.tsx`):
    - Build mode: `preview`, `terminal` (read-only), `code` (`CodeWorkbench`), `cloud` (`Publish`, `Domains`, `Secrets`, `Settings`, `Cognix Cloud`), `git` (`GitPanel` + checkpoints/diffs), `launcher`.
    - Security mode: chat-first review plus `terminal`, `code`, `cloud` (Secrets only), `git` (`SecurityGitSection` + checkpoints), and `launcher`. There is no separate scan tool.
- **Code & Diffs (`src/components/code-workbench.tsx`, `src/components/change-details.tsx`, `src/components/code/pierre.ts`):**
  - Uses `@pierre/diffs` (`EditProvider`, `File`, `FileDiff`, theme `pierre-dark`) and `@pierre/trees` (`ProjectFileTree`). Supports `Ctrl/Cmd+P` file/content search and `Ctrl/Cmd+S` save to `PATCH /api/projects/[projectId]/files`.
  - File contents are lazy-loaded via `GET /api/projects/[projectId]/files?path=...` if `file.content === null`.

---

## 11. Environment Variables (`.env.example`)

All provider credentials are **server-only**. Never prefix with `NEXT_PUBLIC_`.

| Group | Variables | Notes |
| --- | --- | --- |
| Core / Auth0 | `APP_BASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` | All 5 required for Auth0 session middleware. |
| Database | `DATABASE_URL` | Pooled Neon PostgreSQL URL (`sslmode=require`). Falls back to volatile in-memory store if omitted. |
| Daytona | `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET` | `DAYTONA_API_URL` defaults to `https://app.daytona.io/api`. |
| Model | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AGENT_MAX_TURNS` (optional) | OpenAI-compatible Chat Completions endpoint. `AGENT_MAX_TURNS` defaults to `80` (clamped `20..120`). |
| Storage (GCS) | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_STORAGE_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_STORAGE_CREDENTIALS` | Falls back to in-memory map if `GOOGLE_STORAGE_BUCKET` is omitted. |
| Encryption | `COGNIX_SECRETS_KEY` | 32 random bytes base64 (`openssl rand -base64 32`). Required for project secrets & GitHub OAuth. |
| Custom Domains & Edge | `COGNIX_APP_HOSTS`, `COGNIX_DOMAIN_CNAME_TARGET`, `COGNIX_DOMAIN_IPV4`, `COGNIX_APPS_DOMAIN`, `COGNIX_PUBLISHED_AUTOSTOP_MINUTES`, `CLOUDFLARE_API_TOKEN`, `COGNIX_CF_SAAS_ZONE_ID`, `COGNIX_EDGE_SECRET` | Self-hosted VM proxy lives in `vm/edge-proxy.mjs` + `vm/Caddyfile`; Cloudflare Worker alternative lives in `cloudflare/edge-worker.js`. |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | `Iv*` client ID enables GitHub App mode; private key enables bot commits with co-authoring. |

---

## 12. Commands, Verification & Gotchas

### Commands
```bash
npm run dev          # Next.js dev server (http://localhost:3000)
npm run lint         # ESLint (eslint-config-next core-web-vitals + typescript)
npm test             # Vitest unit tests (src/**/*.test.ts)
npm run build        # Production Next.js build + TypeScript type check
npm run db:generate  # Generate Drizzle SQL migrations after editing src/lib/db/schema.ts
npm run db:push      # Push schema to Neon (loads .env.local automatically)
```
After any material change, always run `npm run lint`, `npm test`, and `npm run build` (per [AGENTS.md](AGENTS.md)).

### Subtle Gotchas for Agents
1. **Next.js 16 proxy filename:** Request interception lives in `src/proxy.ts` exporting `async function proxy(request)` — do **not** create a competing `src/middleware.ts`.
2. **Agent stream format:** `/api/projects/[projectId]/agent` streams NDJSON (`application/x-ndjson`), not SSE (`data: ...`).
3. **Vitest include pattern:** `vitest.config.ts` only includes `src/**/*.test.ts` (not `.tsx`) in the `node` environment. Note that `scratch/` is an untracked local scratch directory if present in the working tree.
4. **Daytona path duality:** `sandbox.fs.*` expects `app/<rel>` (`getProjectFsRoot()`), whereas `sandbox.process.executeCommand` expects absolute `<workDir>/app` (`await getProjectRoot(sandbox)`).
5. **Memory store parity:** Adding a table or query to `src/lib/store.ts` requires updating both the Drizzle path and the `!db` in-memory fallback (`globalThis.__cognixMemoryStore` / module maps) so tests and DB-less dev runs keep working.
6. **Memory-constrained sandbox builds:** Published builds inside Daytona run with `--max-old-space-size=512` and single-CPU shimming (`.cognix-build-limits.cjs`); keep that in mind when changing `deployPublishedApp()`.
7. **Visual edit bridge protection:** Never delete `public/__cognix_visual_edit.js` or strip the `{/* cognix:visual-edit:start */}` block in generated app layouts; checkpoint conflict checking explicitly accounts for that injected script tag.
