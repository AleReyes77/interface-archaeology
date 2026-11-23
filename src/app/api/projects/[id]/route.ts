import { NextResponse } from "next/server";
import { getStorage, type ProjectSettings } from "@/server/storage";
import { handleError, jsonError, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const storage = getStorage();
  const project = storage.getProject(id);
  if (!project) return jsonError("Project not found", 404);
  return NextResponse.json({ project, analyses: storage.listAnalyses(id) });
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const storage = getStorage();
    if (!storage.getProject(id)) return jsonError("Project not found", 404);
    const body = await readJson<ProjectSettings>(request);
    const limits = body.limits ?? {};
    const next: NonNullable<ProjectSettings["limits"]> = {};
    if (limits.maxFiles !== undefined) {
      if (!Number.isInteger(limits.maxFiles) || limits.maxFiles < 1 || limits.maxFiles > 50_000) return jsonError("maxFiles must be an integer between 1 and 50000");
      next.maxFiles = limits.maxFiles;
    }
    if (limits.maxFileBytes !== undefined) {
      if (!Number.isInteger(limits.maxFileBytes) || limits.maxFileBytes < 1024 || limits.maxFileBytes > 10_000_000) return jsonError("maxFileBytes must be between 1 KB and 10 MB");
      next.maxFileBytes = limits.maxFileBytes;
    }
    if (limits.ignoredDirectories !== undefined) {
      if (!Array.isArray(limits.ignoredDirectories) || limits.ignoredDirectories.some((d) => typeof d !== "string" || !d.trim() || /[\\/]/.test(d))) {
        return jsonError("ignoredDirectories must be a list of directory names (no slashes)");
      }
      next.ignoredDirectories = [...new Set(limits.ignoredDirectories.map((d) => d.trim()))];
    }
    storage.updateProjectSettings(id, { limits: next });
    return NextResponse.json({ project: storage.getProject(id) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const storage = getStorage();
  if (!storage.getProject(id)) return jsonError("Project not found", 404);
  // Removes the project and its analyses from local storage. Project files on disk are never touched.
  storage.deleteProject(id);
  return new NextResponse(null, { status: 204 });
}
