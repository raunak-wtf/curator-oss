import { requireAdmin } from "@/lib/auth0";
import { errorResponse } from "@/lib/http";
import { getAdminDashboardData } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const data = await getAdminDashboardData();
    return Response.json(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
