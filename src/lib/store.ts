"use client";

import { create } from "zustand";
import type { AnalysisResult, NodeKind } from "@/analyzer/types";
import { indexGraph, type GraphIndex } from "@/analyzer/queries/graph-index";
import { DEFAULT_HIDDEN_KINDS } from "@/analyzer/views";
import type { ProjectRecord } from "./api";

interface WorkspaceState {
  analysisId: string | null;
  result: AnalysisResult | null;
  index: GraphIndex | null;
  project: ProjectRecord | null;
  selectedId: string | null;
  hiddenKinds: NodeKind[];
  paletteOpen: boolean;
  sidebarCollapsed: boolean;
  setAnalysis: (analysisId: string, result: AnalysisResult, project: ProjectRecord | null) => void;
  reset: () => void;
  select: (id: string | null) => void;
  toggleKind: (kind: NodeKind) => void;
  setHiddenKinds: (kinds: NodeKind[]) => void;
  setPaletteOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  analysisId: null,
  result: null,
  index: null,
  project: null,
  selectedId: null,
  hiddenKinds: DEFAULT_HIDDEN_KINDS,
  paletteOpen: false,
  sidebarCollapsed: false,
  setAnalysis: (analysisId, result, project) => set({ analysisId, result, project, index: indexGraph(result), selectedId: null }),
  reset: () => set({ analysisId: null, result: null, index: null, project: null, selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  toggleKind: (kind) => set((s) => ({ hiddenKinds: s.hiddenKinds.includes(kind) ? s.hiddenKinds.filter((k) => k !== kind) : [...s.hiddenKinds, kind] })),
  setHiddenKinds: (hiddenKinds) => set({ hiddenKinds }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

/** The loaded analysis. Only call inside the workspace layout, which guarantees it is present. */
export function useAnalysis(): { result: AnalysisResult; index: GraphIndex; analysisId: string } {
  const result = useWorkspace((s) => s.result);
  const index = useWorkspace((s) => s.index);
  const analysisId = useWorkspace((s) => s.analysisId);
  if (!result || !index || !analysisId) throw new Error("useAnalysis() used outside of a loaded workspace");
  return { result, index, analysisId };
}
