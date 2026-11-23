"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { KIND_META } from "@/analyzer/presentation";
import type { GraphNode } from "@/analyzer/types";
import { kindStyle } from "../KindBadge";
import styles from "./map.module.css";

export interface ArchNodeData extends Record<string, unknown> {
  node: GraphNode;
  state: "default" | "selected" | "neighbor" | "dimmed" | "match";
  direction: "LR" | "TB";
}

export type ArchFlowNode = Node<ArchNodeData, "arch">;

function subtitle(n: GraphNode): string {
  if (n.kind === "endpoint" || n.kind === "db-entity" || n.kind === "external") return KIND_META[n.kind].label;
  if (!n.file) return KIND_META[n.kind].label;
  const parts = n.file.split("/");
  return parts.slice(-2).join("/");
}

export const ArchNode = memo(function ArchNode({ data }: NodeProps<ArchFlowNode>) {
  const { node, state, direction } = data;
  const env = node.renderEnv?.env;
  return (
    <div className={styles.node} data-state={state} style={kindStyle(node.kind)} title={`${KIND_META[node.kind].label}: ${node.file ?? node.name}`}>
      <Handle type="target" position={direction === "LR" ? Position.Left : Position.Top} className={styles.handle} isConnectable={false} />
      <span className={styles.nodeBar} aria-hidden="true" />
      <span className={styles.nodeName}>{node.name}</span>
      <span className={styles.nodeMeta}>
        <span className={styles.nodeTag}>{KIND_META[node.kind].tag}</span>
        <span className={styles.nodePath}>{subtitle(node)}</span>
        {env === "client" ? <span className={styles.nodeEnv} title={node.renderEnv?.reason}>client</span> : null}
      </span>
      <Handle type="source" position={direction === "LR" ? Position.Right : Position.Bottom} className={styles.handle} isConnectable={false} />
    </div>
  );
});

export interface FolderNodeData extends Record<string, unknown> {
  label: string;
}
export type FolderFlowNode = Node<FolderNodeData, "folder">;

export const FolderNode = memo(function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  return (
    <div className={styles.folder}>
      <span className={styles.folderLabel}>{data.label}</span>
    </div>
  );
});
