/**
 * Graph views: which subset of the analysis graph to display or export.
 * Parallel edges between the same pair (e.g. one per service method) are
 * merged into a single visual edge that keeps all underlying evidence.
 */
import type { AnalysisResult, Confidence, EdgeKind, GraphEdge, GraphNode, NodeKind } from "./types.ts";

export const DEFAULT_HIDDEN_KINDS: NodeKind[] = ["event", "external"];

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  confidence: Confidence;
  /** Underlying analysis edges represented by this visual edge. */
  edges: GraphEdge[];
}

export interface GraphView {
  nodes: GraphNode[];
  edges: ViewEdge[];
}

export function mergeEdges(edges: GraphEdge[]): ViewEdge[] {
  const merged = new Map<string, ViewEdge>();
  for (const e of edges) {
    const id = `${e.kind}:${e.source}->${e.target}`;
    const existing = merged.get(id);
    if (existing) {
      existing.edges.push(e);
      if (e.confidence === "detected") existing.confidence = "detected";
    } else {
      merged.set(id, { id, source: e.source, target: e.target, kind: e.kind, confidence: e.confidence, edges: [e] });
    }
  }
  return [...merged.values()];
}

export function architectureView(result: Pick<AnalysisResult, "nodes" | "edges">, hiddenKinds: Iterable<NodeKind> = DEFAULT_HIDDEN_KINDS, include?: Set<string>): GraphView {
  const hidden = new Set(hiddenKinds);
  const nodes = result.nodes.filter((n) => (include ? include.has(n.id) : !hidden.has(n.kind)));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = mergeEdges(result.edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
  return { nodes, edges };
}

/** Node ids within `depth` hops of `center`, in either direction. */
export function neighborhood(result: Pick<AnalysisResult, "edges">, center: string, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of result.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  const seen = new Set([center]);
  let frontier = [center];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return seen;
}
