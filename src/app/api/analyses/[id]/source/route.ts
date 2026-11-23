import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { jsonError } from "@/server/http";
import { highlight } from "@/server/highlight";
import { resolveInside } from "@/analyzer/discover";
import { findSecrets, redactSecrets } from "@/analyzer/redact";
import { hashContent } from "@/analyzer/extract/file";

export const dynamic = "force-dynamic";

/**
 * Returns a file of the analyzed project, syntax-highlighted and with
 * credential-like values redacted. Only files that are part of the analysis
 * can be read, and only from inside the project root.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return jsonError("Missing ?file= parameter");
  const result = getStorage().getAnalysisResult(id);
  if (!result) return jsonError("No completed analysis with this id", 404);
  const record = result.files.find((f) => f.path === file);
  if (!record) return jsonError("This file is not part of the analysis", 404);
  const absolute = resolveInside(result.project.root, record.path);
  if (!absolute) return jsonError("Path escapes the project root", 400);

  let text: string;
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) return jsonError("Symbolic links are not followed", 400);
    text = await fs.readFile(absolute, "utf8");
  } catch {
    return jsonError("The file no longer exists on disk. Re-run the analysis to refresh.", 410);
  }
  const secrets = findSecrets(text);
  const safe = redactSecrets(text);
  return NextResponse.json({
    path: record.path,
    language: record.language,
    lines: highlight(safe, record.language),
    redactedLines: [...new Set(secrets.map((s) => s.line))],
    changedSinceAnalysis: record.hash !== hashContent(text),
    absolutePath: absolute,
  });
}
