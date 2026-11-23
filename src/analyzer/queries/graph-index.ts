/**
 * Adjacency indexes over an analysis result. Pure and isomorphic: used by the
 * server (exports) and by the browser (explorers).
 */
import type { AnalysisResult, GraphEdge, GraphNode } from "../types.ts";

export interface GraphIndex {
  nodes: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
}

export function indexGraph(result: Pick<AnalysisResult, "nodes" | "edges">): GraphIndex {
  const nodes = new Map(result.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const e of result.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!inc.has(e.target)) inc.set(e.target, []);
    out.get(e.source)!.push(e);
    inc.get(e.target)!.push(e);
  }
  return { nodes, out, in: inc };
}

const VERBS: Record<GraphEdge["kind"], string> = {
  renders: "renders",
  "uses-hook": "uses hook",
  "consumes-context": "reads context",
  "provides-context": "provides context",
  calls: "calls",
  handles: "handles event",
  triggers: "triggers",
  requests: "requests",
  "handled-by": "is handled by",
  queries: "queries",
  "lazy-loads": "lazy-loads",
  "uses-package": "uses package",
};

export function edgeVerb(kind: GraphEdge["kind"]): string {
  return VERBS[kind];
}

export function describeEdge(edge: GraphEdge, index: GraphIndex): string {
  const s = index.nodes.get(edge.source)?.name ?? edge.source;
  const t = index.nodes.get(edge.target)?.name ?? edge.target;
  const member = edge.label ? `.${edge.label}` : "";
  return `${s}${edge.sourceMember ? `.${edge.sourceMember}` : ""} ${VERBS[edge.kind]} ${t}${member}`;
}
