/**
 * Presentation metadata shared by the UI and the exporters, so an exported
 * SVG uses the same vocabulary and colours as the interactive map.
 */
import type { EdgeKind, NodeKind } from "./types.ts";

export interface KindMeta {
  label: string;
  plural: string;
  /** Three-letter tag shown on graph nodes. */
  tag: string;
  color: string;
  /** Lower rank = further left in layered layouts. */
  layer: number;
}

export const KIND_META: Record<NodeKind, KindMeta> = {
  layout: { label: "Layout", plural: "Layouts", tag: "LAY", color: "#8b9be0", layer: 0 },
  page: { label: "Page", plural: "Pages", tag: "PGE", color: "#9db1ff", layer: 0 },
  "route-segment": { label: "Route segment", plural: "Route segments", tag: "SEG", color: "#7d88b3", layer: 0 },
  middleware: { label: "Middleware", plural: "Middleware", tag: "MID", color: "#b8957a", layer: 0 },
  provider: { label: "Provider", plural: "Providers", tag: "PRV", color: "#b9a6e6", layer: 1 },
  component: { label: "Component", plural: "Components", tag: "CMP", color: "#c8ccd4", layer: 1 },
  event: { label: "Event", plural: "Events", tag: "EVT", color: "#97c4e4", layer: 2 },
  context: { label: "Context", plural: "Contexts", tag: "CTX", color: "#a690d8", layer: 2 },
  hook: { label: "Hook", plural: "Hooks", tag: "HOK", color: "#86c7a4", layer: 2 },
  utility: { label: "Utility", plural: "Utilities", tag: "UTL", color: "#8e949f", layer: 3 },
  service: { label: "Service", plural: "Services", tag: "SVC", color: "#e0a96d", layer: 3 },
  "server-action": { label: "Server action", plural: "Server actions", tag: "ACT", color: "#d98ea8", layer: 3 },
  endpoint: { label: "Endpoint", plural: "Endpoints", tag: "API", color: "#ecc777", layer: 4 },
  "route-handler": { label: "Route handler", plural: "Route handlers", tag: "RTE", color: "#e3927a", layer: 5 },
  "db-entity": { label: "Data store", plural: "Data stores", tag: "DB", color: "#d4bb8f", layer: 6 },
  external: { label: "Package", plural: "Packages", tag: "PKG", color: "#6f7580", layer: 6 },
};

export const EDGE_META: Record<EdgeKind, { label: string; flow: boolean }> = {
  renders: { label: "renders", flow: false },
  "uses-hook": { label: "uses hook", flow: true },
  "consumes-context": { label: "reads context", flow: false },
  "provides-context": { label: "provides context", flow: false },
  calls: { label: "calls", flow: true },
  handles: { label: "handles", flow: true },
  triggers: { label: "triggers", flow: true },
  requests: { label: "requests", flow: true },
  "handled-by": { label: "handled by", flow: true },
  queries: { label: "queries", flow: true },
  "lazy-loads": { label: "lazy-loads", flow: false },
  "uses-package": { label: "uses package", flow: false },
};

/** Estimated rendered width of a node label in the 12px monospace node font. */
export function nodeSize(name: string): { width: number; height: number } {
  const width = Math.round(Math.min(300, Math.max(132, 56 + name.length * 7.3)));
  return { width, height: 44 };
}
