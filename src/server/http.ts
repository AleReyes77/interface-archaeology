import { NextResponse } from "next/server";
import { ImportError } from "./projects";

export function jsonError(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json({ error: { message, code } }, { status });
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof ImportError) return jsonError(error.message, error.status, "import-error");
  const message = error instanceof Error ? error.message : String(error);
  if (/SQLITE|database/i.test(message)) return jsonError(`Storage error: ${message}`, 500, "storage-error");
  return jsonError(message, 500, "internal-error");
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ImportError("Request body must be valid JSON.");
  }
}
