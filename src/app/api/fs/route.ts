import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Directory browser for the "Open local project" dialog. Lists directory
 * names only (never file contents) so the user can pick a project folder.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("path");
  const target = requested && path.isAbsolute(requested) ? path.resolve(requested) : os.homedir();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return jsonError(`Cannot list ${target}`, 404);
  }
  const directories = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && !e.name.startsWith("$"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .slice(0, 500);
  const names = new Set(entries.map((e) => e.name));
  const parent = path.dirname(target);
  return NextResponse.json({
    path: target,
    parent: parent !== target ? parent : null,
    home: os.homedir(),
    separator: path.sep,
    directories,
    looksLikeProject: names.has("package.json") || names.has("tsconfig.json") || names.has("jsconfig.json"),
  });
}
