"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, type AnalysisStatusResponse } from "@/lib/api";
import { useWorkspace } from "@/lib/store";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { navHref, PROJECT_NAV, WORKSPACE_NAV } from "@/components/shell/nav";
import shell from "@/components/shell/shell.module.css";
import states from "@/components/states.module.css";

type LoadState = { kind: "loading" } | { kind: "running"; status: AnalysisStatusResponse } | { kind: "failed"; status: AnalysisStatusResponse | null; message: string };

export default function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ analysisId: string }> }) {
  const { analysisId } = use(params);
  const router = useRouter();
  const setAnalysis = useWorkspace((s) => s.setAnalysis);
  const loadedId = useWorkspace((s) => s.analysisId);
  const collapsed = useWorkspace((s) => s.sidebarCollapsed);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [cancelling, setCancelling] = useState(false);
  const ready = loadedId === analysisId;

  useEffect(() => {
    if (useWorkspace.getState().analysisId === analysisId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await api.getAnalysis(analysisId);
        if (stopped) return;
        if (status.analysis.status === "running") {
          setState({ kind: "running", status });
          timer = setTimeout(poll, 350);
        } else if (status.analysis.status === "completed") {
          const result = await api.getResult(analysisId);
          if (stopped) return;
          setAnalysis(analysisId, result, status.project);
        } else {
          setState({ kind: "failed", status, message: status.analysis.error ?? `Analysis ${status.analysis.status}` });
        }
      } catch (error) {
        if (!stopped) setState({ kind: "failed", status: null, message: (error as Error).message });
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [analysisId, setAnalysis]);

  // Global shortcuts: Ctrl/Cmd+K for search; "g" then a letter to switch views.
  const pendingG = useRef<number>(0);
  useEffect(() => {
    const keys: Record<string, string> = {};
    for (const item of [...WORKSPACE_NAV, ...PROJECT_NAV]) if (item.shortcut) keys[item.shortcut.split(" ")[1]!.toLowerCase()] = navHref(analysisId, item);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!useWorkspace.getState().paletteOpen);
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (Date.now() - pendingG.current < 900 && keys[e.key]) {
        pendingG.current = 0;
        router.push(keys[e.key]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysisId, router, setPaletteOpen]);

  if (!ready && state.kind === "loading") {
    return (
      <div className={states.center}>
        <p className="muted">Loading analysis…</p>
      </div>
    );
  }

  if (!ready && state.kind === "running") {
    return (
      <AnalysisProgress
        progress={state.status.progress}
        projectName={state.status.project?.name}
        cancelling={cancelling}
        onCancel={async () => {
          setCancelling(true);
          await api.cancelOrDeleteAnalysis(analysisId).catch(() => undefined);
        }}
      />
    );
  }

  if (!ready && state.kind === "failed") {
    const cancelled = state.status?.analysis.status === "cancelled";
    return (
      <div className={states.center}>
        <div className={states.messageCard}>
          <h1 className={states.title}>{cancelled ? "Analysis cancelled" : "The analysis could not be completed"}</h1>
          <p className={states.text}>{cancelled ? "No results were saved for this run." : "Nothing was saved for this run. The message below explains what went wrong."}</p>
          {!cancelled ? <p className={states.code}>{state.message}</p> : null}
          <div className={states.actions}>
            {state.status?.project ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const { analysis } = await api.startAnalysis(state.status!.project!.id);
                  router.push(`/workspace/${analysis.id}`);
                }}
              >
                Run the analysis again
              </button>
            ) : null}
            <Link className="btn" href="/workspace">
              Back to projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shell.frame} data-collapsed={collapsed || undefined}>
      <Sidebar analysisId={analysisId} />
      <Topbar analysisId={analysisId} />
      <main className={shell.main}>{children}</main>
      <CommandPalette />
    </div>
  );
}
