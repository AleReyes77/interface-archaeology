import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { getJobs } from "@/server/jobs";
import { jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const storage = getStorage();
  const analysis = storage.getAnalysis(id);
  if (!analysis) return jsonError("Analysis not found", 404);
  const project = storage.getProject(analysis.projectId);
  return NextResponse.json({ analysis, project, progress: analysis.status === "running" ? getJobs().progress(id) : null });
}

/** Cancels a running analysis, or deletes a finished one from history. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const storage = getStorage();
  const analysis = storage.getAnalysis(id);
  if (!analysis) return jsonError("Analysis not found", 404);
  if (analysis.status === "running") {
    if (!getJobs().cancel(id)) storage.failAnalysis(id, "cancelled", "Cancelled by the user");
    return NextResponse.json({ cancelled: true });
  }
  storage.deleteAnalysis(id);
  return new NextResponse(null, { status: 204 });
}
