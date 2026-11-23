/**
 * Data-flow tracing: follows behavioural edges forward from an entry point
 * (usually a UI event) through handlers, hooks, services and network calls to
 * route handlers and data stores. Gaps are reported, never filled in.
 */
import type { AnalysisResult, Confidence, EdgeKind, GraphEdge } from "../types.ts";
import { indexGraph, type GraphIndex } from "./graph-index.ts";

const FLOW_EDGES = new Set<EdgeKind>(["triggers", "calls", "uses-hook", "requests", "handled-by", "queries"]);
const MAX_DEPTH = 12;

export interface FlowStep {
  nodeId: string;
  /** Edge used to reach this step (absent for the root). */
  via?: GraphEdge;
  /** Member of this node that is entered (e.g. `update` on DocumentService). */
  member?: string;
  depth: number;
  children: FlowStep[];
  gaps: string[];
}

export interface Flow {
  startId: string;
  root: FlowStep;
  confidence: Confidence;
  steps: number;
  gaps: string[];
  reaches: { endpoints: string[]; handlers: string[]; entities: string[] };
}

export function traceFlow(result: AnalysisResult, startId: string, index: GraphIndex = indexGraph(result)): Flow | null {
  const start = index.nodes.get(startId);
  if (!start) return null;
  let steps = 0;
  let confidence: Confidence = "detected";
  const gaps: string[] = [];
  const reaches = { endpoints: new Set<string>(), handlers: new Set<string>(), entities: new Set<string>() };

  const visit = (nodeId: string, via: GraphEdge | undefined, member: string | undefined, depth: number, path: Set<string>): FlowStep => {
    steps++;
    const node = index.nodes.get(nodeId)!;
    const step: FlowStep = { nodeId, via, member, depth, children: [], gaps: [] };
    if (via?.confidence === "inferred") confidence = "inferred";
    if (node.kind === "endpoint") reaches.endpoints.add(nodeId);
    if (node.kind === "route-handler" || node.kind === "server-action") reaches.handlers.add(nodeId);
    if (node.kind === "db-entity") reaches.entities.add(nodeId);

    let outgoing = (index.out.get(nodeId) ?? []).filter((e) => FLOW_EDGES.has(e.kind));
    // Entering a service through a specific member: follow only that member's relationships.
    if (member && node.members?.some((m) => m.name === member)) {
      outgoing = outgoing.filter((e) => e.sourceMember === member);
    }

    const dynamic = result.network.filter((n) => n.callerId === nodeId && n.endpointId === null && (!member || n.callerMember === member));
    for (const n of dynamic) step.gaps.push(`Network request at ${n.file}:${n.line} uses a dynamic URL (${n.rawUrl}); its target cannot be determined statically.`);

    if (node.kind === "endpoint" && !outgoing.some((e) => e.kind === "handled-by")) {
      step.gaps.push(node.flags.includes("external-url") ? "Request goes to an external or environment-configured URL." : "No route handler in the analyzed project matches this URL; it may be served elsewhere.");
    }
    if (node.kind === "event" && outgoing.length === 0 && !node.stateUpdates?.length) {
      step.gaps.push(`The effects of handler ${node.handler ?? ""} could not be resolved statically.`);
    }

    if (depth >= MAX_DEPTH) {
      if (outgoing.length) step.gaps.push("Maximum trace depth reached.");
      gaps.push(...step.gaps);
      return step;
    }

    const seen = new Set<string>();
    for (const edge of outgoing) {
      const key = `${edge.target}|${edge.label ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (path.has(edge.target)) {
        step.gaps.push(`Recursive relationship back to ${index.nodes.get(edge.target)?.name ?? edge.target} not expanded.`);
        continue;
      }
      path.add(edge.target);
      step.children.push(visit(edge.target, edge, edge.label, depth + 1, path));
      path.delete(edge.target);
    }
    gaps.push(...step.gaps);
    return step;
  };

  const root = visit(startId, undefined, undefined, 0, new Set([startId]));
  return {
    startId,
    root,
    confidence,
    steps,
    gaps,
    reaches: { endpoints: [...reaches.endpoints], handlers: [...reaches.handlers], entities: [...reaches.entities] },
  };
}

/** Linear chains from the root to each leaf, useful for summaries and exports. */
export function flowPaths(flow: Flow): FlowStep[][] {
  const paths: FlowStep[][] = [];
  const walk = (step: FlowStep, acc: FlowStep[]) => {
    const next = [...acc, step];
    if (!step.children.length) paths.push(next);
    else step.children.forEach((c) => walk(c, next));
  };
  walk(flow.root, []);
  return paths;
}

/** Entry points worth tracing: UI events, plus server actions and route handlers. */
export function flowEntryPoints(result: AnalysisResult): string[] {
  return result.nodes.filter((n) => n.kind === "event").map((n) => n.id);
}
