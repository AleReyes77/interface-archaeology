"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_LIMITS } from "@/analyzer/limits";
import { api } from "@/lib/api";
import { useAnalysis, useWorkspace } from "@/lib/store";
import styles from "@/components/page.module.css";

export default function SettingsPage() {
  const router = useRouter();
  const { result } = useAnalysis();
  const project = useWorkspace((s) => s.project);
  const limits = { ...DEFAULT_LIMITS, ...project?.settings.limits };
  const [maxFiles, setMaxFiles] = useState(String(limits.maxFiles));
  const [maxKb, setMaxKb] = useState(String(Math.round(limits.maxFileBytes / 1024)));
  const [ignored, setIgnored] = useState(limits.ignoredDirectories.join(", "));
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }>({ kind: "idle" });

  if (!project) return null;

  const save = async (andAnalyze: boolean) => {
    setState({ kind: "saving" });
    try {
      const updated = await api.updateSettings(project.id, {
        limits: {
          maxFiles: Number(maxFiles),
          maxFileBytes: Number(maxKb) * 1024,
          ignoredDirectories: ignored.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      useWorkspace.setState({ project: updated.project });
      setState({ kind: "saved" });
      if (andAnalyze) {
        const { analysis } = await api.startAnalysis(project.id);
        router.push(`/workspace/${analysis.id}`);
      }
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };

  const removeProject = async () => {
    if (!window.confirm(`Remove "${project.name}" and all of its analyses from Interface Archaeology? The project files on disk are not touched.`)) return;
    await api.deleteProject(project.id);
    router.push("/workspace");
  };

  return (
    <div className={styles.scrollPage}>
      <div className={styles.content} style={{ maxWidth: 760 }}>
        <header className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>Settings</h1>
            <p className={styles.pageLede}>Analysis limits for {project.name}. They apply to the next run.</p>
          </div>
        </header>

        <form
          className={styles.section}
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className={styles.sectionTitle}>Maximum number of source files</span>
            <span className={styles.sectionNote}>Analysis stops discovering files beyond this count and reports it. The last run found {result.stats.filesDiscovered}.</span>
            <input className="input" type="number" min={1} max={50000} value={maxFiles} onChange={(e) => setMaxFiles(e.target.value)} style={{ maxWidth: 200 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className={styles.sectionTitle}>Maximum file size (KB)</span>
            <span className={styles.sectionNote}>Larger files, usually generated or minified code, are skipped and listed in the analysis notes.</span>
            <input className="input" type="number" min={1} max={9765} value={maxKb} onChange={(e) => setMaxKb(e.target.value)} style={{ maxWidth: 200 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className={styles.sectionTitle}>Ignored directories</span>
            <span className={styles.sectionNote}>Directory names skipped anywhere in the tree, separated by commas.</span>
            <textarea className="input mono" rows={3} value={ignored} onChange={(e) => setIgnored(e.target.value)} style={{ height: "auto", padding: 8 }} />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="submit" className="btn" disabled={state.kind === "saving"}>
              Save settings
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save(true)} disabled={state.kind === "saving"}>
              Save and analyze again
            </button>
            {state.kind === "saved" ? <span className={styles.sectionNote}>Settings saved.</span> : null}
            {state.kind === "error" ? <span style={{ color: "var(--error)", fontSize: "var(--text-sm)" }}>{state.message}</span> : null}
          </div>
        </form>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Remove project</h2>
          </div>
          <p className={styles.sectionNote} style={{ marginBottom: 12 }}>
            Deletes this project and its analysis history from the local database. Files on disk are never modified.
          </p>
          <button type="button" className="btn btn-danger" onClick={() => void removeProject()}>
            Remove {project.name}
          </button>
        </section>
      </div>
    </div>
  );
}
