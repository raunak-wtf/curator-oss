import type { Metadata } from "next";
import Link from "next/link";
import { RemixButton } from "@/components/remix-button";
import { getViewer } from "@/lib/auth0";
import { ensurePreviewUrl, getPublishedAppRuntimeUrl } from "@/lib/daytona";
import { getRemixableProject, getUserName } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Remix · Curator", robots: { index: false } };

type Props = { params: Promise<{ projectId: string }> };

/**
 * Public remix page. Shows a preview and a Remix button, never the project's code, chat, or files.
 * Signed-out visitors don't see the project's name; signed-in visitors see it and who made it.
 */
export default async function RemixPage({ params }: Props) {
  const { projectId } = await params;
  const viewer = await getViewer();
  const project = await getRemixableProject(projectId, viewer?.id ?? null);

  if (!project) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#191919] px-4 text-white">
        <section className="max-w-sm text-center">
          <h1 className="text-[17px] font-semibold">This project is private</h1>
          <p className="mt-2 text-[13px] leading-5 text-white/60">Its owner hasn&apos;t turned on public remixing, or the project no longer exists.</p>
          <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/85">
            Go to home
          </Link>
        </section>
      </main>
    );
  }

  const previewUrl = project.publishedAt
    ? await getPublishedAppRuntimeUrl(project).catch(() => null)
    : await ensurePreviewUrl(project).catch(() => null);
  const creator = viewer ? await getUserName(project.ownerId) : null;

  return (
    <main className="flex h-dvh flex-col bg-[#191919] text-white">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">{viewer ? project.title : "Remix this app"}</p>
          <p className="text-[12px] text-white/45">{viewer ? `By ${creator ?? "a Curator user"}` : "Sign in to make your own copy."}</p>
        </div>
        <RemixButton projectId={project.id} projectTitle={viewer ? project.title : "this app"} signedIn={Boolean(viewer)} canIncludeHistory={viewer?.id === project.ownerId} />
      </header>
      {previewUrl ? (
        <iframe title="App preview" src={previewUrl} className="min-h-0 flex-1 border-0 bg-white" referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <div className="grid flex-1 place-items-center px-4 text-center text-[13px] text-white/55">
          The preview is starting. You can still remix the app.
        </div>
      )}
    </main>
  );
}
