"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeImpact, type ImpactItem } from "@/analyzer/queries/impact";
import { describeEdge } from "@/analyzer/queries/graph-index";
import { KIND_META } from "@/analyzer/presentation";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { plural } from "@/lib/format";
import { ConfidenceTag, KindDot } from "@/components/KindBadge";
import { Inspector } from "@/components/inspector/Inspector";
import { EmptyState } from "@/components/EmptyState";
import { buildSearchItems, search } from "@/components/palette/search";
import styles from "@/components/page.module.css";
import impact from "./impact.module.css";

export default function ImpactPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const { node: target } = use(searchParams);
  const router = useRouter();
  const { result, index, analysisId } = useAnalysis();
  const selectedId = useWorkspace((s) => s.selectedId);
  const select = useWorkspace((s) => s.select);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const report = useMemo(() => (target ? computeImpact(result, target, index) : null), [result, index, target]);
  const targetNode = target ? index.nodes.get(target) : undefined;
  const items = useMemo(() => buildSearchItems(result).filter((i) => i.type === "symbol" && i.kind !== "event"), [result]);
  const matches = useMemo(() => (query.trim() ? search(items, query, 4).flatMap((g) => g.items).slice(0, 10) : []), [items, query]);

  const choose = (id: string) => {
    setQuery("");
    select(null);
    router.replace(`/workspace/${analysisId}/impact?node=${encodeURIComponent(id)}`);
  };

  const byDepth = useMemo(() => {
    const m = new Map<number, ImpactItem[]>();
    for (const i of report?.items ?? []) {
      if (!m.has(i.depth)) m.set(i.depth, []);
      m.get(i.depth)!.push(i);
    }
    return [...m].sort(([a], [b]) => a - b);
  }, [report]);

  return (
    <div className={styles.split}>
      <div className={styles.scrollPage}>
        <div className={styles.content}>
          <header className={styles.pageHead}>
            <div style={{ flex: 1 }}>
              <h1 className={styles.pageTitle}>{targetNode ? `What might break if ${targetNode.name} changes` : "What might break if I change this?"}</h1>
              <p className={styles.pageLede}>Potential impact based on detected dependencies: everything that renders, calls, reads or requests the selected element, directly or through other elements. Static analysis cannot see runtime-only coupling, so treat this as a map of where to look, not a guarantee.</p>
            </div>
          </header>

          <div className={impact.picker}>
            <input className="input" placeholder={targetNode ? `Analyze another element (current: ${targetNode.name})` : "Search for a component, hook, service, endpoint or data store"} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Choose an element" onKeyDown={(e) => e.key === "Enter" && matches[0]?.nodeId && choose(matches[0].nodeId)} />
            {matches.length ? (
              <ul className={impact.results} role="listbox">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" className={styles.item} onClick={() => m.nodeId && choose(m.nodeId)}>
                      {m.kind ? <KindDot kind={m.kind} /> : null}
                      <span className={styles.itemName}>{m.title}</span>
                      <span className={styles.itemMeta}>{m.subtitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {!targetNode || !report ? (
            <EmptyState title="Choose an element to measure its reach.">Start with something shared, such as a service, a hook or a data store. The overview lists the most depended-on elements.</EmptyState>
          ) : (
            <>
              <dl className={impact.summary}>
                <div>
                  <dt>Direct dependents</dt>
                  <dd>{report.direct.length}</dd>
                </div>
                <div>
                  <dt>Indirect dependents</dt>
                  <dd>{report.indirect.length}</dd>
                </div>
                <div>
                  <dt>Routes and handlers</dt>
                  <dd>{report.routes.length}</dd>
                </div>
                <div>
                  <dt>User interactions</dt>
                  <dd>{report.flows.length}</dd>
                </div>
                <div>
                  <dt>Importing files</dt>
                  <dd>{report.importingFiles.length}</dd>
                </div>
              </dl>

              {report.items.length === 0 ? (
                <EmptyState title={`Nothing in the analyzed code depends on ${targetNode.name}.`}>It may be an entry point (a page, route or event), unused, or used in ways static analysis cannot see.</EmptyState>
              ) : (
                <ol className={impact.rings} aria-label="Dependents by distance">
                  <li className={impact.ring} data-depth="0">
                    <div className={impact.ringLabel}>
                      <span className={impact.ringNum}>0</span>
                      <span>Changed</span>
                    </div>
                    <div className={impact.ringItems}>
                      <button type="button" className={impact.chip} data-target onClick={() => select(targetNode.id)}>
                        <KindDot kind={targetNode.kind} />
                        {targetNode.name}
                      </button>
                    </div>
                  </li>
                  {byDepth.map(([depth, list]) => (
                    <li key={depth} className={impact.ring} style={{ "--depth": depth } as React.CSSProperties}>
                      <div className={impact.ringLabel}>
                        <span className={impact.ringNum}>{depth}</span>
                        <span>{depth === 1 ? "Direct" : `${depth} steps away`}</span>
                      </div>
                      <div className={impact.ringItems}>
                        {list.map((item) => {
                          const n = index.nodes.get(item.nodeId)!;
                          const open = expanded === item.nodeId;
                          return (
                            <div key={item.nodeId} className={impact.itemWrap}>
                              <button type="button" className={impact.chip} data-selected={selectedId === n.id || undefined} aria-expanded={open} onClick={() => {
                                  setExpanded(open ? null : item.nodeId);
                                  select(n.id);
                                }}
                              >
                                <KindDot kind={n.kind} />
                                {n.name}
                                {item.confidence === "inferred" ? <span className={impact.inferred} title="Path includes an inferred relationship">inferred</span> : null}
                              </button>
                              {open ? (
                                <ol className={impact.why}>
                                  {item.path.map((e) => (
                                    <li key={e.id}>{describeEdge(e, index)}</li>
                                  ))}
                                </ol>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <div className={styles.twoCol} style={{ marginTop: 24 }}>
                <div>
                  {report.flows.length ? (
                    <section className={styles.section}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>User interactions that pass through it</h2>
                      </div>
                      {report.flows.map((f) => {
                        const ev = index.nodes.get(f.nodeId)!;
                        const owner = (index.in.get(ev.id) ?? []).find((e) => e.kind === "handles");
                        return (
                          <Link key={f.nodeId} className={styles.item} style={{ paddingLeft: 0 }} href={`/workspace/${analysisId}/flows?start=${encodeURIComponent(f.nodeId)}`}>
                            <KindDot kind="event" />
                            <span className={styles.itemName}>{ev.name}</span>
                            <span className={styles.sectionNote}>in {index.nodes.get(owner?.source ?? "")?.name}</span>
                            <ConfidenceTag confidence={f.confidence} />
                          </Link>
                        );
                      })}
                    </section>
                  ) : null}
                  {report.routes.length ? (
                    <section className={styles.section}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>Routes and handlers</h2>
                      </div>
                      {report.routes.map((r) => {
                        const n = index.nodes.get(r.nodeId)!;
                        return (
                          <button key={r.nodeId} type="button" className={styles.item} style={{ paddingLeft: 0 }} onClick={() => select(n.id)}>
                            <KindDot kind={n.kind} />
                            <span className={styles.itemName}>{n.route ?? n.name}</span>
                            <span className={styles.sectionNote}>{KIND_META[n.kind].label}</span>
                          </button>
                        );
                      })}
                    </section>
                  ) : null}
                </div>
                <div>
                  <section className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2 className={styles.sectionTitle}>Files that import {targetNode.file ? "its file" : "it"}</h2>
                      <span className={styles.sectionNote}>{report.importingFiles.length}</span>
                    </div>
                    {report.importingFiles.length === 0 ? <p className={styles.sectionNote}>{targetNode.file ? "No other file imports this file." : "Not a file-backed element."}</p> : null}
                    {report.importingFiles.map((f) => (
                      <Link key={f.file} className={styles.item} style={{ paddingLeft: 0 }} href={`/workspace/${analysisId}/dependencies?file=${encodeURIComponent(f.file)}`}>
                        <span className={styles.itemName}>{f.file}</span>
                        <span className={styles.itemMeta}>{f.depth === 1 ? "direct" : `${f.depth} hops`}</span>
                      </Link>
                    ))}
                  </section>
                  {report.dependsOn.length ? (
                    <section className={styles.section}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>It depends on</h2>
                        <span className={styles.sectionNote}>for context</span>
                      </div>
                      {report.dependsOn.map((e) => (
                        <p key={e.id} className={styles.sectionNote} style={{ marginBottom: 4 }}>
                          {describeEdge(e, index)}
                        </p>
                      ))}
                    </section>
                  ) : null}
                </div>
              </div>
              <p className={styles.sectionNote} style={{ marginTop: 16 }}>
                {plural(report.items.length, "element")} within {plural(report.maxDepth, "step")}. Paths marked inferred include a heuristic relationship such as URL matching or prop forwarding.
              </p>
            </>
          )}
        </div>
      </div>
      {selectedId && index.nodes.has(selectedId) ? <Inspector nodeId={selectedId} /> : null}
    </div>
  );
}
