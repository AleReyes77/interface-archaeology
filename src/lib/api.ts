/**
 * Typed client for the local HTTP API.
 */
import type { AnalysisProgress, AnalysisResult, Language } from "@/analyzer/types";
import type { AnalysisSummary, ProjectRecord, ProjectSettings } from "@/server/storage";
import type { ChangeReport } from "@/server/projects";
import type { HighlightedLine } from "@/server/highlight";

export type { AnalysisSummary, ProjectRecord, ChangeReport, HighlightedLine };

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw new ApiError(body?.error?.message ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export interface ProjectWithLatest extends ProjectRecord {
  latest: AnalysisSummary | null;
}

export interface AnalysisStatusResponse {
  analysis: AnalysisSummary;
  project: ProjectRecord | null;
  progress: AnalysisProgress | null;
}

export interface SourceFile {
  path: string;
  language: Language;
  lines: HighlightedLine[];
  redactedLines: number[];
  changedSinceAnalysis: boolean;
  absolutePath: string;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  home: string;
  separator: string;
  directories: string[];
  looksLikeProject: boolean;
}

export const api = {
  listProjects: () => request<{ projects: ProjectWithLatest[] }>("/api/projects"),
  createProject: (body: { source: "local"; path: string } | { source: "git"; url: string } | { source: "sample" }) =>
    request<{ project: ProjectRecord }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => request<{ project: ProjectRecord; analyses: AnalysisSummary[] }>(`/api/projects/${id}`),
  updateSettings: (id: string, settings: ProjectSettings) => request<{ project: ProjectRecord }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(settings) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  startAnalysis: (projectId: string) => request<{ analysis: AnalysisSummary }>(`/api/projects/${projectId}/analyses`, { method: "POST" }),
  openDemo: () => request<{ analysis: AnalysisSummary; project: ProjectRecord }>("/api/demo", { method: "POST" }),
  listAnalyses: () => request<{ analyses: (AnalysisSummary & { projectName: string })[] }>("/api/analyses"),
  getAnalysis: (id: string) => request<AnalysisStatusResponse>(`/api/analyses/${id}`),
  cancelOrDeleteAnalysis: (id: string) => request<{ cancelled?: boolean } | void>(`/api/analyses/${id}`, { method: "DELETE" }),
  getResult: (id: string) => request<AnalysisResult>(`/api/analyses/${id}/result`),
  getChanges: (id: string) => request<ChangeReport>(`/api/analyses/${id}/changes`),
  getSource: (id: string, file: string) => request<SourceFile>(`/api/analyses/${id}/source?file=${encodeURIComponent(file)}`),
  listDirectory: (path?: string) => request<DirectoryListing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`),
};

export function exportUrl(analysisId: string, format: "json" | "markdown" | "mermaid" | "svg", hiddenKinds?: string[]): string {
  const params = new URLSearchParams({ format });
  if (hiddenKinds) params.set("hide", hiddenKinds.join(","));
  return `/api/analyses/${analysisId}/export?${params}`;
}
