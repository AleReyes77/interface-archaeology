"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { traceFlow } from "@/analyzer/queries/flows";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { plural } from "@/lib/format";
import { flowLevels, Strata } from "@/components/flows/Strata";
import { Inspector } from "@/components/inspector/Inspector";
import { ConfidenceTag, KindDot } from "@/components/KindBadge";
import { EmptyState } from "@/components/EmptyState";
import styles from "@/components/page.module.css";

export default function FlowsPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = use(searchParams);
  const router = useRouter();
  const { result, index, analysisId } = useAnalysis();
  const selectedId = useWorkspace((s) => s.selectedId);
  const select = useWorkspace((s) => s.select);
  const [query, setQuery] = useState("");
  const [onlyBackend, setOnlyBackend] = useState(false);

  // Every UI event is an entry point; trace them all once (cheap: bounded depth, small fan-out).
  const entries = useMemo(() => {
    return result.nodes
      .filter((n) => n.kind === "event")
      .map((n) => {
        const owner = (index.in.get(n.id) ?? []).find((e) => e.kind === "handles")?.source;
        const flow = traceFlow(result, n.id, index)!;
        return { node: n, owner: owner ? index.nodes.get(owner) : undefined, flow, backend: flow.reaches.endpoints.length + flow.reaches.handlers.length + flow.reaches.entities.length > 0 };
      });
  }, [result, index]);

  const activeId = start && index.nodes.has(start) ? start : (entries.find((e) => e.backend)?.node.id ?? entries[0]?.node.id ?? null);
  const flow = useMemo(() => (activeId ? traceFlow(result, activeId, index) : null), [result, index, activeId]);
  const activeNode = activeId ? index.nodes.get(activeId) : undefined;
  const activeOwner = activeId ? index.nodes.get((index.in.get(activeId) ?? []).find((e) => e.kind === "handles")?.source ?? "") : undefined;

  const q = query.trim().toLowerCase();
  const filtered = entries.filter((e) => (!onlyBackend || e.backend) && (!q || e.node.name.toLowerCase().includes(q) || e.owner?.name.toLowerCase().includes(q)));
  const byOwner = new Map<string, typeof filtered>();
  for (const e of filtered) {
    const key = e.owner?.name ?? "Unknown";
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(e);
  }

  const open = (id: string) => {
    select(null);
    router.replace(`/workspace/${analysisId}/flows?start=${encodeURIComponent(id)}`);
  };

  return (
    <div className={styles.split}>
      <aside className={styles.listPane} aria-label="Entry points">
        <div className={styles.listHead}>
          <input className="input" placeholder="Filter interactions" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter interactions" />
          <label className={styles.listRow} style={{ fontSize: "var(--text-xs)", color: "var(--ink-2)" }}>
            <input type="checkbox" checked={onlyBackend} onChange={(e) => setOnlyBackend(e.target.checked)} /> Only interactions that reach the backend
          </label>
        </div>
        <div className={styles.listBody}>
          {entries.length === 0 ? <EmptyState title="No UI event handlers were detected.">Data flows start from event handlers such as onClick or onSubmit in JSX.</EmptyState> : null}
          {[...byOwner].map(([owner, list]) => (
            <div key={owner}>
              <p className={styles.groupHeading}>
                <span>{owner}</span>
                <span>{list.length}</span>
              </p>
              {list.map((e) => (
                <button key={e.node.id} type="button" className={styles.item} aria-current={e.node.id === activeId} onClick={() => open(e.node.id)}>
                  <KindDot kind="event" />
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>{e.node.name}</span>
                  </span>
                  <span className={styles.itemMeta}>{e.backend ? `${e.flow.steps} steps` : e.node.stateUpdates?.length ? "state only" : `${e.flow.steps} step${e.flow.steps === 1 ? "" : "s"}`}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div className={styles.scrollPage}>
        <div className={styles.content}>
          {flow && activeNode ? (
            <>
              <header className={styles.pageHead}>
                <div>
                  <h1 className={styles.pageTitle} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)", letterSpacing: 0 }}>
                    {activeNode.name}
                    {activeOwner ? <span className="muted"> in {activeOwner.name}</span> : null}
                  </h1>
                  <p className={styles.pageLede}>
                    {plural(flow.steps, "step")} across {plural(flowLevels(flow).length, "layer")}.{" "}
                    {flow.reaches.entities.length ? `Reaches ${flow.reaches.entities.map((id) => index.nodes.get(id)?.name).join(", ")} in the data layer. ` : ""}
                    {flow.confidence === "inferred" ? "Some steps are inferred (dashed marker); open them to see the evidence." : "Every step was read directly from the source."}
                  </p>
                </div>
                <ConfidenceTag confidence={flow.confidence} />
              </header>
              <Strata flow={flow} index={index} selectedId={selectedId} onSelect={select} />
              {flow.gaps.length ? (
                <p className={styles.sectionNote} style={{ marginTop: 12 }}>
                  {plural(new Set(flow.gaps).size, "gap")} in this trace. Gaps mark where static analysis cannot follow the code; they are shown instead of guessed.
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState title="Choose an interaction to trace.">Select an event on the left, or use Trace flow from any element in the inspector.</EmptyState>
          )}
        </div>
      </div>
      {selectedId && index.nodes.has(selectedId) ? <Inspector nodeId={selectedId} /> : null}
    </div>
  );
}
