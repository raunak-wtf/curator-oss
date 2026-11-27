import { copyProjectSandbox, ensurePreviewUrl } from "./daytona";
import { createMessage, createProject, listMessages, updateProject, upsertProjectFile } from "./store";
import type { Project, Viewer } from "./types";

/**
 * Remixing, modeled on Lovable: an independent copy of a project's code in a new project the remixer owns.
 * Copied: the code (and, for the owner only, optionally the chat history).
 * Not copied: secrets, custom domains, publish state, Git sync, Cognix Cloud settings, collaborators.
 */

function appBase() {
  return (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
}

/** Where the "Edit with Curator" badge links: the project's remix page when public remixing is on. */
export function badgeHrefFor(project: Pick<Project, "id" | "publicRemix">) {
  const base = appBase() || "";
  return project.publicRemix ? `${base}/remix/${project.id}?ref=badge` : `${base}/?ref=badge`;
}

export function remixUrlFor(projectId: string) {
  return `${appBase()}/remix/${projectId}`;
}

const MAX_TEXT_FILE = 1_000_000;

/** Creates the copy right away and builds its sandbox in the background, so the remixer lands in it immediately. */
export async function startRemix(input: { source: Project; viewer: Viewer; title: string; includeHistory: boolean }) {
  const { source, viewer } = input;
  const isOwner = source.ownerId === viewer.id;
  const created = await createProject(viewer, `Remix of ${source.title}`);
  const target =
    (await updateProject(created.id, viewer.id, {
      title: input.title.trim().slice(0, 120) || `Remix of ${source.title}`,
      description: source.description,
      status: "building",
    })) ?? created;

  // Only people who can already see the chat may copy it.
  if (input.includeHistory && isOwner) {
    for (const message of await listMessages(source.id)) {
      if (message.role === "tool") continue;
      const { github: _github, githubSync: _sync, questions: _questions, ...metadata } = message.metadata;
      void _github;
      void _sync;
      void _questions;
      await createMessage(target.id, message.role, message.content, { ...metadata, remixedFrom: source.id });
    }
  }
  await createMessage(
    target.id,
    "assistant",
    `## Remixed\n\nThis project is a copy of ${isOwner ? `**${source.title}**` : "a shared project"}. Cognix is copying the code and starting the preview. Secrets, custom domains, publishing, and GitHub sync aren't copied, so add any credentials again in Cloud → Secrets.`,
    { remixedFrom: source.id },
  );

  void copyProjectSandbox(source, target)
    .then(async ({ project, files }) => {
      for (const file of files) {
        if (file.content.length > MAX_TEXT_FILE || file.content.includes(0)) continue;
        await upsertProjectFile(project.id, file.path, file.content.toString("utf8"));
      }
      const previewUrl = await ensurePreviewUrl(project).catch(() => null);
      await updateProject(project.id, viewer.id, { status: previewUrl ? "ready" : "error", previewUrl });
    })
    .catch(async (error) => {
      await updateProject(target.id, viewer.id, { status: "error" }).catch(() => null);
      await createMessage(
        target.id,
        "assistant",
        `## Remix needs attention\n\nThe code couldn't be fully copied: ${error instanceof Error ? error.message.slice(0, 600) : "unknown error"}\n\nAsk Cognix to repair the project, or remix again.`,
        { error: true },
      ).catch(() => null);
    });

  return target;
}
