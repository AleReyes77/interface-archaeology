"use client";

import { TriangleAlert } from "lucide-react";
import { EDGE_META, KIND_META } from "@/analyzer/presentation";
import type { Flow, FlowStep } from "@/analyzer/queries/flows";
import type { GraphNode, NodeKind } from "@/analyzer/types";
import type { GraphIndex } from "@/analyzer/queries/graph-index";
import { ConfidenceTag, kindStyle } from "../KindBadge";
import styles from "./strata.module.css";

const LAYER_NAMES: Partial<Record<NodeKind, string>> = {
  event: "Interaction",
  component: "Component",
  page: "Page",
  layout: "Layout",
  provider: "Provider",
  hook: "Hook",
  context: "Context",
  service: "Service",
  utility: "Helper",
  "server-action": "Server action",
  endpoint: "Network request",
  "route-handler": "Route handler",
  "db-entity": "Data store",
  middleware: "Middleware",
};

interface LevelStep {
  step: FlowStep;
  parent: FlowStep | null;
}

/** Breadth-first levels of a flow tree: each level is one stratum. */
export function flowLevels(flow: Flow): LevelStep[][] {
  const levels: LevelStep[][] = [];
  let frontier: LevelStep[] = [{ step: flow.root, parent: null }];
  while (frontier.length) {
    levels.push(frontier);
    frontier = frontier.flatMap(({ step }) => step.children.map((c) => ({ step: c, parent: step })));
  }
  return levels;
}

export function Strata({ flow, index, selectedId, onSelect, compact }: { flow: Flow; index: GraphIndex; selectedId?: string | null; onSelect?: (id: string) => void; compact?: boolean }) {
  const levels = flowLevels(flow);
  const root = index.nodes.get(flow.root.nodeId);
  const stateUpdates = root?.stateUpdates ?? [];

  return (
    <ol className={styles.column} data-compact={compact || undefined} aria-label="Flow, layer by layer">
      {levels.map((level, depth) => {
        const kinds = [...new Set(level.map((l) => index.nodes.get(l.step.nodeId)?.kind).filter(Boolean))] as NodeKind[];
        const layer = kinds.map((k) => LAYER_NAMES[k] ?? KIND_META[k].label).join(" / ");
        return (
          <li key={depth} className={styles.stratum} style={{ "--depth": depth } as React.CSSProperties}>
            <div className={styles.gutter}>
              <span className={styles.depth}>{depth + 1}</span>
              <span className={styles.layer}>{layer}</span>
            </div>
            <div className={styles.cards}>
              {level.map(({ step, parent }) => (
                <StepCard key={`${parent?.nodeId ?? "root"}>${step.nodeId}>${step.member ?? ""}`} step={step} node={index.nodes.get(step.nodeId)!} parentNode={parent ? index.nodes.get(parent.nodeId) : undefined} showParent={level.length > 1 && depth > 1} selected={selectedId === step.nodeId} onSelect={onSelect} />
              ))}
            </div>
          </li>
        );
      })}
      {stateUpdates.length ? (
        <li className={styles.stratum} data-final>
          <div className={styles.gutter}>
            <span className={styles.depth}>↺</span>
            <span className={styles.layer}>UI state</span>
          </div>
          <div className={styles.cards}>
            {stateUpdates.map((s) => (
              <div key={s} className={styles.card} data-kind="state">
                <span className={styles.cardName}>{s}</span>
                <span className={styles.via}>updated by the handler, causing a re-render</span>
              </div>
            ))}
          </div>
        </li>
      ) : null}
    </ol>
  );
}

function StepCard({ step, node, parentNode, showParent, selected, onSelect }: { step: FlowStep; node: GraphNode; parentNode?: GraphNode; showParent: boolean; selected: boolean; onSelect?: (id: string) => void }) {
  const via = step.via;
  const reason = via?.evidence[0]?.reason;
  return (
    <div className={styles.cardWrap}>
      <button type="button" className={styles.card} style={kindStyle(node.kind)} data-selected={selected || undefined} onClick={() => onSelect?.(node.id)}>
        <span className={styles.cardTop}>
          <span className={styles.cardName}>
            {node.name}
            {step.member ? <span className={styles.member}>.{step.member}</span> : null}
          </span>
          {via ? <ConfidenceTag confidence={via.confidence} /> : null}
        </span>
        {via ? (
          <span className={styles.via}>
            {showParent && parentNode ? `${parentNode.name} ` : ""}
            {EDGE_META[via.kind].label}
            {reason ? `: ${reason}` : ""}
          </span>
        ) : (
          <span className={styles.via}>{node.file ? `${node.file}:${node.line}` : KIND_META[node.kind].label}</span>
        )}
      </button>
      {step.gaps.map((g) => (
        <p key={g} className={styles.gap}>
          <TriangleAlert size={12} aria-hidden="true" />
          {g}
        </p>
      ))}
    </div>
  );
}
