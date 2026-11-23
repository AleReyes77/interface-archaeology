"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import type { NetworkCall } from "@/analyzer/types";
import { useAnalysis } from "@/lib/store";
import { plural } from "@/lib/format";
import { ConfidenceTag, KindDot } from "@/components/KindBadge";
import { SourceView } from "@/components/source/SourceView";
import { EmptyState } from "@/components/EmptyState";
import styles from "@/components/page.module.css";

/** Groups `/api/documents/:param/comments` under its first two path segments. */
function resourceOf(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!;
  const segs = path.split("/").filter(Boolean);
  return segs.length ? `/${segs.slice(0, Math.min(2, segs.length)).join("/")}` : url;
}

export default function ApiExplorerPage({ searchParams }: { searchParams: Promise<{ endpoint?: string }> }) {
  const { endpoint: initial } = use(searchParams);
  const { result, index, analysisId } = useAnalysis();
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("all");
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [call, setCall] = useState<NetworkCall | null>(null);

  const endpoints = useMemo(() => result.nodes.filter((n) => n.kind === "endpoint"), [result]);
  const handlers = useMemo(() => result.nodes.filter((n) => n.kind === "route-handler"), [result]);
  const dynamicCalls = useMemo(() => result.network.filter((n) => !n.endpointId), [result]);
  const methods = useMemo(() => [...new Set(endpoints.map((e) => e.method ?? "GET"))].sort(), [endpoints]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, typeof endpoints>();
    for (const e of endpoints) {
      if (method !== "all" && e.method !== method) continue;
      if (q && !e.name.toLowerCase().includes(q)) continue;
      const key = resourceOf(e.route ?? e.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [endpoints, query, method]);

  const calledHandlers = new Set(result.edges.filter((e) => e.kind === "handled-by").map((e) => e.target));
  const uncalled = handlers.filter((h) => !calledHandlers.has(h.id));
  const endpoint = selected ? index.nodes.get(selected) : undefined;
  const calls = endpoint ? result.network.filter((n) => n.endpointId === endpoint.id) : [];
  const handledBy = endpoint ? (index.out.get(endpoint.id) ?? []).filter((e) => e.kind === "handled-by") : [];
  const activeCall = call && calls.includes(call) ? call : (calls[0] ?? null);

  return (
    <div className={styles.split}>
      <aside className={styles.listPane} aria-label="Endpoints">
        <div className={styles.listHead}>
          <input className="input" placeholder="Filter endpoints" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter endpoints" />
          <div className={styles.listRow}>
            <select className={styles.select} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="HTTP method">
              <option value="all">All methods</option>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className={styles.sectionNote}>{plural(result.network.length, "request")} in code</span>
          </div>
        </div>
        <div className={styles.listBody}>
          {endpoints.length === 0 && dynamicCalls.length === 0 ? <EmptyState title="No API calls detected.">No network calls were detected in the analyzed files. Supported patterns: fetch(), axios and axios instances.</EmptyState> : null}
          {groups.map(([resource, list]) => (
            <div key={resource}>
              <p className={styles.groupHeading}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{resource}</span>
                <span>{list.length}</span>
              </p>
              {list.map((e) => {
                const handled = (index.out.get(e.id) ?? []).some((x) => x.kind === "handled-by");
                return (
                  <button key={e.id} type="button" className={styles.item} aria-current={e.id === selected} onClick={() => setSelected(e.id)}>
                    <span className={styles.method} data-method={e.method}>
                      {e.method}
                    </span>
                    <span className={styles.itemName}>{e.route}</span>
                    <span className={styles.itemMeta}>{handled ? "handled" : e.flags.includes("external-url") ? "external" : "no handler"}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {dynamicCalls.length ? (
            <div>
              <p className={styles.groupHeading}>
                <span>Dynamic URLs</span>
                <span>{dynamicCalls.length}</span>
              </p>
              {dynamicCalls.map((n) => (
                <button key={n.id} type="button" className={styles.item} aria-current={selected === n.id} onClick={() => setSelected(n.id)}>
                  <span className={styles.method}>{n.method}</span>
                  <span className={styles.itemName}>{n.rawUrl}</span>
                </button>
              ))}
            </div>
          ) : null}
          {uncalled.length ? (
            <div>
              <p className={styles.groupHeading}>
                <span>Route handlers with no detected caller</span>
                <span>{uncalled.length}</span>
              </p>
              {uncalled.map((h) => (
                <Link key={h.id} className={styles.item} href={`/workspace/${analysisId}/map?node=${encodeURIComponent(h.id)}`}>
                  <KindDot kind="route-handler" />
                  <span className={styles.itemName}>{h.name}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </aside>

      <div className={styles.detailPane}>
        {endpoint ? (
          <>
            <div className={styles.scrollPage} style={{ flex: "0 1 auto", maxHeight: "58%" }}>
              <div className={styles.content}>
                <header className={styles.pageHead}>
                  <div>
                    <h1 className={styles.pageTitle} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)", letterSpacing: 0 }}>
                      <span className={styles.method} data-method={endpoint.method} style={{ fontSize: "inherit", minWidth: 0, marginRight: 10 }}>
                        {endpoint.method}
                      </span>
                      {endpoint.route}
                    </h1>
                    <p className={styles.pageLede}>
                      Requested from {plural(calls.length, "place")} in the code.{" "}
                      {handledBy.length
                        ? `Served by ${handledBy.map((h) => index.nodes.get(h.target)?.name).join(", ")}, matched by URL pattern.`
                        : endpoint.flags.includes("external-url")
                          ? "The URL points outside the project or depends on configuration."
                          : "No route handler in this project matches this URL."}
                    </p>
                  </div>
                </header>
                {handledBy.length ? (
                  <section className={styles.section}>
                    <div className={styles.sectionHead}>
                      <h2 className={styles.sectionTitle}>Handled by</h2>
                    </div>
                    {handledBy.map((h) => (
                      <Link key={h.id} className={styles.item} style={{ paddingLeft: 0 }} href={`/workspace/${analysisId}/map?node=${encodeURIComponent(h.target)}`}>
                        <KindDot kind="route-handler" />
                        <span className={styles.itemName}>{index.nodes.get(h.target)?.name}</span>
                        <span className={styles.sectionNote}>{h.evidence[0]?.reason}</span>
                        <ConfidenceTag confidence={h.confidence} />
                      </Link>
                    ))}
                  </section>
                ) : null}
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Calls</h2>
                  </div>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Caller</th>
                        <th>Client</th>
                        <th>Request body</th>
                        <th>Response handling</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((c) => (
                        <tr key={c.id} data-clickable aria-selected={activeCall?.id === c.id} onClick={() => setCall(c)}>
                          <td>
                            <span className="mono" style={{ fontSize: "var(--text-xs)" }}>
                              {index.nodes.get(c.callerId)?.name}
                              {c.callerMember ? `.${c.callerMember}` : ""}
                            </span>
                            <span className={styles.itemSub}>
                              {c.file}:{c.line}
                            </span>
                          </td>
                          <td className={styles.mono}>{c.client}</td>
                          <td className={styles.mono}>{c.requestBody ?? <span className="muted">none</span>}</td>
                          <td style={{ fontSize: "var(--text-xs)", color: "var(--ink-2)" }}>{c.responseHandling.join(", ") || <span className="muted">not detected in the calling function</span>}</td>
                          <td>
                            <ConfidenceTag confidence={c.confidence} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            </div>
            {activeCall ? (
              <div style={{ flex: 1, minHeight: 0, borderTop: "1px solid var(--line)" }}>
                <SourceView key={activeCall.id} analysisId={analysisId} file={activeCall.file} line={activeCall.line} />
              </div>
            ) : null}
          </>
        ) : selected && result.network.find((n) => n.id === selected) ? (
          (() => {
            const n = result.network.find((x) => x.id === selected)!;
            return (
              <>
                <div className={styles.content}>
                  <h1 className={styles.pageTitle} style={{ fontSize: "var(--text-xl)" }}>
                    Request with a dynamic URL
                  </h1>
                  <p className={styles.pageLede}>
                    {index.nodes.get(n.callerId)?.name} calls <span className="mono">{n.client}</span> with <span className="mono">{n.rawUrl}</span>. The target is computed at runtime, so it cannot be matched to an endpoint statically.
                  </p>
                </div>
                <div style={{ flex: 1, minHeight: 0, borderTop: "1px solid var(--line)" }}>
                  <SourceView analysisId={analysisId} file={n.file} line={n.line} />
                </div>
              </>
            );
          })()
        ) : (
          <EmptyState title={endpoints.length ? "Select an endpoint." : "No network calls were detected in the analyzed files."}>
            {endpoints.length ? "Each endpoint shows who calls it, which route handler serves it, and the code of each call." : "Interface Archaeology recognises fetch(), axios and axios instances created with axios.create()."}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
