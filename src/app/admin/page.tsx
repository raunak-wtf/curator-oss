import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminClient } from "@/components/admin-client";
import { getViewer } from "@/lib/auth0";
import { ensureUser, getAdminDashboardData } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/auth/login?returnTo=${encodeURIComponent("/admin")}`);
  }

  await ensureUser(viewer);

  if (!viewer.isAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#141414] px-4 text-white">
        <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-6">
          <div className="flex items-center gap-2.5 text-amber-300">
            <ShieldAlert className="size-5 shrink-0" aria-hidden="true" />
            <h1 className="text-[16px] font-semibold text-white">Admin access required</h1>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-white/65">
            Signed in as <strong className="font-medium text-white">{viewer.email}</strong>, which is not in{" "}
            <code className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[12px] text-white/90">COGNIX_ADMIN_EMAILS</code>.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/45">
            Add your email address to <code className="text-white/75">COGNIX_ADMIN_EMAILS</code> in your server environment and reload this page.
          </p>
          <div className="mt-5 flex items-center gap-2.5">
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90"
            >
              Return to Cognix
            </Link>
            <Link
              href="/billing"
              className="inline-flex h-9 items-center rounded-lg border border-white/15 px-3.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              View billing
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const data = await getAdminDashboardData();

  return <AdminClient viewer={viewer} initialData={data} />;
}
