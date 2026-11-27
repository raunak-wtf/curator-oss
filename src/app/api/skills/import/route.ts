import { z } from "zod";
import { fetchPublicText } from "@/lib/ai/tools";
import { requireViewer } from "@/lib/auth0";
import { errorResponse } from "@/lib/http";
import { SKILL_BODY_MAX, githubSkillSource, parseSkillMarkdown } from "@/lib/skills";
import type { SkillDraft } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireViewer();
    const { url } = z
      .object({ url: z.string().trim().min(1, "Paste a GitHub link after /install-skill.").max(500) })
      .parse(await request.json());
    const source = githubSkillSource(url);

    let file: Awaited<ReturnType<typeof fetchPublicText>>;
    try {
      file = await fetchPublicText(source.rawUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be downloaded.";
      return Response.json({ error: `Could not download the skill from GitHub: ${message} Check the link and try again.` }, { status: 502 });
    }
    if (file.status === 404) {
      return Response.json(
        { error: "No SKILL.md was found at that link. Link to the skill's folder or its SKILL.md file in a public repository." },
        { status: 404 },
      );
    }
    if (file.status !== 200) {
      return Response.json({ error: `GitHub returned HTTP ${file.status}. Check that the repository is public, then try again.` }, { status: 502 });
    }

    const parsed = parseSkillMarkdown(file.raw, source.fallbackName);
    if (!parsed.body) {
      return Response.json({ error: "That file is empty. Link to a SKILL.md that contains instructions." }, { status: 422 });
    }
    if (parsed.body.length > SKILL_BODY_MAX) {
      return Response.json(
        { error: `That skill is longer than ${SKILL_BODY_MAX.toLocaleString("en-US")} characters. Copy the parts you need with /new-skill.` },
        { status: 422 },
      );
    }
    const draft: SkillDraft = { ...parsed, source: "github", sourceUrl: source.sourceUrl };
    return Response.json({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}
