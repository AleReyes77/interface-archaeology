"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AnalysisSummary } from "@/lib/api";
import type { AnalysisResult } from "@/analyzer/types";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { duration, relativeTime } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import styles from "@/components/page.module.css";

interface Comparison {
  base: AnalysisSummary;
  addedFiles: string[];
  removedFiles: string[];
  changedFiles: string[];
  addedNodes: string[];
  removedNodes: string[];
  edgeDelta: number;
}

function compare(base: AnalysisResult, current: AnalysisResult, summary: AnalysisSummary): Comparison {
  const baseFiles = new Map(base.files.map((f) => [f.path, f.hash]));
  const curFiles = new Map(current.files.map((f) => [f.path, f.hash]));
  const label = (r: AnalysisResult) => new Map(r.nodes.filter((n) => n.kind !== "event").map((n) => [n.id, n.name]));
  const baseNodes = label(base);
  const curNodes = label(current);
  return {
    base: summary,
    addedFiles: [...curFiles.keys()].filter((f) => !baseFiles.has(f)),
    removedFiles: [...baseFiles.keys()].filter((f) => !curFiles.has(f)),
    changedFiles: [...curFiles].filter(([f, h]) => baseFiles.has(f) && baseFiles.get(f) !== h).map(([f]) => f),
    addedNodes: [...curNodes].filter(([id]) => !baseNodes.has(id)).map(([, n]) => n),
    removedNodes: [...baseNodes].filter(([id]) => !curNodes.has(id)).map(([, n]) => n),
    edgeDelta: current.edges.length - base.edges.length,
  };
}

export default function HistoryPage() {
  const { result, analysisId } = useAnalysis();
  const project = useWorkspace((s) => s.project);
  const [analyses, setAnalyses] = useState<AnalysisSummary[] | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!project) return;
    api
      .getProject(project.id)
      .then((r) => setAnalyses(r.analyses))
      .catch((e: Error) => setError(e.message));
  }, [project]);
  useEffect(load, [load]);

  const runCompare = async (a: AnalysisSummary) => {
    setComparing(a.id);
    try {
      const base = await api.getResult(a.id);
      setComparison(compare(base, result, a));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComparing(null);
    }
  };

  const remove = async (a: AnalysisSummary) => {
    if (!window.confirm("Delete this analysis from the history? The project files are not affected.")) return;
    await api.cancelOrDeleteAnalysis(a.id);
    load();
  };

  const sorted = useMemo(() => analyses ?? [], [analyses]);

  return (
    <div className={styles.scrollPage}>
      <div className={styles.content}>
        <header className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>Analysis history</h1>
            <p className={styles.pageLede}>Every run of the analyzer for {project?.name ?? "this project"}, stored locally. Compare an older run with the one you are viewing to see what changed in the code and in the architecture.</p>
          </div>
        </header>
        {error ? <p style={{ color: "var(--error)" }}>{error}</p> : null}
        {analyses && analyses.length === 0 ? <EmptyState title="Analysis results will appear here once the project has been scanned." /> : null}
        {sorted.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th className={styles.num}>Files</th>
                <th className={styles.num}>Nodes</th>
                <th className={styles.num}>Edges</th>
                <th>Analyzer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const nodes = a.stats ? Object.values(a.stats.nodesByKind).reduce((s, n) => s + (n ?? 0), 0) : null;
                const current = a.id === analysisId;
                return (
                  <tr key={a.id} aria-selected={current}>
                    <td>
                      {new Date(a.startedAt).toLocaleString()}
                      <span className={styles.itemSub}>{relativeTime(a.startedAt)}</span>
                    </td>
                    <td>
                      <span className={styles.pill} data-tone={a.status === "completed" ? "ok" : a.status === "failed" ? "error" : a.status === "cancelled" ? "warn" : undefined} title={a.error ?? undefined}>
                        {a.status}
                      </span>
                      {current ? <span className={styles.sectionNote}> viewing</span> : null}
                    </td>
                    <td className={styles.num}>{a.stats?.filesAnalyzed ?? "—"}</td>
                    <td className={styles.num}>{nodes ?? "—"}</td>
                    <td className={styles.num}>{a.stats?.edges ?? "—"}</td>
                    <td className={styles.mono}>{a.analyzerVersion ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {a.status === "completed" && !current ? (
                        <>
                          <Link className="btn btn-sm btn-ghost" href={`/workspace/${a.id}`}>
                            Open
                          </Link>
                          <button type="button" className="btn btn-sm" onClick={() => void runCompare(a)} disabled={comparing !== null}>
                            {comparing === a.id ? "Comparing…" : "Compare with current"}
                          </button>
                        </>
                      ) : null}
                      {!current && a.status !== "running" ? (
                        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => void remove(a)}>
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        {comparison ? (
          <section className={styles.section} style={{ marginTop: 32 }}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Changes since {new Date(comparison.base.startedAt).toLocaleString()}</h2>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setComparison(null)}>
                Close
              </button>
            </div>
            <dl className={styles.facts}>
              <dt>Files added</dt>
              <dd className="mono">{comparison.addedFiles.join(", ") || "none"}</dd>
              <dt>Files removed</dt>
              <dd className="mono">{comparison.removedFiles.join(", ") || "none"}</dd>
              <dt>Files modified</dt>
              <dd className="mono">{comparison.changedFiles.join(", ") || "none"}</dd>
              <dt>New elements</dt>
              <dd className="mono">{comparison.addedNodes.join(", ") || "none"}</dd>
              <dt>Removed elements</dt>
              <dd className="mono">{comparison.removedNodes.join(", ") || "none"}</dd>
              <dt>Relationships</dt>
              <dd>{comparison.edgeDelta === 0 ? "same count" : `${comparison.edgeDelta > 0 ? "+" : ""}${comparison.edgeDelta}`}</dd>
            </dl>
          </section>
        ) : null}
        <p className={styles.sectionNote} style={{ marginTop: 24 }}>
          The current run took {duration(result.durationMs)} and reused {result.stats.filesFromCache} of {result.stats.filesAnalyzed} files from the extraction cache.
        </p>
      </div>
    </div>
  );
}
