import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const storage = getStorage();
  const projects = new Map(storage.listProjects().map((p) => [p.id, p]));
  const analyses = storage.listAnalyses().map((a) => ({ ...a, projectName: projects.get(a.projectId)?.name ?? "Unknown project" }));
  return NextResponse.json({ analyses });
}
