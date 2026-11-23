/**
 * Mermaid flowchart export of the architecture graph.
 */
import { KIND_META, EDGE_META } from "../presentation.ts";
import type { AnalysisResult, NodeKind } from "../types.ts";
import { architectureView, DEFAULT_HIDDEN_KINDS } from "../views.ts";

function escapeLabel(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/[<>]/g, (c) => (c === "<" ? "#lt;" : "#gt;"));
}

export function toMermaid(result: AnalysisResult, hiddenKinds: NodeKind[] = DEFAULT_HIDDEN_KINDS, include?: Set<string>): string {
  const view = architectureView(result, hiddenKinds, include);
  const ids = new Map(view.nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = ["flowchart LR"];
  const usedKinds = new Set<NodeKind>();
  for (const n of view.nodes) {
    usedKinds.add(n.kind);
    const id = ids.get(n.id)!;
    const label = escapeLabel(`${n.name}<br/><small>${KIND_META[n.kind].label}${n.file ? ` · ${n.file}` : ""}</small>`);
    const shape = n.kind === "db-entity" ? [`[(`, `)]`] : n.kind === "endpoint" ? [`{{`, `}}`] : n.kind === "event" ? [`([`, `])`] : [`[`, `]`];
    lines.push(`  ${id}${shape[0]}"${label}"${shape[1]}:::${n.kind.replace(/-/g, "_")}`);
  }
  for (const e of view.edges) {
    const arrow = e.confidence === "inferred" ? "-.->" : "-->";
    lines.push(`  ${ids.get(e.source)} ${arrow}|${EDGE_META[e.kind].label}| ${ids.get(e.target)}`);
  }
  for (const kind of usedKinds) {
    lines.push(`  classDef ${kind.replace(/-/g, "_")} stroke:${KIND_META[kind].color},stroke-width:1.5px`);
  }
  return `${lines.join("\n")}\n`;
}
