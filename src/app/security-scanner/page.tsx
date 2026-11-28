import type { Metadata } from "next";
import { HomeShell } from "@/components/home-shell";
import { getViewer } from "@/lib/auth0";
import { parseRepoFullName } from "@/lib/github/names";
import { ensureUser, getUserSubscription, hasActiveSubscriptionAccess, listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security review · Cognix",
  description: "Ask the Cognix security agent to review, explain, and fix vulnerabilities in a GitHub repository.",
};

/** Security mode: the home composer with a repository selector. `?repo=owner/name` preselects a repository. */
export default async function SecurityScannerPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const [viewer, query] = await Promise.all([getViewer(), searchParams]);
  const initialRepository = query.repo ? parseRepoFullName(query.repo) : null;
  if (!viewer) return <HomeShell viewer={null} projects={[]} initialRepository={initialRepository} billing={null} />;
  await ensureUser(viewer);
  const [projects, subscription] = await Promise.all([
    listProjects(viewer.id),
    getUserSubscription(viewer.id),
  ]);
  return (
    <HomeShell
      viewer={viewer}
      projects={projects}
      initialRepository={initialRepository}
      billing={{
        status: subscription.status,
        hasActiveAccess: Boolean(viewer.isAdmin) || hasActiveSubscriptionAccess(subscription),
        creditsBalanceHundredths: subscription.creditsBalanceHundredths,
        monthlyCreditsHundredths: subscription.monthlyCreditsHundredths,
      }}
    />
  );
}
