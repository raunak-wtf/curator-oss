import { notFound, redirect } from "next/navigation";
import { WorkspaceClient } from "@/components/workspace-client";
import { getViewer } from "@/lib/auth0";
import { ensurePreviewUrl, publishedAutoStopMinutes } from "@/lib/daytona";
import { appsDomain, parseAppsHostname } from "@/lib/domains";
import {
  buildOwnerPreviewFrameUrl,
  PREVIEW_OWNER_LEASE_MS,
  signPreviewGrant,
} from "@/lib/preview-access";
import {
  ensureUser,
  getPendingAgentApproval,
  getProject,
  getProjectCloud,
  getUserSubscription,
  hasActiveSubscriptionAccess,
  listMessages,
  listProjectConsoleLogs,
  listProjectFiles,
  listProjects,
  touchProjectPreviewSession,
} from "@/lib/store";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ prompt?: string; attachments?: string; tab?: string; github?: string; github_error?: string; approvalMode?: string }>;
};

export default async function ProjectPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect(`/auth/login?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`);
  await ensureUser(viewer);
  let project = await getProject(projectId, viewer.id);
  if (!project) notFound();

  if (project.sandboxId && project.mode !== "security") {
    await touchProjectPreviewSession(project.id, PREVIEW_OWNER_LEASE_MS).catch(() => undefined);
    const latestPreviewUrl = await ensurePreviewUrl(project).catch(() => null);
    if (latestPreviewUrl) {
      project = {
        ...project,
        previewUrl: latestPreviewUrl,
        status: project.status === "published" || project.status === "publishing" ? project.status : "ready",
      };
    }
  }

  let initialPreviewFrameUrl: string | null = project.previewUrl;
  if (project.previewUrl && project.mode !== "security") {
    try {
      const host = new URL(project.previewUrl).hostname;
      if (parseAppsHostname(host)?.kind === "preview" && (process.env.COGNIX_EDGE_SECRET || process.env.AUTH0_SECRET)) {
        const grant = signPreviewGrant({
          pid: project.id,
          host,
          role: "owner",
          ver: project.previewAccessVersion ?? 1,
          email: viewer.email,
          ttlSeconds: 12 * 3600,
        });
        initialPreviewFrameUrl = buildOwnerPreviewFrameUrl(project.previewUrl, grant, "/");
      }
    } catch {
      initialPreviewFrameUrl = project.previewUrl;
    }
  }

  const [messages, files, projects, cloud, query, pendingApproval, consoleEntries, subscription] = await Promise.all([
    listMessages(project.id),
    listProjectFiles(project.id),
    listProjects(viewer.id),
    getProjectCloud(project.id).catch(() => null),
    searchParams,
    project.mode === "security" ? getPendingAgentApproval(project.id, viewer.id).catch(() => null) : Promise.resolve(null),
    project.mode !== "security" ? listProjectConsoleLogs(project.id, 150).catch(() => []) : Promise.resolve([]),
    getUserSubscription(viewer.id),
  ]);

  return (
    <WorkspaceClient
      initialProject={project}
      initialPreviewFrameUrl={initialPreviewFrameUrl}
      initialMessages={messages}
      initialFiles={files}
      initialConsoleEntries={consoleEntries}
      viewer={viewer}
      initialBilling={{
        status: subscription.status,
        hasActiveAccess: Boolean(viewer.isAdmin) || hasActiveSubscriptionAccess(subscription),
        creditsBalanceHundredths: subscription.creditsBalanceHundredths,
        monthlyCreditsHundredths: subscription.monthlyCreditsHundredths,
      }}
      initialNow={new Date().toISOString()}
      initialPrompt={query.prompt}
      initialAttachmentIds={query.attachments?.split(",").filter(Boolean)}
      projects={projects}
      initialCloudEnabled={cloud?.status === "ready"}
      initialTab={query.tab === "git" ? "git" : undefined}
      initialApproval={pendingApproval}
      initialApprovalMode={project.mode === "security" && (query.approvalMode === "review" || query.approvalMode === "auto") ? query.approvalMode : undefined}
      githubResult={query.github ?? query.github_error}
      appsDomain={appsDomain()}
      publishedAutoStopMinutes={publishedAutoStopMinutes()}
    />
  );
}
