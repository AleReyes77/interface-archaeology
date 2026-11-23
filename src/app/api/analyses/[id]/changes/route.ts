import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { detectChanges } from "@/server/projects";
import { handleError, jsonError } from "@/server/http";
import { describeError } from "@/server/jobs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = getStorage().getAnalysisResult(id);
  if (!result) return jsonError("No completed analysis with this id", 404);
  try {
    return NextResponse.json(await detectChanges(result));
  } catch (error) {
    return handleError(new Error(describeError(error)));
  }
}
