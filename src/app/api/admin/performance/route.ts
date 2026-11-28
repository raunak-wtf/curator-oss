import { requireAdmin } from "@/lib/auth0";
import { errorResponse } from "@/lib/http";
import { getAdminPerformanceData } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const requestedLimit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "200", 10);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 200;
    return Response.json(await getAdminPerformanceData(limit), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
