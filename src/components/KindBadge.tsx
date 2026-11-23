import type { CSSProperties } from "react";
import { KIND_META } from "@/analyzer/presentation";
import type { Confidence, NodeKind } from "@/analyzer/types";

export function kindStyle(kind: NodeKind): CSSProperties {
  return { "--kind-color": `var(--k-${kind})` } as CSSProperties;
}

export function KindDot({ kind }: { kind: NodeKind }) {
  return <span className="kind-dot" style={kindStyle(kind)} aria-hidden="true" />;
}

export function KindLabel({ kind }: { kind: NodeKind }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", color: "var(--ink-2)" }}>
      <KindDot kind={kind} />
      {KIND_META[kind].label}
    </span>
  );
}

export function ConfidenceTag({ confidence, title }: { confidence: Confidence; title?: string }) {
  return (
    <span className="conf" data-confidence={confidence} title={title ?? (confidence === "detected" ? "Read directly from the source syntax" : "Derived by a heuristic; verify in source")}>
      {confidence}
    </span>
  );
}
