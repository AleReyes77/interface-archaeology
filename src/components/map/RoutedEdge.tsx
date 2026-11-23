"use client";

import { memo } from "react";
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import type { Confidence, EdgeKind } from "@/analyzer/types";

export interface RoutedEdgeData extends Record<string, unknown> {
  points: { x: number; y: number }[];
  kind: EdgeKind;
  confidence: Confidence;
  state: "default" | "active" | "dimmed";
  count: number;
}

export type RoutedFlowEdge = Edge<RoutedEdgeData, "routed">;

/** Smooth path through the points computed by the layered layout. */
export function pathThrough(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const n = points[i + 1]!;
    const mx = (p.x + n.x) / 2;
    const my = (p.y + n.y) / 2;
    d += ` Q${p.x},${p.y} ${mx},${my}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${last.x},${last.y}`;
  return d;
}

const API_KINDS = new Set<EdgeKind>(["requests", "handled-by", "queries"]);

export const RoutedEdge = memo(function RoutedEdge({ id, data, sourceX, sourceY, targetX, targetY, selected }: EdgeProps<RoutedFlowEdge>) {
  const points = data?.points?.length ? data.points : [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];
  const state = selected ? "active" : (data?.state ?? "default");
  const color = state === "active" ? "var(--edge-active)" : data && API_KINDS.has(data.kind) && state !== "dimmed" ? "rgb(236 199 119 / 0.55)" : "var(--edge)";
  return (
    <BaseEdge
      id={id}
      path={pathThrough(points)}
      markerEnd={state === "active" ? "url(#ia-arrow-active)" : "url(#ia-arrow)"}
      interactionWidth={14}
      style={{
        stroke: color,
        strokeWidth: state === "active" ? 1.6 : 1.1,
        strokeDasharray: data?.confidence === "inferred" ? "4 3" : undefined,
        opacity: state === "dimmed" ? 0.18 : 1,
        transition: "opacity var(--dur-2) var(--ease), stroke var(--dur-2) var(--ease)",
      }}
    />
  );
});
