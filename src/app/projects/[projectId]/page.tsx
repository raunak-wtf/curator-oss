import { notFound, redirect } from "next/navigation";
import { WorkspaceClient } from "@/components/workspace-client";
import { getViewer } from "@/lib/auth0";
import { ensurePreviewUrl, publishedAutoStopMinutes } from "@/lib/daytona";
import { appsDomain } from "@/lib/domains";
import {
  ensureUser,
  getPendingAgentApproval,
  getProject,
  getProjectCloud,
  listMessages,
  listProjectConsoleLogs,
  listProjectFiles,
  listProjects,
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
    const latestPreviewUrl = await ensurePreviewUrl(project).catch(() => null);
    if (latestPreviewUrl) {
      project = {
        ...project,
        previewUrl: latestPreviewUrl,
        status: project.status === "published" || project.status === "publishing" ? project.status : "ready",
      };
    }
  }

  const [messages, files, projects, cloud, query, pendingApproval, consoleEntries] = await Promise.all([
    listMessages(project.id),
    listProjectFiles(project.id),
    listProjects(viewer.id),
    getProjectCloud(project.id).catch(() => null),
    searchParams,
    project.mode === "security" ? getPendingAgentApproval(project.id, viewer.id).catch(() => null) : Promise.resolve(null),
    project.mode !== "security" ? listProjectConsoleLogs(project.id, 150).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <WorkspaceClient
      initialProject={project}
      initialMessages={messages}
      initialFiles={files}
      initialConsoleEntries={consoleEntries}
      viewer={viewer}
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
