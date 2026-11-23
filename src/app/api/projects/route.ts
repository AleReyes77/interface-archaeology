import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { handleError, jsonError, readJson } from "@/server/http";
import { importGitRepository, registerLocalProject, registerSampleProject } from "@/server/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const storage = getStorage();
    const projects = storage.listProjects().map((p) => ({ ...p, latest: storage.listAnalyses(p.id)[0] ?? null }));
    return NextResponse.json({ projects });
  } catch (error) {
    return handleError(error);
  }
}

interface CreateBody {
  source?: "local" | "git" | "sample";
  path?: string;
  url?: string;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<CreateBody>(request);
    const storage = getStorage();
    switch (body.source) {
      case "local":
        return NextResponse.json({ project: await registerLocalProject(storage, body.path ?? "") }, { status: 201 });
      case "git":
        return NextResponse.json({ project: await importGitRepository(storage, body.url ?? "") }, { status: 201 });
      case "sample":
        return NextResponse.json({ project: await registerSampleProject(storage) }, { status: 201 });
      default:
        return jsonError("source must be one of: local, git, sample");
    }
  } catch (error) {
    return handleError(error);
  }
}
