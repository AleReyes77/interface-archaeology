/**
 * Change-impact analysis: "what might break if I modify this?"
 *
 * Walks relationships in reverse from the selected node. The result is a
 * potential impact based on detected dependencies — static analysis cannot
 * observe runtime-only coupling (reflection, string-based lookups, global events).
 */
import type { AnalysisResult, Confidence, EdgeKind, GraphEdge, NodeKind } from "../types.ts";
import { describeEdge, indexGraph, type GraphIndex } from "./graph-index.ts";

const IMPACT_EDGES = new Set<EdgeKind>([
  "renders", "uses-hook", "consumes-context", "provides-context", "calls", "handles",
  "triggers", "requests", "handled-by", "queries", "lazy-loads",
]);

export interface ImpactItem {
  nodeId: string;
  depth: number;
  /** Edges from this item to the target, in order (item → … → target). */
  path: GraphEdge[];
  confidence: Confidence;
  reason: string;
}

export interface ImpactReport {
  targetId: string;
  items: ImpactItem[];
  direct: ImpactItem[];
  indirect: ImpactItem[];
  routes: ImpactItem[];
  flows: ImpactItem[];
  services: ImpactItem[];
  /** What the target itself depends on (outgoing), for context. */
  dependsOn: GraphEdge[];
  /** Files that import the target's file, transitively. */
  importingFiles: { file: string; depth: number }[];
  maxDepth: number;
}

const ROUTE_KINDS = new Set<NodeKind>(["page", "layout", "route-segment", "route-handler", "middleware"]);
const SERVICE_KINDS = new Set<NodeKind>(["service", "server-action", "endpoint", "hook"]);

export function computeImpact(result: AnalysisResult, targetId: string, index: GraphIndex = indexGraph(result), maxDepth = 8): ImpactReport | null {
  const target = index.nodes.get(targetId);
  if (!target) return null;

  const items: ImpactItem[] = [];
  const visited = new Set<string>([targetId]);
  let frontier: { nodeId: string; path: GraphEdge[] }[] = [{ nodeId: targetId, path: [] }];

  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { nodeId, path } of frontier) {
      for (const edge of index.in.get(nodeId) ?? []) {
        if (!IMPACT_EDGES.has(edge.kind) || visited.has(edge.source)) continue;
        visited.add(edge.source);
        const itemPath = [edge, ...path];
        const confidence: Confidence = itemPath.some((e) => e.confidence === "inferred") ? "inferred" : "detected";
        items.push({ nodeId: edge.source, depth, path: itemPath, confidence, reason: describeEdge(edge, index) });
        next.push({ nodeId: edge.source, path: itemPath });
      }
    }
    frontier = next;
  }

  const kindOf = (i: ImpactItem) => index.nodes.get(i.nodeId)?.kind;
  const importingFiles: { file: string; depth: number }[] = [];
  if (target.file) {
    const importers = new Map<string, string[]>();
    for (const e of result.fileEdges) {
      if (!importers.has(e.to)) importers.set(e.to, []);
      importers.get(e.to)!.push(e.from);
    }
    const seen = new Set([target.file]);
    let level = [target.file];
    for (let depth = 1; level.length && depth <= maxDepth; depth++) {
      const nextLevel: string[] = [];
      for (const f of level) {
        for (const imp of importers.get(f) ?? []) {
          if (seen.has(imp)) continue;
          seen.add(imp);
          importingFiles.push({ file: imp, depth });
          nextLevel.push(imp);
        }
      }
      level = nextLevel;
    }
  }

  return {
    targetId,
    items,
    direct: items.filter((i) => i.depth === 1),
    indirect: items.filter((i) => i.depth > 1),
    routes: items.filter((i) => ROUTE_KINDS.has(kindOf(i)!)),
    flows: items.filter((i) => kindOf(i) === "event"),
    services: items.filter((i) => SERVICE_KINDS.has(kindOf(i)!)),
    dependsOn: (index.out.get(targetId) ?? []).filter((e) => e.kind !== "handles"),
    importingFiles,
    maxDepth: Math.max(0, ...items.map((i) => i.depth)),
  };
}
