"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { KIND_META } from "@/analyzer/presentation";
import { LIMITATIONS } from "@/analyzer/export/markdown";
import { traceFlow } from "@/analyzer/queries/flows";
import { NODE_KINDS, type AnalysisResult, type DiagnosticCode } from "@/analyzer/types";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { duration, plural, relativeTime } from "@/lib/format";
import { KindDot, kindStyle } from "@/components/KindBadge";
import styles from "@/components/page.module.css";

const DIAGNOSTIC_LABELS: Record<DiagnosticCode, string> = {
  "symlink-skipped": "Symbolic links not followed",
  "file-too-large": "Files over the size limit",
  "binary-skipped": "Binary files skipped",
  "env-file-skipped": "Environment files (never read)",
  "file-limit-reached": "File limit reached",
  "parse-error": "Parser errors",
  "unresolved-import": "Imports that could not be resolved",
  "possible-secret": "Possible credentials (redacted)",
  "read-error": "Unreadable files or folders",
  "outside-root": "Paths outside the project",
  "unsupported-language": "Unsupported languages",
};

export default function OverviewPage() {
  const { result, index, analysisId } = useAnalysis();
  const project = useWorkspace((s) => s.project);
  const [openCode, setOpenCode] = useState<DiagnosticCode | null>(null);

  const kinds = NODE_KINDS.filter((k) => result.stats.nodesByKind[k]);
  const maxCount = Math.max(...kinds.map((k) => result.stats.nodesByKind[k] ?? 0));

  // Flows that reach a data store are the most useful starting points for a newcomer.
  const keyFlows = useMemo(() => {
    return result.nodes
      .filter((n) => n.kind === "event")
      .map((n) => ({ node: n, flow: traceFlow(result, n.id, index) }))
      .filter((f) => f.flow && (f.flow.reaches.entities.length || f.flow.reaches.endpoints.length))
      .sort((a, b) => b.flow!.steps - a.flow!.steps)
      .slice(0, 5);
  }, [result, index]);

  const hubs = useMemo(() => {
    return result.nodes
      .filter((n) => n.kind !== "event" && n.kind !== "external")
      .map((n) => ({ node: n, degree: new Set([...(index.in.get(n.id) ?? []).map((e) => e.source), ...(index.out.get(n.id) ?? []).map((e) => e.target)]).size, usedBy: new Set((index.in.get(n.id) ?? []).map((e) => e.source)).size }))
      .sort((a, b) => b.usedBy - a.usedBy || b.degree - a.degree)
      .slice(0, 6);
  }, [result, index]);

  const diagnosticGroups = new Map<DiagnosticCode, AnalysisResult["diagnostics"]>();
  for (const d of result.diagnostics) {
    if (!diagnosticGroups.has(d.code)) diagnosticGroups.set(d.code, []);
    diagnosticGroups.get(d.code)!.push(d);
  }
  const diagnostics = [...diagnosticGroups];

  const inferred = result.edges.filter((e) => e.confidence === "inferred").length;
  const packages = Object.entries(result.framework.packages);

  return (
    <div className={styles.scrollPage}>
      <div className={styles.content}>
        <header className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>{result.project.name}</h1>
            <p className={styles.pageLede}>
              {result.framework.label}
              {result.framework.version ? ` ${result.framework.version}` : ""} project, {result.framework.language}. {plural(result.stats.filesAnalyzed, "file")} and {result.stats.totalLoc.toLocaleString("en")} lines read in {duration(result.durationMs)}, {relativeTime(result.generatedAt)}
              {result.stats.filesFromCache ? ` (${result.stats.filesFromCache} unchanged files reused from cache)` : ""}.
            </p>
          </div>
          <Link className="btn btn-primary" href={`/workspace/${analysisId}/map`}>
            Open the architecture map
          </Link>
        </header>

        <div className={styles.twoCol}>
          <div>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>What was found</h2>
                <span className={styles.sectionNote}>
                  {plural(result.edges.length, "relationship")}, {inferred} inferred
                </span>
              </div>
              <div className={styles.bars}>
                {kinds.map((k) => (
                  <div key={k} className={styles.barRow} style={kindStyle(k)}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <KindDot kind={k} />
                      {KIND_META[k].plural}
                    </span>
                    <span className={styles.barTrack}>
                      <span className={styles.barFill} style={{ width: `${((result.stats.nodesByKind[k] ?? 0) / maxCount) * 100}%` }} />
                    </span>
                    <span className={styles.num}>{result.stats.nodesByKind[k]}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Interactions that reach the backend</h2>
                <Link className={styles.sectionNote} href={`/workspace/${analysisId}/flows`}>
                  All flows
                </Link>
              </div>
              {keyFlows.length === 0 ? (
                <p className={styles.sectionNote}>No UI event was traced to a network request or data store.</p>
              ) : (
                <table className={styles.table}>
                  <tbody>
                    {keyFlows.map(({ node, flow }) => {
                      const owner = (index.in.get(node.id) ?? []).find((e) => e.kind === "handles");
                      return (
                        <tr key={node.id}>
                          <td>
                            <Link className={styles.linkBtn} href={`/workspace/${analysisId}/flows?start=${encodeURIComponent(node.id)}`}>
                              <span className="mono">{node.name}</span>
                            </Link>
                            <span className={styles.itemSub}>in {index.nodes.get(owner?.source ?? "")?.name}</span>
                          </td>
                          <td className={styles.mono} style={{ color: "var(--ink-3)" }}>
                            {[...flow!.reaches.endpoints.map((id) => index.nodes.get(id)?.name), ...flow!.reaches.entities.map((id) => `${index.nodes.get(id)?.name} (data)`)].join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            {result.routes.length ? (
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Routes</h2>
                  <span className={styles.sectionNote}>{plural(result.routes.length, "route file")}</span>
                </div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Kind</th>
                      <th>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.routes.map((r) => (
                      <tr key={r.file}>
                        <td className={styles.mono}>
                          {r.nodeId ? (
                            <Link className={styles.linkBtn} href={`/workspace/${analysisId}/map?node=${encodeURIComponent(r.nodeId)}`}>
                              {r.path}
                            </Link>
                          ) : (
                            r.path
                          )}
                        </td>
                        <td>
                          {r.kind}
                          {r.methods?.length ? <span className="muted"> {r.methods.join(" ")}</span> : null}
                        </td>
                        <td className={styles.mono} style={{ color: "var(--ink-3)" }}>
                          {r.file}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </div>

          <div>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Project</h2>
              </div>
              <dl className={styles.facts}>
                <dt>Location</dt>
                <dd className="mono">{result.project.root}</dd>
                <dt>Source</dt>
                <dd>{project?.source === "git" ? project.sourceUrl : project?.source === "sample" ? "Bundled sample project" : "Local directory"}</dd>
                <dt>Framework</dt>
                <dd>
                  {result.framework.label}
                  {result.framework.router ? ` (${[result.framework.router.app && "App Router", result.framework.router.pages && "Pages Router"].filter(Boolean).join(" and ") || "no router files"})` : ""}
                </dd>
                <dt>Detected from</dt>
                <dd>{result.framework.signals.join("; ")}</dd>
                {packages.length ? (
                  <>
                    <dt>Notable packages</dt>
                    <dd className="mono">{packages.map(([n, v]) => `${n} ${v}`).join(", ")}</dd>
                  </>
                ) : null}
                <dt>Dependency depth</dt>
                <dd>
                  {result.dependencies.maxDepth} levels, {plural(result.dependencies.cycles.length, "import cycle")}
                </dd>
              </dl>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Most depended-on</h2>
                <span className={styles.sectionNote}>by number of dependents</span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {hubs.map(({ node, usedBy }) => (
                  <li key={node.id}>
                    <Link className={styles.item} href={`/workspace/${analysisId}/impact?node=${encodeURIComponent(node.id)}`} style={{ paddingLeft: 0 }}>
                      <KindDot kind={node.kind} />
                      <span className={styles.itemName}>{node.name}</span>
                      <span className={styles.itemMeta}>{plural(usedBy, "dependent")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Analysis notes</h2>
                <span className={styles.sectionNote}>{plural(result.diagnostics.length, "note")}</span>
              </div>
              {diagnostics.length === 0 ? <p className={styles.sectionNote}>Every discovered file was parsed without warnings.</p> : null}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {diagnostics.map(([code, list]) => (
                  <li key={code}>
                    <button type="button" className={styles.item} style={{ paddingLeft: 0 }} aria-expanded={openCode === code} onClick={() => setOpenCode(openCode === code ? null : code)}>
                      <span className={styles.pill} data-tone={list.some((d) => d.severity === "error") ? "error" : list.some((d) => d.severity === "warning") ? "warn" : undefined}>
                        {list.length}
                      </span>
                      <span>{DIAGNOSTIC_LABELS[code]}</span>
                    </button>
                    {openCode === code ? (
                      <ul style={{ listStyle: "none", margin: "2px 0 8px", padding: "0 0 0 12px", borderLeft: "1px solid var(--line-strong)", display: "flex", flexDirection: "column", gap: 4 }}>
                        {list.slice(0, 40).map((d, i) => (
                          <li key={i} style={{ fontSize: "var(--text-xs)", color: "var(--ink-2)" }}>
                            {d.message}
                            {d.file ? (
                              <span className="path">
                                {" "}
                                {d.file}
                                {d.line ? `:${d.line}` : ""}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>How to read these results</h2>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)", color: "var(--ink-2)" }}>
                {LIMITATIONS.map((l) => (
                  <li key={l}>{l.replace(/\*/g, "")}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
