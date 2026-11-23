"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type NodeMouseHandler, type EdgeMouseHandler } from "@xyflow/react";
import { ArrowDownUp, ArrowLeftRight, Crosshair, FolderTree, Maximize, Minus, Plus, RotateCcw, X } from "lucide-react";
import { layoutGraph } from "@/analyzer/layout";
import { EDGE_META, KIND_META, nodeSize } from "@/analyzer/presentation";
import { NODE_KINDS, type NodeKind } from "@/analyzer/types";
import { architectureView, neighborhood, type ViewEdge } from "@/analyzer/views";
import { describeEdge } from "@/analyzer/queries/graph-index";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { ConfidenceTag, kindStyle } from "../KindBadge";
import { Inspector } from "../inspector/Inspector";
import { EmptyState } from "../EmptyState";
import { ArchNode, FolderNode, type ArchFlowNode, type FolderFlowNode } from "./ArchNode";
import { RoutedEdge, type RoutedFlowEdge } from "./RoutedEdge";
import styles from "./map.module.css";

const nodeTypes = { arch: ArchNode, folder: FolderNode };
const edgeTypes = { routed: RoutedEdge };
const LARGE_GRAPH = 250;

function folderOf(file: string | undefined): string | null {
  if (!file) return null;
  const i = file.lastIndexOf("/");
  return i === -1 ? "." : file.slice(0, i);
}

export function ArchitectureMap({ initialNode }: { initialNode?: string | null }) {
  return (
    <ReactFlowProvider>
      <MapCanvas initialNode={initialNode} />
    </ReactFlowProvider>
  );
}

