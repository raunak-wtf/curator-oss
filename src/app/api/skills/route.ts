import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { errorResponse } from "@/lib/http";
import { skillFieldsSchema } from "@/lib/skills";
import { createSkill, listSkills } from "@/lib/store";

export const runtime = "nodejs";

const createSkillSchema = skillFieldsSchema.extend({
  source: z.enum(["ai", "github", "manual"]).default("manual"),
  sourceUrl: z.string().url().max(500).startsWith("https://github.com/").nullable().optional().default(null),
});

export async function GET() {
  try {
    const viewer = await requireViewer();
    return Response.json({ skills: await listSkills(viewer.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const input = createSkillSchema.parse(await request.json());
    const skill = await createSkill(viewer.id, {
      ...input,
      sourceUrl: input.source === "github" ? input.sourceUrl : null,
    });
    return Response.json({ skill }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
