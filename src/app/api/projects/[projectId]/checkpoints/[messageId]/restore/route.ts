import path from "node:path";
import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { checkpointCanRestore } from "@/lib/checkpoints";
import { ensurePreviewUrl, getProjectFsRoot, getProjectRoot, getSandbox } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import { runGitHubCommit } from "@/lib/ai/github-tool";
import {
  createMessage,
  deleteProjectFile,
  getMessage,
  getProject,
  getProjectRepository,
  listProjectFiles,
  updateMessageMetadata,
  updateProject,
  upsertProjectFile,
} from "@/lib/store";
import { ensureVisualEditBridge, injectVisualEditScriptTag } from "@/lib/visual-edit-bridge";

export const runtime = "nodejs";
export const maxDuration = 420;

type Context = { params: Promise<{ projectId: string; messageId: string }> };

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function readOptionalFile(
  sandbox: NonNullable<Awaited<ReturnType<typeof getSandbox>>>,
  remotePath: string,
) {
  try {
    return (await sandbox.fs.downloadFile(remotePath)).toString("utf8");
  } catch {
    return null;
  }
}

function matchesCheckpoint(pathname: string, current: string | null, expected: string | null) {
  if (current === expected) return true;
  if (
    current === null
    || expected === null
    || !/(^|\/)(?:src\/)?app\/layout\.(?:tsx|jsx|js)$/.test(pathname)
  ) return false;
  return injectVisualEditScriptTag(expected) === current;
}

export async function POST(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const params = z
      .object({ projectId: z.string().uuid(), messageId: z.string().uuid() })
      .parse(await context.params);
    const project = await getProject(params.projectId, viewer.id);
    if (!project) return notFound();
    const checkpoint = await getMessage(params.messageId, project.id);
    if (!checkpoint || checkpoint.role !== "assistant") return notFound("This build checkpoint was not found.");

    const restore = checkpointCanRestore(checkpoint);
    if (!restore.canRestore) {
      return Response.json(
        { error: "This checkpoint cannot be restored because it is incomplete, truncated, or was already restored." },
        { status: 409 },
      );
    }

    const sandbox = await getSandbox(project);
    if (!sandbox) {
      return Response.json({ error: "Restart the project workspace before restoring this checkpoint." }, { status: 409 });
    }
    const root = await getProjectRoot(sandbox);
    const fsRoot = getProjectFsRoot();

    const currentFiles = await Promise.all(
      restore.changes.map(async (change) => ({
        change,
        current: await readOptionalFile(sandbox, `${fsRoot}/${change.path}`),
      })),
    );
    const conflicts = currentFiles
      .filter(({ change, current }) => !matchesCheckpoint(change.path, current, change.after))
      .map(({ change }) => change.path);
    if (conflicts.length) {
      return Response.json(
        {
          error: "This checkpoint has newer file changes on top of it. Restore the newest checkpoint or ask Cognix to undo the specific change.",
          conflicts,
        },
        { status: 409 },
      );
    }

    for (const { change } of currentFiles) {
      if (change.before === null) {
        await sandbox.fs.deleteFile(`${fsRoot}/${change.path}`).catch(() => undefined);
        await deleteProjectFile(project.id, change.path);
        continue;
      }
      const absoluteTarget = path.posix.join(root, change.path);
      await sandbox.process.executeCommand(
        `mkdir -p ${shellQuote(path.posix.dirname(absoluteTarget))}`,
        root,
        undefined,
        30,
      );
      await sandbox.fs.uploadFile(Buffer.from(change.before), `${fsRoot}/${change.path}`);
      await upsertProjectFile(project.id, change.path, change.before);
    }

    if (restore.changes.some((change) => /(^|\/)(package\.json|package-lock\.json)$/.test(change.path))) {
      const install = await sandbox.process.executeCommand(
        "npm install --include=dev --no-audit --no-fund",
        root,
        { CI: "1" },
        360,
      );
      if (install.exitCode !== 0) {
        throw new Error(`The files were restored, but dependencies could not be reconciled:\n${install.result.slice(-3000)}`);
      }
    }

    if (project.mode !== "security") await ensureVisualEditBridge(sandbox, root, fsRoot).catch(() => null);
    const restoredAt = new Date().toISOString();
    await updateMessageMetadata(checkpoint.id, project.id, { restoredAt });
    const restoredPaths = restore.changes.map((change) => change.path);
    const restoreMessage = await createMessage(
      project.id,
      "tool",
      `## Checkpoint restored\n\nReverted ${restoredPaths.length} ${restoredPaths.length === 1 ? "file" : "files"} to the state before this build.`,
      { checkpointRestore: true, sourceMessageId: checkpoint.id, restoredPaths },
    );
    // Security mode has no preview, and only the user pushes to GitHub, so it stops here.
    if (project.mode === "security") {
      const updatedProject = await updateProject(project.id, viewer.id, { status: "ready" });
      return Response.json({
        message: restoreMessage,
        restoredMessageId: checkpoint.id,
        restoredAt,
        restoredPaths,
        files: await listProjectFiles(project.id),
        project: updatedProject,
        previewUrl: null,
      });
    }
    const previewUrl = await ensurePreviewUrl(project);
    const updatedProject = await updateProject(project.id, viewer.id, {
      status: previewUrl ? "ready" : "error",
      previewUrl: previewUrl ?? project.previewUrl,
    });

    // Like Lovable's "Reverted to commit": the restored code is pushed to the linked repository automatically.
    let github: unknown = null;
    if (await getProjectRepository(project.id, viewer.id)) {
      const original = typeof checkpoint.metadata.summary === "string" ? checkpoint.metadata.summary : "an earlier build";
      const fileList = restoredPaths.slice(0, 15).map((file) => `- ${file}`).join("\n");
      const message = `revert: undo "${original.toLowerCase()}"\n\nRestored ${restoredPaths.length} ${restoredPaths.length === 1 ? "file" : "files"} to their state before that build:\n${fileList}${restoredPaths.length > 15 ? `\n- …and ${restoredPaths.length - 15} more` : ""}`;
      const result = await runGitHubCommit(project, { message });
      github = result.info;
      await updateMessageMetadata(restoreMessage.id, project.id, { github: result.info }).catch(() => null);
    }

    return Response.json({
      message: { ...restoreMessage, metadata: { ...restoreMessage.metadata, ...(github ? { github } : {}) } },
      restoredMessageId: checkpoint.id,
      restoredAt,
      restoredPaths,
      files: await listProjectFiles(project.id),
      project: updatedProject,
      previewUrl,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