function MapCanvas({ initialNode }: { initialNode?: string | null }) {
  const { result, index } = useAnalysis();
  const selectedId = useWorkspace((s) => s.selectedId);
  const select = useWorkspace((s) => s.select);
  const hiddenKinds = useWorkspace((s) => s.hiddenKinds);
  const toggleKind = useWorkspace((s) => s.toggleKind);
  const setHiddenKinds = useWorkspace((s) => s.setHiddenKinds);
  const flow = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [grouped, setGrouped] = useState(false);
  const [focus, setFocus] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<ViewEdge | null>(null);

  const counts = useMemo(() => {
    const c: Partial<Record<NodeKind, number>> = {};
    for (const n of result.nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [result]);

  const view = useMemo(() => architectureView(result, focus ? [] : hiddenKinds, focus ?? undefined), [result, hiddenKinds, focus]);

  const layout = useMemo(() => {
    const groups = grouped
      ? [...new Set(view.nodes.map((n) => folderOf(n.file)).filter((f): f is string => !!f))].map((f) => ({ id: `folder:${f}`, label: f === "." ? "(project root)" : f }))
      : [];
    return layoutGraph(
      view.nodes.map((n) => ({ id: n.id, ...nodeSize(n.name), group: grouped && folderOf(n.file) ? `folder:${folderOf(n.file)}` : undefined })),
      view.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      { direction, groups },
    );
  }, [view, grouped, direction]);

  // Selection highlighting: the selected node, its direct neighbours, and the edges between them.
  const neighbors = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const e of view.edges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [selectedId, view]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    return new Set(view.nodes.filter((n) => n.name.toLowerCase().includes(q) || n.file?.toLowerCase().includes(q)).map((n) => n.id));
  }, [filter, view]);

  const nodes = useMemo(() => {
    const out: (ArchFlowNode | FolderFlowNode)[] = [];
    for (const [id, box] of layout.groups) {
      out.push({ id, type: "folder", position: { x: box.x, y: box.y }, data: { label: id.slice("folder:".length) }, style: { width: box.width, height: box.height }, selectable: false, draggable: false, zIndex: -1 });
    }
    for (const n of view.nodes) {
      const box = layout.nodes.get(n.id);
      if (!box) continue;
      const state = n.id === selectedId ? "selected" : neighbors ? (neighbors.has(n.id) ? "neighbor" : "dimmed") : matches ? (matches.has(n.id) ? "match" : "dimmed") : "default";
      out.push({ id: n.id, type: "arch", position: { x: box.x, y: box.y }, data: { node: n, state, direction }, width: box.width, height: box.height, draggable: false, selected: n.id === selectedId });
    }
    return out;
  }, [layout, view, selectedId, neighbors, matches, direction]);

  const edges = useMemo<RoutedFlowEdge[]>(
    () =>
      view.edges.map((e) => {
        const active = selectedId !== null && (e.source === selectedId || e.target === selectedId);
        const dimmed = (neighbors && !active) || (matches && !(matches.has(e.source) && matches.has(e.target)));
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "routed",
          selected: selectedEdge?.id === e.id,
          data: { points: layout.edges.get(e.id) ?? [], kind: e.kind, confidence: e.confidence, state: active ? "active" : dimmed ? "dimmed" : "default", count: e.edges.length },
        };
      }),
    [view, layout, selectedId, neighbors, matches, selectedEdge],
  );

  const centerOn = useCallback(
    (id: string) => {
      const box = layout.nodes.get(id);
      if (box) void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 300 });
    },
    [layout, flow],
  );

  // Deep link (?node=) and selections made elsewhere (command palette, inspector).
  useEffect(() => {
    if (initialNode && index.nodes.has(initialNode)) {
      select(initialNode);
      const kind = index.nodes.get(initialNode)!.kind;
      if (useWorkspace.getState().hiddenKinds.includes(kind)) toggleKind(kind);
    }
  }, [initialNode, index, select, toggleKind]);

  const lastCentered = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== lastCentered.current && layout.nodes.has(selectedId)) {
      lastCentered.current = selectedId;
      const box = layout.nodes.get(selectedId)!;
      const vp = flow.getViewport();
      const el = containerRef.current;
      const cx = (box.x + box.width / 2) * vp.zoom + vp.x;
      const cy = (box.y + box.height / 2) * vp.zoom + vp.y;
      const visible = el && cx > 40 && cy > 40 && cx < el.clientWidth - 40 && cy < el.clientHeight - 40;
      if (!visible) centerOn(selectedId);
    }
  }, [selectedId, layout, flow, centerOn]);

  // On a new layout: fit everything, or, when something is selected (deep link, palette), frame it.
  useEffect(() => {
    const t = setTimeout(() => {
      const selected = useWorkspace.getState().selectedId;
      const box = selected ? layout.nodes.get(selected) : undefined;
      if (box) void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: 0.95, duration: 250 });
      else void flow.fitView({ padding: 0.12, duration: 250, maxZoom: 1.1 });
    }, 30);
    return () => clearTimeout(t);
  }, [layout, flow]);

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    if (node.type !== "arch") return;
    setSelectedEdge(null);
    select(node.id === selectedId ? null : node.id);
  };
  const onNodeDoubleClick: NodeMouseHandler = (_e, node) => {
    if (node.type !== "arch") return;
    // Expand: add this node's neighbours to the focused subgraph.
    setFocus((f) => new Set([...(f ?? neighborhood(result, node.id, 1)), ...neighborhood(result, node.id, 1)]));
    select(node.id);
  };
  const onEdgeClick: EdgeMouseHandler = (_e, edge) => {
    setSelectedEdge(view.edges.find((v) => v.id === edge.id) ?? null);
  };

  const focusOn = useCallback(
    (id: string) => {
      setFocus(neighborhood(result, id, 2));
      select(id);
    },
    [result, select],
  );

  // Keyboard navigation across the graph.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    if (e.key === "Escape") {
      if (selectedEdge) setSelectedEdge(null);
      else select(null);
      return;
    }
    if (e.key === "f" && !e.ctrlKey && !e.metaKey) {
      void flow.fitView({ padding: 0.12, duration: 250 });
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const current = selectedId && layout.nodes.get(selectedId);
    if (!current) {
      const first = view.nodes[0];
      if (first) select(first.id);
      return;
    }
    const cx = current.x + current.width / 2;
    const cy = current.y + current.height / 2;
    const forward = direction === "LR" ? "ArrowRight" : "ArrowDown";
    const backward = direction === "LR" ? "ArrowLeft" : "ArrowUp";
    let candidate: string | undefined;
    if (e.key === forward) candidate = view.edges.find((v) => v.source === selectedId)?.target;
    else if (e.key === backward) candidate = view.edges.find((v) => v.target === selectedId)?.source;
    else {
      // Move to the nearest node across the other axis.
      const sign = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      let best = Infinity;
      for (const [id, b] of layout.nodes) {
        if (id === selectedId) continue;
        const dx = b.x + b.width / 2 - cx;
        const dy = b.y + b.height / 2 - cy;
        const along = direction === "LR" ? dy : dx;
        const across = direction === "LR" ? dx : dy;
        if (along * sign <= 0) continue;
        const score = Math.abs(along) + Math.abs(across) * 3;
        if (score < best) {
          best = score;
          candidate = id;
        }
      }
    }
    if (candidate) select(candidate);
  };

  const reset = () => {
    setFocus(null);
    setFilter("");
    setSelectedEdge(null);
    setGrouped(false);
    setDirection("LR");
    setHiddenKinds(["event", "external"]);
    select(null);
  };

  const visibleKinds = NODE_KINDS.filter((k) => counts[k]);
  const large = view.nodes.length > LARGE_GRAPH;

  return (
    <div className={styles.workspace}>
      <div className={styles.canvasColumn}>
        <div className={styles.toolbar} role="toolbar" aria-label="Map controls">
          <div className={styles.kindFilters} role="group" aria-label="Node kinds">
            {visibleKinds.map((k) => {
              const on = focus ? true : !hiddenKinds.includes(k);
              return (
                <button key={k} type="button" className={styles.kindChip} aria-pressed={on} disabled={!!focus} onClick={() => toggleKind(k)} style={kindStyle(k)} title={`${on ? "Hide" : "Show"} ${KIND_META[k].plural.toLowerCase()}`}>
                  <span className="kind-dot" aria-hidden="true" />
                  {KIND_META[k].plural}
                  <span className={styles.chipCount}>{counts[k]}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.toolbarRight}>
            <input className={`input ${styles.filterInput}`} placeholder="Highlight by name or path" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Highlight nodes by name or path" />
            <button type="button" className="btn btn-sm" aria-pressed={grouped} onClick={() => setGrouped((g) => !g)} title="Group nodes by folder">
              <FolderTree size={13} /> Folders
            </button>
            <button type="button" className="btn btn-sm btn-icon" onClick={() => setDirection((d) => (d === "LR" ? "TB" : "LR"))} aria-label={`Switch to ${direction === "LR" ? "top-to-bottom" : "left-to-right"} layout`} title="Toggle layout direction">
              {direction === "LR" ? <ArrowDownUp size={13} /> : <ArrowLeftRight size={13} />}
            </button>
            <button type="button" className="btn btn-sm btn-icon" onClick={reset} aria-label="Reset the map" title="Reset filters, focus and selection">
              <RotateCcw size={13} />
            </button>
          </div>
        </div>

        {focus ? (
          <div className={styles.focusBar}>
            <Crosshair size={13} aria-hidden="true" />
            Focus mode: {view.nodes.length} nodes around {selectedId ? index.nodes.get(selectedId)?.name : "the selection"}. Double-click a node to expand its neighbours.
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFocus(null)}>
              <X size={12} /> Exit focus
            </button>
          </div>
        ) : large ? (
          <div className={styles.focusBar} data-tone="warn">
            {view.nodes.length} nodes are visible. Hide node kinds or select a node and use Focus to keep the map readable.
          </div>
        ) : null}

        <div className={styles.canvas} ref={containerRef} onKeyDown={onKeyDown} tabIndex={0} aria-label="Architecture graph. Use arrow keys to move between connected nodes, Escape to clear the selection, F to fit.">
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
            <defs>
              <marker id="ia-arrow" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0.5 L8,4 L0,7.5 z" fill="#4a4f58" />
              </marker>
              <marker id="ia-arrow-active" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0.5 L8,4 L0,7.5 z" fill="#63c5b0" />
              </marker>
            </defs>
          </svg>
          {view.nodes.length === 0 ? (
            <EmptyState title="Nothing to show with the current filters." action={<button type="button" className="btn btn-sm" onClick={reset}>Reset the map</button>}>
              All node kinds are hidden. Turn some back on in the toolbar.
            </EmptyState>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => {
                select(null);
                setSelectedEdge(null);
              }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              zoomOnDoubleClick={false}
              minZoom={0.08}
              maxZoom={2.5}
              onlyRenderVisibleElements={large}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--canvas-dot)" />
              <MiniMap pannable zoomable className={styles.minimap} style={{ width: 168, height: 108 }} nodeColor={(n) => (n.type === "folder" ? "transparent" : `var(--k-${(n.data as { node: { kind: string } }).node.kind})`)} nodeStrokeWidth={0} maskColor="rgb(20 21 24 / 0.7)" />
            </ReactFlow>
          )}
          <div className={styles.zoomControls}>
            <button type="button" className="btn btn-icon btn-sm" onClick={() => void flow.zoomIn({ duration: 150 })} aria-label="Zoom in">
              <Plus size={13} />
            </button>
            <button type="button" className="btn btn-icon btn-sm" onClick={() => void flow.zoomOut({ duration: 150 })} aria-label="Zoom out">
              <Minus size={13} />
            </button>
            <button type="button" className="btn btn-icon btn-sm" onClick={() => void flow.fitView({ padding: 0.12, duration: 250 })} aria-label="Fit graph to screen" title="Fit to screen (F)">
              <Maximize size={13} />
            </button>
          </div>
          {selectedEdge ? (
            <div className={styles.edgePanel} role="dialog" aria-label="Relationship evidence">
              <div className={styles.edgeHead}>
                <span className="panel-title">{EDGE_META[selectedEdge.kind].label}</span>
                <ConfidenceTag confidence={selectedEdge.confidence} />
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSelectedEdge(null)} aria-label="Close">
                  <X size={13} />
                </button>
              </div>
              <ul className={styles.edgeList}>
                {selectedEdge.edges.map((e) => (
                  <li key={e.id}>
                    <p>{describeEdge(e, index)}</p>
                    {e.evidence.map((ev, i) => (
                      <p key={i} className={styles.edgeEvidence}>
                        {ev.reason} <span className="path">{ev.file}:{ev.line}</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Legend />
        </div>
      </div>
      {selectedId && index.nodes.has(selectedId) ? <Inspector nodeId={selectedId} onFocus={focusOn} /> : null}
    </div>
  );
}

function Legend() {
  return (
    <div className={styles.legend} aria-label="Legend">
      <span>
        <svg width="22" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="22" y2="3" stroke="#6f7580" strokeWidth="1.5" />
        </svg>
        detected
      </span>
      <span>
        <svg width="22" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="22" y2="3" stroke="#6f7580" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
        inferred
      </span>
      <span>
        <svg width="22" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="22" y2="3" stroke="rgb(236 199 119 / 0.7)" strokeWidth="1.5" />
        </svg>
        network &amp; data
      </span>
    </div>
  );
}
