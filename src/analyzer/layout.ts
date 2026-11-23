/**
 * Layered graph layout (Sugiyama-style, via dagre).
 *
 * Architecture graphs are mostly directed and acyclic (pages render
 * components, components use hooks, hooks call services, services request
 * endpoints), so a layered left-to-right layout keeps flow direction readable
 * and avoids the overlap of force-directed layouts. Shared by the browser map
 * and the server-side SVG exporter.
 */
import { Graph, layout } from "@dagrejs/dagre";

export interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
  /** Optional group (compound parent). */
  group?: string;
}

export interface LayoutInputEdge {
  id: string;
  source: string;
  target: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOutput {
  nodes: Map<string, Box>;
  groups: Map<string, Box>;
  edges: Map<string, { x: number; y: number }[]>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  direction?: "LR" | "TB";
  nodeSep?: number;
  rankSep?: number;
  groups?: { id: string; label: string }[];
}

export function layoutGraph(nodes: LayoutInputNode[], edges: LayoutInputEdge[], options: LayoutOptions = {}): LayoutOutput {
  const compound = !!options.groups?.length;
  const g = new Graph({ multigraph: true, compound });
  g.setGraph({
    rankdir: options.direction ?? "LR",
    nodesep: options.nodeSep ?? 18,
    ranksep: options.rankSep ?? 72,
    edgesep: 10,
    marginx: 24,
    marginy: 24,
    ranker: "network-simplex",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const group of options.groups ?? []) g.setNode(group.id, { label: group.label, paddingTop: 28, paddingLeft: 12, paddingRight: 12, paddingBottom: 12 });
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
    if (compound && n.group) g.setParent(n.id, n.group);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    g.setEdge(e.source, e.target, { weight: 1, minlen: 1 }, e.id);
  }

  layout(g);

  const out: LayoutOutput = { nodes: new Map(), groups: new Map(), edges: new Map(), width: 0, height: 0 };
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!p) continue;
    out.nodes.set(n.id, { x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height });
  }
  for (const group of options.groups ?? []) {
    const p = g.node(group.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (p && p.width) out.groups.set(group.id, { x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height });
  }
  for (const e of g.edges()) {
    const data = g.edge(e) as { points?: { x: number; y: number }[] } | undefined;
    if (e.name && data?.points) out.edges.set(e.name, data.points);
  }
  const graph = g.graph() as { width?: number; height?: number };
  out.width = graph.width ?? 0;
  out.height = graph.height ?? 0;
  return out;
}
