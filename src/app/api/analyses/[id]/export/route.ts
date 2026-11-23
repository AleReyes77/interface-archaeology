import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { jsonError } from "@/server/http";
import { toMarkdown } from "@/analyzer/export/markdown";
import { toMermaid } from "@/analyzer/export/mermaid";
import { toSvg } from "@/analyzer/export/svg";
import { NODE_KINDS, type NodeKind } from "@/analyzer/types";

export const dynamic = "force-dynamic";

const FORMATS = {
  json: { type: "application/json", ext: "json" },
  markdown: { type: "text/markdown; charset=utf-8", ext: "md" },
  mermaid: { type: "text/plain; charset=utf-8", ext: "mmd" },
  svg: { type: "image/svg+xml", ext: "svg" },
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const format = (search.get("format") ?? "json") as keyof typeof FORMATS;
  if (!(format in FORMATS)) return jsonError(`Unsupported format. Use one of: ${Object.keys(FORMATS).join(", ")}`);
  const result = getStorage().getAnalysisResult(id);
  if (!result) return jsonError("No completed analysis with this id", 404);

  const hidden = search.get("hide");
  const hiddenKinds = hidden !== null ? (hidden.split(",").filter((k) => (NODE_KINDS as readonly string[]).includes(k)) as NodeKind[]) : undefined;

  let body: string;
  switch (format) {
    case "markdown":
      body = toMarkdown(result);
      break;
    case "mermaid":
      body = toMermaid(result, hiddenKinds);
      break;
    case "svg":
      body = toSvg(result, { hiddenKinds });
      break;
    default:
      body = JSON.stringify(result, null, 2);
  }
  const { type, ext } = FORMATS[format];
  const filename = `${result.project.name.replace(/[^\w.-]+/g, "-")}-architecture.${ext}`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${search.get("inline") ? "inline" : "attachment"}; filename="${filename}"`,
    },
  });
}
