import { z } from "zod";
import { requireAdmin } from "@/lib/auth0";
import { errorResponse } from "@/lib/http";
import { adminAdjustUserBilling } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ userId: string }> };

const adjustSchema = z.object({
  grantCredits: z.number().min(-10_000).max(10_000).optional(),
  setCreditsBalance: z.number().min(0).max(100_000).optional(),
  monthlyCredits: z.number().min(1).max(100_000).optional(),
  setStatus: z.enum(["inactive", "active", "on_hold", "cancelled", "expired", "failed"]).optional(),
  extendDays: z.number().int().min(1).max(365).optional(),
});

export async function POST(request: Request, context: Context) {
  try {
    await requireAdmin();
    const { userId } = await context.params;
    const decodedUserId = decodeURIComponent(userId);
    const body = adjustSchema.parse(await request.json());

    const subscription = await adminAdjustUserBilling({
      userId: decodedUserId,
      grantCreditsHundredths:
        typeof body.grantCredits === "number" ? Math.round(body.grantCredits * 100) : undefined,
      setCreditsBalanceHundredths:
        typeof body.setCreditsBalance === "number" ? Math.round(body.setCreditsBalance * 100) : undefined,
      monthlyCreditsHundredths:
        typeof body.monthlyCredits === "number" ? Math.round(body.monthlyCredits * 100) : undefined,
      setStatus: body.setStatus,
      extendDays: body.extendDays,
    });

    return Response.json({ subscription });
  } catch (error) {
    return errorResponse(error);
  }
}
