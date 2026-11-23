/**
 * Local persistence for projects, analyses and the per-file extraction cache.
 *
 * Backed by SQLite through Node's built-in `node:sqlite` module, so there is
 * no native dependency to compile. The `Storage` interface keeps the rest of
 * the server independent of the engine.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { FileExtraction } from "@/analyzer/extract/types";
import type { AnalysisLimits, AnalysisResult } from "@/analyzer/types";

export type ProjectSource = "local" | "git" | "sample";

export interface ProjectRecord {
  id: string;
  name: string;
  root: string;
  source: ProjectSource;
  sourceUrl: string | null;
  createdAt: string;
  settings: ProjectSettings;
}

export interface ProjectSettings {
  limits?: Partial<AnalysisLimits>;
}

export type AnalysisStatus = "running" | "completed" | "failed" | "cancelled";

export interface AnalysisSummary {
  id: string;
  projectId: string;
  status: AnalysisStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  analyzerVersion: string | null;
  stats: AnalysisResult["stats"] | null;
  framework: string | null;
}

export interface Storage {
  createProject(input: Omit<ProjectRecord, "id" | "createdAt" | "settings">): ProjectRecord;
  getProject(id: string): ProjectRecord | null;
  findProjectByRoot(root: string): ProjectRecord | null;
  listProjects(): ProjectRecord[];
  updateProjectSettings(id: string, settings: ProjectSettings): void;
  deleteProject(id: string): void;
  createAnalysis(projectId: string): AnalysisSummary;
  completeAnalysis(id: string, result: AnalysisResult): void;
  failAnalysis(id: string, status: "failed" | "cancelled", error: string): void;
  getAnalysis(id: string): AnalysisSummary | null;
  getAnalysisResult(id: string): AnalysisResult | null;
  listAnalyses(projectId?: string): AnalysisSummary[];
  deleteAnalysis(id: string): void;
  getCachedExtraction(key: string): FileExtraction | undefined;
  setCachedExtraction(key: string, value: FileExtraction): void;
}

const MIGRATIONS = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     root TEXT NOT NULL UNIQUE,
     source TEXT NOT NULL,
     source_url TEXT,
     settings TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL
   );
   CREATE TABLE analyses (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     error TEXT,
     analyzer_version TEXT,
     framework TEXT,
     stats TEXT,
     result TEXT
   );
   CREATE INDEX analyses_project ON analyses(project_id, started_at DESC);
   CREATE TABLE extraction_cache (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     used_at TEXT NOT NULL
   );`,
];

interface ProjectRow {
  id: string;
  name: string;
  root: string;
  source: ProjectSource;
  source_url: string | null;
  settings: string;
  created_at: string;
}

interface AnalysisRow {
  id: string;
  project_id: string;
  status: AnalysisStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  analyzer_version: string | null;
  framework: string | null;
  stats: string | null;
}

const toProject = (r: ProjectRow): ProjectRecord => ({
  id: r.id,
  name: r.name,
  root: r.root,
  source: r.source,
  sourceUrl: r.source_url,
  createdAt: r.created_at,
  settings: JSON.parse(r.settings) as ProjectSettings,
});

const toAnalysis = (r: AnalysisRow): AnalysisSummary => ({
  id: r.id,
  projectId: r.project_id,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  error: r.error,
  analyzerVersion: r.analyzer_version,
  framework: r.framework,
  stats: r.stats ? (JSON.parse(r.stats) as AnalysisResult["stats"]) : null,
});

const SUMMARY_COLUMNS = "id, project_id, status, started_at, finished_at, error, analyzer_version, framework, stats";

export class SqliteStorage implements Storage {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    // Runs that were interrupted by a server restart can never finish.
    this.db.prepare("UPDATE analyses SET status = 'failed', error = 'Interrupted: the server stopped during analysis', finished_at = ? WHERE status = 'running'").run(new Date().toISOString());
  }

  createProject(input: Omit<ProjectRecord, "id" | "createdAt" | "settings">): ProjectRecord {
    const record: ProjectRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), settings: {} };
    this.db
      .prepare("INSERT INTO projects (id, name, root, source, source_url, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.name, record.root, record.source, record.sourceUrl, "{}", record.createdAt);
    return record;
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  findProjectByRoot(root: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE root = ?").get(root) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  listProjects(): ProjectRecord[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as unknown as ProjectRow[]).map(toProject);
  }

  updateProjectSettings(id: string, settings: ProjectSettings): void {
    this.db.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(settings), id);
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  createAnalysis(projectId: string): AnalysisSummary {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.db.prepare("INSERT INTO analyses (id, project_id, status, started_at) VALUES (?, ?, 'running', ?)").run(id, projectId, startedAt);
    return { id, projectId, status: "running", startedAt, finishedAt: null, error: null, analyzerVersion: null, stats: null, framework: null };
  }

  completeAnalysis(id: string, result: AnalysisResult): void {
    this.db
      .prepare("UPDATE analyses SET status = 'completed', finished_at = ?, analyzer_version = ?, framework = ?, stats = ?, result = ? WHERE id = ?")
      .run(new Date().toISOString(), result.analyzerVersion, result.framework.label, JSON.stringify(result.stats), JSON.stringify(result), id);
  }

  failAnalysis(id: string, status: "failed" | "cancelled", error: string): void {
    this.db.prepare("UPDATE analyses SET status = ?, error = ?, finished_at = ? WHERE id = ?").run(status, error, new Date().toISOString(), id);
  }

  getAnalysis(id: string): AnalysisSummary | null {
    const row = this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM analyses WHERE id = ?`).get(id) as AnalysisRow | undefined;
    return row ? toAnalysis(row) : null;
  }

  getAnalysisResult(id: string): AnalysisResult | null {
    const row = this.db.prepare("SELECT result FROM analyses WHERE id = ? AND status = 'completed'").get(id) as { result: string | null } | undefined;
    return row?.result ? (JSON.parse(row.result) as AnalysisResult) : null;
  }

  listAnalyses(projectId?: string): AnalysisSummary[] {
    const rows = projectId
      ? this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM analyses WHERE project_id = ? ORDER BY started_at DESC`).all(projectId)
      : this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM analyses ORDER BY started_at DESC LIMIT 200`).all();
    return (rows as unknown as AnalysisRow[]).map(toAnalysis);
  }

  deleteAnalysis(id: string): void {
    this.db.prepare("DELETE FROM analyses WHERE id = ?").run(id);
  }

  getCachedExtraction(key: string): FileExtraction | undefined {
    const row = this.db.prepare("SELECT value FROM extraction_cache WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as FileExtraction) : undefined;
  }

  setCachedExtraction(key: string, value: FileExtraction): void {
    this.db.prepare("INSERT OR REPLACE INTO extraction_cache (key, value, used_at) VALUES (?, ?, ?)").run(key, JSON.stringify(value), new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}

export function dataDirectory(): string {
  return process.env.IA_DATA_DIR ? path.resolve(process.env.IA_DATA_DIR) : path.join(process.cwd(), ".data");
}

const globalStore = globalThis as unknown as { __iaStorage?: SqliteStorage };

/** Process-wide storage instance (survives dev-server hot reloads). */
export function getStorage(): Storage {
  globalStore.__iaStorage ??= new SqliteStorage(path.join(dataDirectory(), "archaeology.db"));
  return globalStore.__iaStorage;
}
