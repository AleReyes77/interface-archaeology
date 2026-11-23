"use client";

import { Check, LoaderCircle } from "lucide-react";
import { ANALYSIS_STAGES, type AnalysisProgress as Progress } from "@/analyzer/types";
import styles from "./states.module.css";

/**
 * Shows the analysis stages as they actually run. Only the parse stage has a
 * measurable unit of work (files), so only it shows a count and a bar.
 */
export function AnalysisProgress({ progress, projectName, onCancel, cancelling }: { progress: Progress | null; projectName?: string; onCancel: () => void; cancelling: boolean }) {
  const current = progress?.stageIndex ?? -1;
  return (
    <div className={styles.center}>
      <div className={styles.progressCard} role="status" aria-live="polite">
        <h1 className={styles.title}>Analyzing {projectName ?? "project"}</h1>
        <p className={styles.text}>Reading source files and reconstructing relationships. Nothing in the project is executed.</p>
        <ol className={styles.stages}>
          {ANALYSIS_STAGES.map((stage, i) => {
            const state = i < current ? "done" : i === current ? "active" : "pending";
            return (
              <li key={stage.id} className={styles.stage} data-state={state}>
                <span className={styles.stageIcon} aria-hidden="true">
                  {state === "done" ? <Check size={13} /> : state === "active" ? <LoaderCircle size={13} className={styles.spin} /> : null}
                </span>
                <span>{stage.label}</span>
                {state === "active" && progress?.total ? (
                  <span className={styles.stageCount}>
                    {progress.processed ?? 0} / {progress.total} files
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {progress?.stage === "parse" && progress.total ? (
          <div className={styles.bar} aria-hidden="true">
            <span style={{ width: `${Math.round(((progress.processed ?? 0) / progress.total) * 100)}%` }} />
          </div>
        ) : null}
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel analysis"}
        </button>
      </div>
    </div>
  );
}
