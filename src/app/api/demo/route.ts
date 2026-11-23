import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { getJobs } from "@/server/jobs";
import { handleError } from "@/server/http";
import { registerSampleProject } from "@/server/projects";
import { ANALYZER_VERSION } from "@/analyzer/types";

export const dynamic = "force-dynamic";

/**
 * Opens the bundled sample project. Reuses the latest completed analysis made
 * by the current analyzer version; otherwise starts a real analysis run.
 */
export async function POST() {
  try {
    const storage = getStorage();
    const project = await registerSampleProject(storage);
    const latest = storage.listAnalyses(project.id).find((a) => a.status === "completed" || a.status === "running");
    if (latest && (latest.status === "running" || latest.analyzerVersion === ANALYZER_VERSION)) {
      return NextResponse.json({ analysis: latest, project });
    }
    return NextResponse.json({ analysis: getJobs().start(project), project }, { status: 202 });
  } catch (error) {
    return handleError(error);
  }
}
