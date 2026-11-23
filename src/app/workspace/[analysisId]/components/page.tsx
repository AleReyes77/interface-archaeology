"use client";

import { use, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { KIND_META } from "@/analyzer/presentation";
import type { GraphNode, NodeKind } from "@/analyzer/types";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { KindDot } from "@/components/KindBadge";
import { Inspector } from "@/components/inspector/Inspector";
import { SourceView } from "@/components/source/SourceView";
import { EmptyState } from "@/components/EmptyState";
import styles from "@/components/page.module.css";

const EXPLORER_KINDS: NodeKind[] = ["page", "layout", "route-segment", "component", "provider", "context", "hook", "service", "server-action", "route-handler", "middleware", "utility"];
type GroupBy = "kind" | "folder";
type SortBy = "name" | "loc" | "dependents";

export default function ComponentsPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const { node: initial } = use(searchParams);
  const { result, index, analysisId } = useAnalysis();
  const selectedId = useWorkspace((s) => s.selectedId);
  const select = useWorkspace((s) => s.select);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("kind");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initial && index.nodes.has(initial)) select(initial);
  }, [initial, index, select]);

  const dependents = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of result.nodes) m.set(n.id, new Set((index.in.get(n.id) ?? []).map((e) => e.source)).size);
    return m;
  }, [result, index]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = result.nodes.filter((n) => EXPLORER_KINDS.includes(n.kind) && (!q || n.name.toLowerCase().includes(q) || n.file?.toLowerCase().includes(q)));
    const sorter = (a: GraphNode, b: GraphNode) =>
      sortBy === "loc" ? (b.loc ?? 0) - (a.loc ?? 0) : sortBy === "dependents" ? (dependents.get(b.id) ?? 0) - (dependents.get(a.id) ?? 0) : a.name.localeCompare(b.name);
    const map = new Map<string, GraphNode[]>();
    for (const n of items) {
      const key = groupBy === "kind" ? n.kind : (n.file?.split("/").slice(0, -1).join("/") || ".");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    const keys = [...map.keys()].sort((a, b) => (groupBy === "kind" ? EXPLORER_KINDS.indexOf(a as NodeKind) - EXPLORER_KINDS.indexOf(b as NodeKind) : a.localeCompare(b)));
    return keys.map((k) => ({ key: k, label: groupBy === "kind" ? KIND_META[k as NodeKind].plural : k, items: map.get(k)!.sort(sorter) }));
  }, [result, query, groupBy, sortBy, dependents]);

  const selected = selectedId ? index.nodes.get(selectedId) : undefined;
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.split}>
      <aside className={styles.listPane} aria-label="Code elements">
        <div className={styles.listHead}>
          <input className="input" placeholder="Filter by name or path" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter elements" />
          <div className={styles.listRow}>
            <select className={styles.select} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Group by">
              <option value="kind">Group by kind</option>
              <option value="folder">Group by folder</option>
            </select>
            <select className={styles.select} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} aria-label="Sort by">
              <option value="name">Sort by name</option>
              <option value="loc">Sort by size</option>
              <option value="dependents">Sort by dependents</option>
            </select>
          </div>
        </div>
        <div className={styles.listBody} role="tree" aria-label="Elements">
          {groups.length === 0 ? <EmptyState title="No elements match this filter." /> : null}
          {groups.map((g) => (
            <div key={g.key} role="group">
              <button type="button" className={styles.groupHeading} style={{ width: "100%" }} onClick={() => toggle(g.key)} aria-expanded={!collapsed.has(g.key)}>
                {collapsed.has(g.key) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                <span style={{ fontFamily: groupBy === "folder" ? "var(--font-mono)" : undefined }}>{g.label}</span>
                <span>{g.items.length}</span>
              </button>
              {!collapsed.has(g.key)
                ? g.items.map((n) => (
                    <button key={n.id} type="button" role="treeitem" aria-selected={n.id === selectedId} className={styles.item} onClick={() => select(n.id)}>
                      <KindDot kind={n.kind} />
                      <span className={styles.itemText}>
                        <span className={styles.itemName}>{n.name}</span>
                        {groupBy === "kind" ? <span className={styles.itemSub}>{n.file}</span> : null}
                      </span>
                      <span className={styles.itemMeta}>{sortBy === "dependents" ? `${dependents.get(n.id)} in` : `${n.loc ?? ""}`}</span>
                    </button>
                  ))
                : null}
            </div>
          ))}
        </div>
      </aside>
      <div className={styles.detailPane}>
        {selected?.file ? (
          <SourceView key={selected.id} analysisId={analysisId} file={selected.file} line={selected.line} endLine={selected.endLine} symbol={selected.name} />
        ) : selected ? (
          <EmptyState title={`${selected.name} has no source file.`}>{KIND_META[selected.kind].label} nodes are derived from code that references them; open one of its relationships to see that code.</EmptyState>
        ) : (
          <EmptyState title="Select an element to read its source.">Pick a component, hook, service or route on the left. Its code opens here with the definition highlighted, and its relationships open on the right.</EmptyState>
        )}
      </div>
      {selected ? <Inspector nodeId={selected.id} /> : null}
    </div>
  );
}
