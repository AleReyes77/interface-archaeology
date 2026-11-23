import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { getJobs } from "@/server/jobs";
import { handleError, jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = getStorage().getProject(id);
    if (!project) return jsonError("Project not found", 404);
    const analysis = getJobs().start(project);
    return NextResponse.json({ analysis }, { status: 202 });
  } catch (error) {
    return handleError(error);
  }
}
