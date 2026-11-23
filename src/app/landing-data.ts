/**
 * Data for the landing page, produced by running the real analyzer on the
 * bundled sample project at build time. Nothing here is hand-written.
 */
import path from "node:path";
import { analyzeProject } from "@/analyzer/pipeline";
import { indexGraph } from "@/analyzer/queries/graph-index";
import { traceFlow } from "@/analyzer/queries/flows";
import { computeImpact } from "@/analyzer/queries/impact";
import { toSvg } from "@/analyzer/export/svg";
import { KIND_META } from "@/analyzer/presentation";
import type { Confidence, NodeKind } from "@/analyzer/types";

export interface CrossSectionLayer {
  layer: string;
  name: string;
  kind: NodeKind;
  location: string;
  confidence: Confidence | null;
}

const LAYER: Partial<Record<NodeKind, string>> = {
  event: "Interaction",
  hook: "Hook",
  service: "Service",
  utility: "Helper",
  endpoint: "Network",
  "route-handler": "Route handler",
  "db-entity": "Data",
  component: "Component",
};

export async function loadLandingData() {
  const result = await analyzeProject(path.join(process.cwd(), "fixtures", "inkwell"), { name: "inkwell" });
  const index = indexGraph(result);

  // The deepest interaction that reaches the data layer becomes the hero's cross-section.
  const traced = result.nodes
    .filter((n) => n.kind === "event")
    .map((n) => traceFlow(result, n.id, index)!)
    .filter((f) => f.reaches.entities.length)
    .sort((a, b) => b.steps - a.steps);
  const flow = traced.find((f) => index.nodes.get(f.startId)?.name.includes("Save")) ?? traced[0]!;

  // Follow the branch that ends in the data layer.
  const layers: CrossSectionLayer[] = [];
  let step = flow.root;
  for (;;) {
    const node = index.nodes.get(step.nodeId)!;
    layers.push({
      layer: LAYER[node.kind] ?? KIND_META[node.kind].label,
      name: `${node.name}${step.member ? `.${step.member}` : ""}`,
      kind: node.kind,
      location: node.file ? `${node.file}:${node.line}` : (node.route ?? KIND_META[node.kind].label),
      confidence: step.via?.confidence ?? null,
    });
    const next = step.children.find((c) => reachesData(c, index)) ?? step.children[0];
    if (!next) break;
    step = next;
  }

  const owner = (index.in.get(flow.startId) ?? []).find((e) => e.kind === "handles");
  const service = result.nodes.find((n) => n.name === "DocumentService");
  const impact = service ? computeImpact(result, service.id, index) : null;

  return {
    projectName: result.project.name,
    framework: `${result.framework.label} ${result.framework.version ?? ""}`.trim(),
    eventLabel: index.nodes.get(flow.startId)?.name ?? "",
    ownerName: owner ? index.nodes.get(owner.source)?.name : undefined,
    layers,
    svg: toSvg(result, { title: "" }),
    stats: {
      files: result.stats.filesAnalyzed,
      lines: result.stats.totalLoc,
      ms: result.durationMs,
      components: (result.stats.nodesByKind.component ?? 0) + (result.stats.nodesByKind.provider ?? 0),
      hooks: result.stats.nodesByKind.hook ?? 0,
      endpoints: result.stats.nodesByKind.endpoint ?? 0,
      routes: result.routes.length,
      relationships: result.edges.length,
      inferred: result.edges.filter((e) => e.confidence === "inferred").length,
      events: result.stats.nodesByKind.event ?? 0,
    },
    impact: impact && service ? { name: service.name, direct: impact.direct.length, indirect: impact.indirect.length, flows: impact.flows.length, routes: impact.routes.length } : null,
  };
}

function reachesData(step: { nodeId: string; children: { nodeId: string; children: unknown[] }[] }, index: ReturnType<typeof indexGraph>): boolean {
  if (index.nodes.get(step.nodeId)?.kind === "db-entity") return true;
  return step.children.some((c) => reachesData(c as typeof step, index));
}
