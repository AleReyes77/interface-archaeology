import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqliteStorage } from "@/server/storage";
import { JobManager } from "@/server/jobs";
import { detectChanges, importGitRepository, registerLocalProject, validateLocalDirectory, ImportError } from "@/server/projects";
import { discoverFiles, DEFAULT_LIMITS } from "@/analyzer/discover";
import { analyzeProject } from "@/analyzer/pipeline";

const FIXTURE = path.join(process.cwd(), "fixtures", "inkwell");
let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ia-test-"));
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("SqliteStorage + JobManager", () => {
  it("persists projects, runs an analysis job and stores the result", async () => {
    const storage = new SqliteStorage(path.join(tmp, "db.sqlite"));
    const project = await registerLocalProject(storage, FIXTURE);
    expect(await registerLocalProject(storage, FIXTURE)).toEqual(project); // idempotent by root
    const jobs = new JobManager(storage);
    const summary = jobs.start(project);
    expect(summary.status).toBe("running");
    await jobs.wait(summary.id);
    const done = storage.getAnalysis(summary.id)!;
    expect(done.status).toBe("completed");
    expect(done.stats!.filesAnalyzed).toBe(37);
    expect(storage.getAnalysisResult(summary.id)!.framework.name).toBe("nextjs");

    // Second run hits the extraction cache.
    const second = jobs.start(project);
    await jobs.wait(second.id);
    expect(storage.getAnalysis(second.id)!.stats!.filesFromCache).toBe(37);
    expect(storage.listAnalyses(project.id)).toHaveLength(2);

    storage.deleteProject(project.id);
    expect(storage.listAnalyses(project.id)).toHaveLength(0);
    storage.close();
  });

  it("records cancellation", async () => {
    const storage = new SqliteStorage(":memory:");
    const project = storage.createProject({ name: "x", root: FIXTURE, source: "local", sourceUrl: null });
    const jobs = new JobManager(storage);
    const summary = jobs.start(project);
    jobs.cancel(summary.id);
    await jobs.wait(summary.id);
    expect(storage.getAnalysis(summary.id)).toMatchObject({ status: "cancelled" });
  });

  it("records failures with a readable message", async () => {
    const storage = new SqliteStorage(":memory:");
    const project = storage.createProject({ name: "gone", root: path.join(tmp, "does-not-exist"), source: "local", sourceUrl: null });
    const jobs = new JobManager(storage);
    const summary = jobs.start(project);
    await jobs.wait(summary.id);
    expect(storage.getAnalysis(summary.id)).toMatchObject({ status: "failed", error: expect.stringContaining("not found") });
  });

  it("marks runs interrupted by a restart as failed", async () => {
    const file = path.join(tmp, "restart.sqlite");
    const a = new SqliteStorage(file);
    const project = a.createProject({ name: "r", root: FIXTURE, source: "local", sourceUrl: null });
    const run = a.createAnalysis(project.id);
    a.close();
    const b = new SqliteStorage(file);
    expect(b.getAnalysis(run.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Interrupted") });
    b.close();
  });
});

describe("project import safety", () => {
  it("validates local directories", async () => {
    await expect(validateLocalDirectory("relative/path")).rejects.toBeInstanceOf(ImportError);
    await expect(validateLocalDirectory(path.join(tmp, "missing"))).rejects.toThrow(/not found/);
    await expect(validateLocalDirectory(path.join(FIXTURE, "package.json"))).rejects.toThrow(/file, not a directory/);
    await expect(validateLocalDirectory(path.parse(tmp).root)).rejects.toThrow(/filesystem root/);
  });

  it("rejects non-HTTPS and credential-bearing Git URLs before running git", async () => {
    const storage = new SqliteStorage(":memory:");
    for (const url of ["file:///etc", "git@github.com:a/b.git", "https://user:pass@github.com/a/b", "http://github.com/a/b", "https://github.com/a/b; rm -rf /"]) {
      await expect(importGitRepository(storage, url)).rejects.toThrow(/Only public HTTPS/);
    }
  });

  it("enforces size limits, ignores dependency folders and never reads env files", async () => {
    const dir = path.join(tmp, "limits");
    await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "small.ts"), "export const a = 1;");
    await fs.writeFile(path.join(dir, "src", "huge.ts"), `export const b = "${"x".repeat(5000)}";`);
    await fs.writeFile(path.join(dir, "src", "types.d.ts"), "declare const x: number;");
    await fs.writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;");
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1");
    const result = await discoverFiles(dir, { ...DEFAULT_LIMITS, maxFileBytes: 1024 });
    expect(result.files.map((f) => f.path)).toEqual(["src/small.ts"]);
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual(["env-file-skipped", "file-too-large"]);
  });

  it("does not follow symbolic links", async () => {
    const dir = path.join(tmp, "links");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "real.ts"), "export const r = 1;");
    try {
      await fs.symlink(path.join(FIXTURE, "src"), path.join(dir, "outside"), "junction");
    } catch {
      return; // creating links needs privileges on some systems
    }
    const result = await discoverFiles(dir);
    expect(result.files.map((f) => f.path)).toEqual(["real.ts"]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "symlink-skipped", file: "outside" }));
  });

  it("stops at the file limit and reports it", async () => {
    const result = await analyzeProject(FIXTURE, { limits: { maxFiles: 5 } });
    expect(result.stats.filesAnalyzed).toBe(5);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "file-limit-reached" }));
  });

  it("detects changed, added and removed files since an analysis", async () => {
    const copy = path.join(tmp, "copy");
    await fs.cp(FIXTURE, copy, { recursive: true });
    const result = await analyzeProject(copy);
    expect((await detectChanges(result)).outdated).toBe(false);
    await fs.appendFile(path.join(copy, "src", "lib", "format.ts"), "\nexport const added = 1;\n");
    await fs.writeFile(path.join(copy, "src", "new.ts"), "export {};");
    await fs.rm(path.join(copy, "src", "types.ts"));
    const report = await detectChanges(result);
    expect(report).toMatchObject({ outdated: true, modified: ["src/lib/format.ts"], added: ["src/new.ts"], removed: ["src/types.ts"] });
  });
});
