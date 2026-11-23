/**
 * In-process analysis job runner.
 *
 * Analyses run asynchronously in the server process and yield to the event
 * loop between files, so HTTP requests (progress polling, cancellation) stay
 * responsive. Each job has an AbortController; cancellation is checked between
 * files and between stages.
 */
import { analyzeProject } from "@/analyzer/pipeline";
import type { AnalysisProgress } from "@/analyzer/types";
import { getStorage, type AnalysisSummary, type ProjectRecord, type Storage } from "./storage";

export interface JobState {
  id: string;
  projectId: string;
  progress: AnalysisProgress | null;
  controller: AbortController;
  done: Promise<void>;
}

export class JobManager {
  private readonly jobs = new Map<string, JobState>();
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  start(project: ProjectRecord): AnalysisSummary {
    const running = [...this.jobs.values()].find((j) => j.projectId === project.id);
    if (running) {
      const existing = this.storage.getAnalysis(running.id);
      if (existing?.status === "running") return existing;
    }
    const summary = this.storage.createAnalysis(project.id);
    const controller = new AbortController();
    const job: JobState = { id: summary.id, projectId: project.id, progress: null, controller, done: Promise.resolve() };
    job.done = this.run(job, project);
    this.jobs.set(summary.id, job);
    return summary;
  }

  private async run(job: JobState, project: ProjectRecord): Promise<void> {
    try {
      const result = await analyzeProject(project.root, {
        name: project.name,
        limits: project.settings.limits,
        signal: job.controller.signal,
        onProgress: (p) => {
          job.progress = p;
        },
        cache: {
          get: (key) => this.storage.getCachedExtraction(key),
          set: (key, value) => this.storage.setCachedExtraction(key, value),
        },
      });
      this.storage.completeAnalysis(job.id, result);
    } catch (error) {
      if (job.controller.signal.aborted) this.storage.failAnalysis(job.id, "cancelled", "Cancelled by the user");
      else this.storage.failAnalysis(job.id, "failed", describeError(error));
    } finally {
      // Keep the final progress briefly so pollers see the last stage, then release it.
      setTimeout(() => this.jobs.delete(job.id), 60_000).unref?.();
    }
  }

  progress(id: string): AnalysisProgress | null {
    return this.jobs.get(id)?.progress ?? null;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  /** Resolves when the job finishes (used by tests and the CLI-like demo path). */
  async wait(id: string): Promise<void> {
    await this.jobs.get(id)?.done;
  }
}

export function describeError(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e?.code === "ENOENT") return "Project directory not found. It may have been moved or deleted.";
  if (e?.code === "EACCES" || e?.code === "EPERM") return "Permission denied while reading the project directory.";
  if (e?.code === "ENOTDIR") return "The project path is not a directory.";
  return e?.message ?? String(error);
}

const globalJobs = globalThis as unknown as { __iaJobs?: JobManager };

export function getJobs(): JobManager {
  globalJobs.__iaJobs ??= new JobManager(getStorage());
  return globalJobs.__iaJobs;
}
