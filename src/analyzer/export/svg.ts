/**
 * Standalone SVG export of the architecture graph, laid out with the same
 * algorithm as the interactive map. Self-contained: no external fonts or CSS.
 */
import { layoutGraph } from "../layout.ts";
import { KIND_META, nodeSize } from "../presentation.ts";
import type { AnalysisResult, NodeKind } from "../types.ts";
import { architectureView, DEFAULT_HIDDEN_KINDS } from "../views.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface SvgOptions {
  hiddenKinds?: NodeKind[];
  include?: Set<string>;
  title?: string;
  highlight?: Set<string>;
}

export function toSvg(result: AnalysisResult, options: SvgOptions = {}): string {
  const view = architectureView(result, options.hiddenKinds ?? DEFAULT_HIDDEN_KINDS, options.include);
  const laid = layoutGraph(
    view.nodes.map((n) => ({ id: n.id, ...nodeSize(n.name) })),
    view.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  );
  const pad = 24;
  const header = options.title === undefined ? 40 : options.title ? 40 : 0;
  const width = Math.ceil(laid.width + pad * 2);
  const height = Math.ceil(laid.height + pad * 2 + header);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`);
  parts.push(`<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#5b616c"/></marker></defs>`);
  parts.push(`<rect width="100%" height="100%" fill="#111214"/>`);
  if (header) {
    const title = options.title ?? `${result.project.name} — architecture map`;
    parts.push(`<text x="${pad}" y="${pad + 8}" fill="#e6e7ea" font-size="13" font-weight="600">${esc(title)}</text>`);
    parts.push(`<text x="${width - pad}" y="${pad + 8}" fill="#6b717c" font-size="11" text-anchor="end">Interface Archaeology · static analysis · ${esc(result.generatedAt.slice(0, 10))}</text>`);
  }
  parts.push(`<g transform="translate(${pad},${pad + header})">`);
  for (const e of view.edges) {
    const points = laid.edges.get(e.id);
    if (!points?.length) continue;
    const d = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="#3a3e46" stroke-width="1.2"${e.confidence === "inferred" ? ' stroke-dasharray="4 3"' : ""} marker-end="url(#arrow)"/>`);
  }
  for (const n of view.nodes) {
    const box = laid.nodes.get(n.id);
    if (!box) continue;
    const meta = KIND_META[n.kind];
    const hl = options.highlight?.has(n.id);
    parts.push(`<g transform="translate(${box.x.toFixed(1)},${box.y.toFixed(1)})">`);
    parts.push(`<rect width="${box.width}" height="${box.height}" rx="5" fill="#17181b" stroke="${hl ? "#63c5b0" : "#2a2d33"}"/>`);
    parts.push(`<rect width="2.5" height="${box.height - 12}" x="0" y="6" fill="${meta.color}"/>`);
    parts.push(`<text x="12" y="18" fill="#e6e7ea" font-size="12">${esc(n.name)}</text>`);
    parts.push(`<text x="12" y="33" fill="${meta.color}" font-size="9.5" letter-spacing="0.6">${meta.tag}<tspan fill="#6b717c"> ${esc((n.file ?? n.route ?? "").split("/").slice(-2).join("/"))}</tspan></text>`);
    parts.push(`</g>`);
  }
  parts.push(`</g></svg>`);
  return parts.join("\n");
}
