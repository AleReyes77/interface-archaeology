import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";
import { jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = getStorage().getAnalysisResult(id);
  if (!result) return jsonError("No completed analysis with this id", 404);
  return NextResponse.json(result);
}
