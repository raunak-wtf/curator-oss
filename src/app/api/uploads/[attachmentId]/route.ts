import { requireViewer } from "@/lib/auth0";
import { errorResponse, notFound } from "@/lib/http";
import { downloadObject } from "@/lib/storage";
import { getAttachment } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ attachmentId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { attachmentId } = await context.params;
    const attachment = await getAttachment(attachmentId, viewer.id);
    if (!attachment) return notFound("This upload was not found or you no longer have access.");
    const buffer = await downloadObject(attachment.objectKey);
    const safeFilename = attachment.name.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "attachment";
    const isSvgOrXml = /svg|xml|html/i.test(attachment.contentType);
    const disposition = isSvgOrXml ? "attachment" : "inline";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Disposition": `${disposition}; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
