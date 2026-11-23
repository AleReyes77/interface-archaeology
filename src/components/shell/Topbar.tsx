"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronsUpDown, Download, RefreshCw, Search } from "lucide-react";
import { api, exportUrl, type ChangeReport } from "@/lib/api";
import { useWorkspace } from "@/lib/store";
import { relativeTime } from "@/lib/format";
import { Menu } from "../Menu";
import { activeNav } from "./nav";
import styles from "./shell.module.css";

export function Topbar({ analysisId }: { analysisId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const project = useWorkspace((s) => s.project);
  const result = useWorkspace((s) => s.result);
  const hiddenKinds = useWorkspace((s) => s.hiddenKinds);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const [changes, setChanges] = useState<ChangeReport | "checking" | "error">("checking");
  const [restarting, setRestarting] = useState(false);
  const view = activeNav(pathname);

  useEffect(() => {
    let cancelled = false;
    api
      .getChanges(analysisId)
      .then((c) => !cancelled && setChanges(c))
      .catch(() => !cancelled && setChanges("error"));
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const reanalyze = async () => {
    if (!project) return;
    setRestarting(true);
    try {
      const { analysis } = await api.startAnalysis(project.id);
      router.push(`/workspace/${analysis.id}`);
    } finally {
      setRestarting(false);
    }
  };

  const changedCount = typeof changes === "object" ? changes.added.length + changes.modified.length + changes.removed.length : 0;

  return (
    <header className={styles.topbar}>
      <div className={styles.crumbs}>
        <Link href="/workspace" className={styles.crumbProject} title="Switch project">
          {project?.name ?? "Project"}
          <ChevronsUpDown size={12} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <span className={styles.crumbSep} aria-hidden="true">/</span>
        <span className={styles.crumbView}>{view?.label ?? "Workspace"}</span>
      </div>

      <button type="button" className={styles.searchTrigger} onClick={() => setPaletteOpen(true)} aria-label="Search the architecture (Ctrl+K)">
        <Search size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Search components, files, routes, endpoints</span>
        <span className="kbd">Ctrl K</span>
      </button>

      <div className={styles.topActions}>
        {result ? (
          <span className={styles.status} data-state={changes === "checking" ? "checking" : typeof changes === "object" ? (changes.outdated ? "outdated" : "fresh") : "unknown"} title={`Analyzed ${new Date(result.generatedAt).toLocaleString()} in ${result.durationMs} ms`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {changes === "checking"
              ? "Checking for changes"
              : changes === "error"
                ? "Project folder unavailable"
                : changes.outdated
                  ? `${changedCount} file${changedCount === 1 ? "" : "s"} changed since analysis`
                  : `Up to date, analyzed ${relativeTime(result.generatedAt)}`}
          </span>
        ) : null}
        {typeof changes === "object" && changes.outdated ? (
          <button type="button" className="btn btn-sm" onClick={reanalyze} disabled={restarting}>
            <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" />
            Re-analyze
          </button>
        ) : null}
        <Menu label="Export" icon={<Download size={13} strokeWidth={1.75} aria-hidden="true" />}>
          {(close) => (
            <>
              <a role="menuitem" href={exportUrl(analysisId, "markdown")} onClick={close} download>
                Architecture report <span className="path">.md</span>
              </a>
              <a role="menuitem" href={exportUrl(analysisId, "mermaid", hiddenKinds)} onClick={close} download>
                Mermaid diagram <span className="path">.mmd</span>
              </a>
              <a role="menuitem" href={exportUrl(analysisId, "svg", hiddenKinds)} onClick={close} download>
                Graph image <span className="path">.svg</span>
              </a>
              <a role="menuitem" href={exportUrl(analysisId, "json")} onClick={close} download>
                Full analysis <span className="path">.json</span>
              </a>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}
