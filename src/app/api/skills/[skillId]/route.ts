import { requireViewer } from "@/lib/auth0";
import { errorResponse, notFound } from "@/lib/http";
import { skillFieldsSchema } from "@/lib/skills";
import { deleteSkill, updateSkill } from "@/lib/store";

type Context = { params: Promise<{ skillId: string }> };

export const runtime = "nodejs";

const SKILL_NOT_FOUND = "This skill was not found. Open /skills to see the skills you have.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { skillId } = await context.params;
    if (!UUID.test(skillId)) return notFound(SKILL_NOT_FOUND);
    const patch = skillFieldsSchema.parse(await request.json());
    const skill = await updateSkill(skillId, viewer.id, patch);
    if (!skill) return notFound(SKILL_NOT_FOUND);
    return Response.json({ skill });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { skillId } = await context.params;
    if (!UUID.test(skillId)) return notFound(SKILL_NOT_FOUND);
    const deleted = await deleteSkill(skillId, viewer.id);
    if (!deleted) return notFound(SKILL_NOT_FOUND);
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
