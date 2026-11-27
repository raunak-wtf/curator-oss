import { HomeShell } from "@/components/home-shell";
import { getViewer } from "@/lib/auth0";
import { ensureUser, listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await getViewer();
  if (viewer) {
    await ensureUser(viewer);
    const projects = await listProjects(viewer.id);
    return <HomeShell viewer={viewer} projects={projects} />;
  }

  return <HomeShell viewer={null} projects={[]} />;
}
