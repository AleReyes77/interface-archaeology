"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Crosshair, Network, Radar, Waypoints, X } from "lucide-react";
import { EDGE_META, KIND_META } from "@/analyzer/presentation";
import type { EdgeKind, GraphEdge, GraphNode } from "@/analyzer/types";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { ConfidenceTag, KindDot, KindLabel } from "../KindBadge";
import { SourceView } from "../source/SourceView";
import styles from "./inspector.module.css";

type Tab = "overview" | "source";

export function Inspector({ nodeId, onFocus, showMapLink = true }: { nodeId: string; onFocus?: (id: string) => void; showMapLink?: boolean }) {
  const { result, index, analysisId } = useAnalysis();
  const select = useWorkspace((s) => s.select);
  const node = index.nodes.get(nodeId);
  const [tab, setTab] = useState<Tab>("overview");
  // A source location opened from evidence belongs to the node it was opened for.
  const [opened, setOpened] = useState<{ nodeId: string; file: string; line?: number; endLine?: number } | null>(null);
  const sourceTarget = opened?.nodeId === nodeId ? opened : null;

  const outgoing = useMemo(() => index.out.get(nodeId) ?? [], [index, nodeId]);
  const incoming = useMemo(() => index.in.get(nodeId) ?? [], [index, nodeId]);
  const network = useMemo(() => result.network.filter((n) => n.callerId === nodeId), [result, nodeId]);

  if (!node) return null;
  const dependsOn = new Set(outgoing.map((e) => e.target)).size;
  const usedBy = new Set(incoming.map((e) => e.source)).size;
  const target = sourceTarget ?? (node.file ? { file: node.file, line: node.line, endLine: node.endLine } : null);

  const openSource = (file: string, line?: number, endLine?: number) => {
    setOpened({ nodeId, file, line, endLine });
    setTab("source");
  };

  return (
    <aside className={styles.inspector} aria-label={`Inspector: ${node.name}`}>
      <header className={styles.header}>
        <div className={styles.headTop}>
          <KindLabel kind={node.kind} />
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => select(null)} aria-label="Close inspector">
            <X size={14} />
          </button>
        </div>
        <h2 className={styles.name}>{node.name}</h2>
        {node.file ? (
          <button type="button" className={styles.location} onClick={() => openSource(node.file!, node.line, node.endLine)} title="Show source">
            {node.file}
            {node.line ? `:${node.line}${node.endLine && node.endLine !== node.line ? `–${node.endLine}` : ""}` : ""}
          </button>
        ) : node.route ? (
          <span className={styles.location}>{node.route}</span>
        ) : null}
        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "overview"} className={styles.tab} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button type="button" role="tab" aria-selected={tab === "source"} className={styles.tab} onClick={() => setTab("source")} disabled={!target}>
            Source
          </button>
        </div>
      </header>

      {tab === "source" && target ? (
        <div className={styles.sourcePane}>
          <SourceView analysisId={analysisId} file={target.file} line={target.line} endLine={target.endLine} symbol={sourceTarget ? undefined : node.name} compact />
        </div>
      ) : (
        <div className={`${styles.body} scroll`}>
          <dl className={styles.stats}>
            <div>
              <dt>Lines of code</dt>
              <dd>{node.loc ?? "—"}</dd>
            </div>
            <div>
              <dt>Depends on</dt>
              <dd>{dependsOn}</dd>
            </div>
            <div>
              <dt>Used by</dt>
              <dd>{usedBy}</dd>
            </div>
          </dl>

          <div className={styles.actions}>
            <Link className="btn btn-sm" href={`/workspace/${analysisId}/flows?start=${encodeURIComponent(nodeId)}`}>
              <Waypoints size={13} /> Trace flow
            </Link>
            <Link className="btn btn-sm" href={`/workspace/${analysisId}/impact?node=${encodeURIComponent(nodeId)}`}>
              <Radar size={13} /> Impact
            </Link>
            {onFocus ? (
              <button type="button" className="btn btn-sm" onClick={() => onFocus(nodeId)}>
                <Crosshair size={13} /> Focus
              </button>
            ) : showMapLink ? (
              <Link className="btn btn-sm" href={`/workspace/${analysisId}/map?node=${encodeURIComponent(nodeId)}`}>
                <Network size={13} /> Show in map
              </Link>
            ) : null}
          </div>

          {node.kindReason || node.renderEnv ? (
            <Section title="Why it is classified this way">
              {node.kindReason ? <p className={styles.note}>{node.kindReason}.</p> : null}
              {node.renderEnv ? <p className={styles.note}>{node.renderEnv.reason}.</p> : null}
              {node.exported ? <p className={styles.note}>Exported as {node.exported === "both" ? "default and named" : node.exported} export.</p> : null}
            </Section>
          ) : null}

          <Relations title="Depends on" edges={outgoing} direction="out" nodes={index.nodes} onSelect={select} onEvidence={openSource} />
          <Relations title="Used by" edges={incoming} direction="in" nodes={index.nodes} onSelect={select} onEvidence={openSource} />

          {node.kind === "event" ? <EventDetails node={node} /> : null}

          {node.props?.length ? (
            <Section title={`Props (${node.props.length})`}>
              <table className={styles.table}>
                <tbody>
                  {node.props.map((p) => (
                    <tr key={p.name}>
                      <td className="mono">
                        {p.name}
                        {p.optional ? <span className="muted">?</span> : null}
                      </td>
                      <td className={styles.typeCell}>{p.type ?? <span className="muted">untyped</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}

          {node.state?.length ? (
            <Section title={`State (${node.state.length})`}>
              <table className={styles.table}>
                <tbody>
                  {node.state.map((s) => (
                    <tr key={s.name}>
                      <td className="mono">{s.name}</td>
                      <td className={styles.typeCell}>
                        {s.hook}
                        {s.initial ? ` = ${s.initial}` : ""}
                        {s.setter ? <span className="muted"> · {s.setter}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}

          {node.hooks?.length ? (
            <Section title="Hooks called">
              <div className={styles.chips}>
                {node.hooks.map((h) => (
                  <span key={h} className={styles.chip}>
                    {h}()
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          {node.events?.length ? (
            <Section title={`Event handlers (${node.events.length})`}>
              <ul className={styles.list}>
                {node.events.map((e) => (
                  <li key={e.id}>
                    <button type="button" className={styles.rowBtn} onClick={() => select(e.id)}>
                      <KindDot kind="event" />
                      <span className="mono">{e.event}</span>
                      <span className={styles.rowMeta}>
                        &lt;{e.element}&gt; {e.label ? `"${e.label}"` : ""}
                      </span>
                      <ChevronRight size={12} className={styles.chev} />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {node.members?.length ? (
            <Section title={`Members (${node.members.length})`}>
              <ul className={styles.list}>
                {node.members.map((m) => (
                  <li key={m.name}>
                    <button type="button" className={styles.rowBtn} onClick={() => node.file && openSource(node.file, m.line, m.endLine)}>
                      <span className="mono">{m.name}()</span>
                      <span className={styles.rowMeta}>
                        {[m.network ? `${m.network} request${m.network > 1 ? "s" : ""}` : "", ...m.db].filter(Boolean).join(", ") || `line ${m.line}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {network.length ? (
            <Section title={`Network calls (${network.length})`}>
              <ul className={styles.list}>
                {network.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={styles.rowBtn} onClick={() => openSource(n.file, n.line)}>
                      <span className={styles.method}>{n.method}</span>
                      <span className="mono">{n.url ?? n.rawUrl}</span>
                      <ConfidenceTag confidence={n.confidence} />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {node.db?.length ? (
            <Section title="Data access">
              <ul className={styles.list}>
                {node.db.map((d, i) => (
                  <li key={i} className={styles.plainRow}>
                    <span className="mono">
                      {d.operation} {d.entity}
                    </span>
                    <span className={styles.rowMeta}>
                      {d.client}, line {d.line}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {node.flags.length ? (
            <Section title="Flags">
              <div className={styles.chips}>
                {node.flags.map((f) => (
                  <span key={f} className={styles.chip}>
                    {f}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className="panel-title">{title}</h3>
      {children}
    </section>
  );
}

function EventDetails({ node }: { node: GraphNode }) {
  return (
    <Section title="Handler">
      <p className={styles.code}>{node.handler}</p>
      {node.viaProps?.length ? (
        <p className={styles.note}>
          Forwarded through props: <span className="mono">{node.viaProps.join("; ")}</span>
        </p>
      ) : null}
      {node.stateUpdates?.length ? (
        <p className={styles.note}>
          Updates state: <span className="mono">{node.stateUpdates.join(", ")}</span>
        </p>
      ) : null}
    </Section>
  );
}

function Relations({
  title,
  edges,
  direction,
  nodes,
  onSelect,
  onEvidence,
}: {
  title: string;
  edges: GraphEdge[];
  direction: "in" | "out";
  nodes: Map<string, GraphNode>;
  onSelect: (id: string) => void;
  onEvidence: (file: string, line?: number) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!edges.length) return null;
  const groups = new Map<EdgeKind, GraphEdge[]>();
  for (const e of edges) {
    if (!groups.has(e.kind)) groups.set(e.kind, []);
    groups.get(e.kind)!.push(e);
  }
  return (
    <Section title={`${title} (${edges.length})`}>
      {[...groups].map(([kind, list]) => (
        <div key={kind} className={styles.relGroup}>
          <p className={styles.relKind}>{direction === "out" ? EDGE_META[kind].label : `${EDGE_META[kind].label} this`}</p>
          <ul className={styles.list}>
            {list.map((e) => {
              const otherId = direction === "out" ? e.target : e.source;
              const other = nodes.get(otherId);
              const member = direction === "out" ? e.label : e.sourceMember;
              return (
                <li key={e.id}>
                  <div className={styles.relRow}>
                    <button type="button" className={styles.rowBtn} onClick={() => onSelect(otherId)} title={other ? `${KIND_META[other.kind].label}: ${other.file ?? other.name}` : otherId}>
                      {other ? <KindDot kind={other.kind} /> : null}
                      <span className={styles.relName}>
                        {other?.name ?? otherId}
                        {member ? <span className="muted">.{member}</span> : null}
                      </span>
                      <ConfidenceTag confidence={e.confidence} />
                    </button>
                    <button type="button" className={styles.evidenceToggle} aria-expanded={open === e.id} aria-label="Show evidence" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <ChevronRight size={12} />
                    </button>
                  </div>
                  {open === e.id ? (
                    <ul className={styles.evidence}>
                      {e.evidence.map((ev, i) => (
                        <li key={i}>
                          <span>{ev.reason}</span>
                          <button type="button" className={styles.evidenceLoc} onClick={() => onEvidence(ev.file, ev.line)}>
                            {ev.file}:{ev.line}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Section>
  );
}
