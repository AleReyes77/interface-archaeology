/**
 * Project import: local directories, Git repositories and the bundled sample.
 * Imported projects are untrusted — they are read, never executed or installed.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { DEFAULT_LIMITS, discoverFiles, resolveInside } from "@/analyzer/discover";
import { hashContent } from "@/analyzer/extract/file";
import type { AnalysisResult } from "@/analyzer/types";
import { dataDirectory, type ProjectRecord, type Storage } from "./storage";

const run = promisify(execFile);

export class ImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function sampleProjectRoot(): string {
  return path.join(process.cwd(), "fixtures", "inkwell");
}

async function projectName(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { name?: unknown };
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
  } catch {
    // fall through to the directory name
  }
  return path.basename(root);
}

export async function validateLocalDirectory(input: string): Promise<string> {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) throw new ImportError("Enter the absolute path of a project directory.");
  if (!path.isAbsolute(trimmed)) throw new ImportError("The path must be absolute, e.g. C:\\code\\my-app or /home/me/my-app.");
  let real: string;
  try {
    real = await fs.realpath(trimmed);
  } catch {
    throw new ImportError(`Directory not found: ${trimmed}`, 404);
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new ImportError("The path points to a file, not a directory.");
  if (path.parse(real).root === real) throw new ImportError("Refusing to analyze a filesystem root. Choose a project directory.");
  try {
    await fs.access(real, fs.constants.R_OK);
  } catch {
    throw new ImportError("The directory is not readable by the server process.", 403);
  }
  return real;
}

export async function registerLocalProject(storage: Storage, input: string): Promise<ProjectRecord> {
  const root = await validateLocalDirectory(input);
  return storage.findProjectByRoot(root) ?? storage.createProject({ name: await projectName(root), root, source: "local", sourceUrl: null });
}

export async function registerSampleProject(storage: Storage): Promise<ProjectRecord> {
  const root = await fs.realpath(sampleProjectRoot());
  return storage.findProjectByRoot(root) ?? storage.createProject({ name: "inkwell (sample)", root, source: "sample", sourceUrl: null });
}

const GIT_URL = /^https:\/\/[a-z0-9.-]+(?::\d+)?\/[\w.\-/]+?(?:\.git)?\/?$/i;

export async function importGitRepository(storage: Storage, url: string): Promise<ProjectRecord> {
  const clean = url.trim();
  if (!GIT_URL.test(clean)) {
    throw new ImportError("Only public HTTPS repository URLs are supported (e.g. https://github.com/owner/repo). Credentials, SSH and file URLs are rejected.");
  }
  const slug = clean.replace(/\.git\/?$/, "").split("/").filter(Boolean).slice(-2).join("-").replace(/[^\w.-]/g, "_");
  const target = path.join(dataDirectory(), "repos", `${slug}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    // Shallow clone without submodules, LFS smudging or symlinks. Hooks are never
    // part of a cloned repository, so no code from the remote runs.
    await run(
      "git",
      ["-c", "core.symlinks=false", "-c", "protocol.file.allow=never", "clone", "--depth", "1", "--single-branch", "--no-tags", "--", clean, target],
      { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_ASKPASS: "echo" }, windowsHide: true },
    );
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    const message = (error as { stderr?: string }).stderr?.trim().split("\n").pop() ?? (error as Error).message;
    throw new ImportError(`git clone failed: ${message}`, 502);
  }
  const name = slug.split("-").slice(-1)[0] ?? slug;
  return storage.createProject({ name: (await projectName(target)) || name, root: target, source: "git", sourceUrl: clean });
}

export interface ChangeReport {
  checkedAt: string;
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: number;
  outdated: boolean;
}

/** Compares the files on disk with the ones recorded in an analysis. */
export async function detectChanges(result: AnalysisResult): Promise<ChangeReport> {
  const discovery = await discoverFiles(result.project.root, { ...DEFAULT_LIMITS, ...result.limits });
  const before = new Map(result.files.map((f) => [f.path, f.hash]));
  const added: string[] = [];
  const modified: string[] = [];
  let unchanged = 0;
  for (const file of discovery.files) {
    const previous = before.get(file.path);
    before.delete(file.path);
    if (previous === undefined) {
      added.push(file.path);
      continue;
    }
    const absolute = resolveInside(discovery.root, file.path);
    if (!absolute) continue;
    const hash = hashContent(await fs.readFile(absolute, "utf8"));
    if (hash === previous) unchanged++;
    else modified.push(file.path);
  }
  const removed = [...before.keys()];
  return { checkedAt: new Date().toISOString(), added, removed, modified, unchanged, outdated: added.length + removed.length + modified.length > 0 };
}
