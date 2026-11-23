"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FileEdge } from "@/analyzer/types";
import { useAnalysis } from "@/lib/store";
import { plural } from "@/lib/format";
import { KindDot } from "@/components/KindBadge";
import { EmptyState } from "@/components/EmptyState";
import styles from "@/components/page.module.css";

type SortKey = "path" | "fanIn" | "fanOut" | "depth";

export default function DependenciesPage({ searchParams }: { searchParams: Promise<{ file?: string }> }) {
  const { file: selectedFile } = use(searchParams);
  const router = useRouter();
  const { result, index, analysisId } = useAnalysis();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("fanIn");

  const graph = useMemo(() => {
    const out = new Map<string, FileEdge[]>();
    const inc = new Map<string, FileEdge[]>();
    for (const e of result.fileEdges) {
      if (!out.has(e.from)) out.set(e.from, []);
      if (!inc.has(e.to)) inc.set(e.to, []);
      out.get(e.from)!.push(e);
      inc.get(e.to)!.push(e);
    }
    return { out, inc };
  }, [result]);

  const inCycle = useMemo(() => new Set(result.dependencies.cycles.flat()), [result]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.files
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .map((f) => ({
        path: f.path,
        fanIn: new Set((graph.inc.get(f.path) ?? []).map((e) => e.from)).size,
        fanOut: new Set((graph.out.get(f.path) ?? []).map((e) => e.to)).size,
        depth: result.dependencies.depthByFile[f.path] ?? 0,
      }))
      .sort((a, b) => (sort === "path" ? a.path.localeCompare(b.path) : b[sort] - a[sort] || a.path.localeCompare(b.path)));
  }, [result, graph, query, sort]);

  const packages = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const f of result.files) {
      for (const imp of f.imports) {
        if (!imp.packageName) continue;
        if (!m.has(imp.packageName)) m.set(imp.packageName, new Set());
        m.get(imp.packageName)!.add(f.path);
      }
    }
    return [...m].sort((a, b) => b[1].size - a[1].size);
  }, [result]);

  const file = selectedFile ? result.files.find((f) => f.path === selectedFile) : undefined;
  const transitiveDependents = useMemo(() => {
    if (!file) return 0;
    const seen = new Set([file.path]);
    let level = [file.path];
    while (level.length) {
      const next: string[] = [];
      for (const f of level) {
        for (const e of graph.inc.get(f) ?? []) {
          if (seen.has(e.from)) continue;
          seen.add(e.from);
          next.push(e.from);
        }
      }
      level = next;
    }
    return seen.size - 1;
  }, [file, graph]);

  const openFile = (p: string) => router.replace(`/workspace/${analysisId}/dependencies?file=${encodeURIComponent(p)}`);
  const sortButton = (key: SortKey, label: string) => (
    <button type="button" data-active={sort === key || undefined} onClick={() => setSort(key)}>
      {label}
    </button>
  );
  const maxFanIn = rows.reduce((m, r) => Math.max(m, r.fanIn), 0);

  return (
    <div className={styles.split}>
      <aside className={styles.listPane} style={{ width: 460 }} aria-label="Files">
        <div className={styles.listHead}>
          <input className="input" placeholder="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter files" />
        </div>
        <div className={styles.listBody} style={{ padding: "0 12px 24px" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{sortButton("path", "File")}</th>
                <th className={styles.num} title="Files that import this file">{sortButton("fanIn", "In")}</th>
                <th className={styles.num} title="Project files this file imports">{sortButton("fanOut", "Out")}</th>
                <th className={styles.num} title="Longest chain of runtime imports below this file">{sortButton("depth", "Depth")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.path} data-clickable aria-selected={r.path === selectedFile} onClick={() => openFile(r.path)}>
                  <td className={styles.mono} style={{ overflowWrap: "anywhere" }}>
                    {r.path}
                    {inCycle.has(r.path) ? <span className={styles.pill} data-tone="warn" style={{ marginLeft: 6 }}>cycle</span> : null}
                  </td>
                  <td className={styles.num}>{r.fanIn}</td>
                  <td className={styles.num}>{r.fanOut}</td>
                  <td className={styles.num}>{r.depth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>

      <div className={styles.scrollPage}>
        <div className={styles.content}>
          {file ? (
            <>
              <header className={styles.pageHead}>
                <div>
                  <h1 className={styles.pageTitle} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", letterSpacing: 0 }}>
                    {file.path}
                  </h1>
                  <p className={styles.pageLede}>
                    {plural(file.loc, "line")}, {file.language.toUpperCase()}
                    {file.directives.length ? `, ${file.directives.map((d) => `"${d}"`).join(", ")}` : ""}. Changing it can reach {plural(transitiveDependents, "file")} through imports.
                  </p>
                </div>
              </header>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Symbols defined here</h2>
                </div>
                {file.symbols.length === 0 ? <p className={styles.sectionNote}>No components, hooks, services or functions were extracted from this file.</p> : null}
                {file.symbols.map((id) => {
                  const n = index.nodes.get(id);
                  if (!n) return null;
                  return (
                    <Link key={id} className={styles.item} style={{ paddingLeft: 0 }} href={`/workspace/${analysisId}/map?node=${encodeURIComponent(id)}`}>
                      <KindDot kind={n.kind} />
                      <span className={styles.itemName}>{n.name}</span>
                      <span className={styles.itemMeta}>line {n.line}</span>
                    </Link>
                  );
                })}
              </section>

              <div className={styles.twoCol}>
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Imports</h2>
                    <span className={styles.sectionNote}>{file.imports.length}</span>
                  </div>
                  <table className={styles.table}>
                    <tbody>
                      {file.imports.map((imp, i) => (
                        <tr key={i} data-clickable={imp.resolved ? "" : undefined} onClick={() => imp.resolved && openFile(imp.resolved)}>
                          <td className={styles.mono}>{imp.resolved ?? imp.specifier}</td>
                          <td className={styles.sectionNote}>{imp.resolved ? imp.kind : imp.packageName ? "package" : "unresolved"}</td>
                          <td className={styles.num}>{imp.line}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Imported by</h2>
                    <span className={styles.sectionNote}>{(graph.inc.get(file.path) ?? []).length}</span>
                  </div>
                  {(graph.inc.get(file.path) ?? []).length === 0 ? <p className={styles.sectionNote}>No project file imports this file. It may be an entry point (route, page, config) or unused.</p> : null}
                  <table className={styles.table}>
                    <tbody>
                      {(graph.inc.get(file.path) ?? []).map((e) => (
                        <tr key={`${e.from}${e.kind}`} data-clickable onClick={() => openFile(e.from)}>
                          <td className={styles.mono}>{e.from}</td>
                          <td className={styles.sectionNote}>{e.kind}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            </>
          ) : (
            <>
              <header className={styles.pageHead}>
                <div>
                  <h1 className={styles.pageTitle}>Dependencies</h1>
                  <p className={styles.pageLede}>
                    Measured from {plural(result.fileEdges.length, "resolved import")} between {plural(result.files.length, "file")}. Select a file to see what it imports and what imports it.
                  </p>
                </div>
              </header>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Measurements</h2>
                </div>
                <dl className={styles.facts}>
                  <dt>Longest import chain</dt>
                  <dd>{plural(result.dependencies.maxDepth, "level")}</dd>
                  <dt>Import cycles</dt>
                  <dd>{result.dependencies.cycles.length === 0 ? "None detected (type-only imports excluded)" : result.dependencies.cycles.length}</dd>
                  <dt>Isolated modules</dt>
                  <dd>{result.dependencies.isolated.length ? result.dependencies.isolated.length : "None"}</dd>
                  <dt>Most imported file</dt>
                  <dd className="mono">{rows.find((r) => r.fanIn === maxFanIn)?.path ?? "—"} ({maxFanIn})</dd>
                </dl>
              </section>
              {result.dependencies.cycles.length ? (
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Import cycles</h2>
                    <span className={styles.sectionNote}>Modules that import each other, directly or indirectly</span>
                  </div>
                  {result.dependencies.cycles.map((c, i) => (
                    <p key={i} className={styles.mono} style={{ marginBottom: 6 }}>
                      {c.join("  ↔  ")}
                    </p>
                  ))}
                </section>
              ) : null}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Packages</h2>
                  <span className={styles.sectionNote}>by number of importing files</span>
                </div>
                <table className={styles.table}>
                  <tbody>
                    {packages.map(([name, files]) => (
                      <tr key={name}>
                        <td className={styles.mono}>{name}</td>
                        <td className={styles.sectionNote}>{name.startsWith("node:") ? "built-in" : (index.nodes.get(`pkg:${name}`)?.version ?? (name === "react" || name === "next" || name === "react-dom" ? "framework" : "not in package.json"))}</td>
                        <td className={styles.num}>{files.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Heuristic observations</h2>
                  <span className={styles.sectionNote}>Patterns worth a look, not verdicts</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-sm)", color: "var(--ink-2)" }}>
                  {rows
                    .filter((r) => maxFanIn >= 4 && r.fanIn >= Math.max(4, maxFanIn * 0.6))
                    .map((r) => (
                      <li key={r.path}>
                        <span className="mono">{r.path}</span> is imported by {r.fanIn} files; changes to it have a wide reach.
                      </li>
                    ))}
                  {result.dependencies.isolated.map((f) => (
                    <li key={f}>
                      <span className="mono">{f}</span> neither imports nor is imported by project files. Framework entry points look like this; anything else may be unused.
                    </li>
                  ))}
                  {result.dependencies.cycles.length ? <li>{plural(result.dependencies.cycles.length, "import cycle")} can make initialization order and refactoring harder to reason about.</li> : null}
                </ul>
              </section>
            </>
          )}
          {!file && selectedFile ? <EmptyState title="That file is not part of this analysis." /> : null}
        </div>
      </div>
    </div>
  );
}
