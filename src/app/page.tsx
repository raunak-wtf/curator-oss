import { HomeShell } from "@/components/home-shell";
import { getViewer } from "@/lib/auth0";
import { ensureUser, getUserSubscription, hasActiveSubscriptionAccess, listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await getViewer();
  if (viewer) {
    await ensureUser(viewer);
    const [projects, subscription] = await Promise.all([
      listProjects(viewer.id),
      getUserSubscription(viewer.id),
    ]);
    return (
      <HomeShell
        viewer={viewer}
        projects={projects}
        billing={{
          status: subscription.status,
          hasActiveAccess: Boolean(viewer.isAdmin) || hasActiveSubscriptionAccess(subscription),
          creditsBalanceHundredths: subscription.creditsBalanceHundredths,
          monthlyCreditsHundredths: subscription.monthlyCreditsHundredths,
        }}
      />
    );
  }

  return <HomeShell viewer={null} projects={[]} billing={null} />;
}
