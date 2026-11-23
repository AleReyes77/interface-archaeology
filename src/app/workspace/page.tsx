"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, CornerLeftUp, FolderGit2, FolderOpen, Play, Trash2 } from "lucide-react";
import { api, type DirectoryListing, type ProjectWithLatest } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useWorkspace } from "@/lib/store";
import { Logo } from "@/components/Logo";
import styles from "./hub.module.css";

export default function WorkspaceHub() {
  const router = useRouter();
  const reset = useWorkspace((s) => s.reset);
  const [projects, setProjects] = useState<ProjectWithLatest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [busy, setBusy] = useState<"local" | "git" | "sample" | null>(null);
  const [error, setError] = useState<{ source: "local" | "git" | "sample"; message: string } | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const load = useCallback(() => {
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    reset();
    load();
  }, [load, reset]);

  const analyze = async (source: "local" | "git" | "sample") => {
    setBusy(source);
    setError(null);
    try {
      const { project } = await api.createProject(source === "local" ? { source, path } : source === "git" ? { source, url: gitUrl } : { source });
      const { analysis } = await api.startAnalysis(project.id);
      router.push(`/workspace/${analysis.id}`);
    } catch (e) {
      setError({ source, message: (e as Error).message });
      setBusy(null);
    }
  };

  const openLatest = async (p: ProjectWithLatest) => {
    const { analyses } = await api.getProject(p.id);
    const done = analyses.find((a) => a.status === "completed");
    if (done) router.push(`/workspace/${done.id}`);
    else {
      const { analysis } = await api.startAnalysis(p.id);
      router.push(`/workspace/${analysis.id}`);
    }
  };

  const remove = async (p: ProjectWithLatest) => {
    if (!window.confirm(`Remove "${p.name}" and its analysis history from Interface Archaeology? Files on disk are not touched.`)) return;
    await api.deleteProject(p.id);
    load();
  };

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          <Logo /> Interface Archaeology
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.intro}>
          <h1 className={styles.title}>{projects && projects.length ? "Choose a project to explore" : "Your codebase has not been explored yet."}</h1>
          <p className={styles.lede}>Open a local project to discover its components, architecture, dependencies and data flows. The code is read and parsed only; nothing is installed, built or executed.</p>
        </section>

        <section className={styles.sources}>
          <div className={styles.source}>
            <h2 className={styles.sourceTitle}>
              <FolderOpen size={16} strokeWidth={1.75} aria-hidden="true" /> Local directory
            </h2>
            <p className={styles.sourceText}>The absolute path of a React or Next.js project on this machine.</p>
            <form
              className={styles.row}
              onSubmit={(e) => {
                e.preventDefault();
                void analyze("local");
              }}
            >
              <input className="input mono" placeholder="C:\code\my-app" value={path} onChange={(e) => setPath(e.target.value)} aria-label="Project directory path" />
              <button type="button" className="btn" onClick={() => setBrowsing(true)}>
                Browse
              </button>
              <button type="submit" className="btn btn-primary" disabled={!path.trim() || busy !== null}>
                {busy === "local" ? "Opening…" : "Analyze"}
              </button>
            </form>
            {error?.source === "local" ? <p className={styles.error}>{error.message}</p> : null}
          </div>

          <div className={styles.source}>
            <h2 className={styles.sourceTitle}>
              <FolderGit2 size={16} strokeWidth={1.75} aria-hidden="true" /> Public Git repository
            </h2>
            <p className={styles.sourceText}>A shallow clone over HTTPS into the local data folder. Hooks, submodules and LFS files are not fetched.</p>
            <form
              className={styles.row}
              onSubmit={(e) => {
                e.preventDefault();
                void analyze("git");
              }}
            >
              <input className="input mono" placeholder="https://github.com/owner/repo" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} aria-label="Repository URL" />
              <button type="submit" className="btn btn-primary" disabled={!gitUrl.trim() || busy !== null}>
                {busy === "git" ? "Cloning…" : "Clone and analyze"}
              </button>
            </form>
            {error?.source === "git" ? <p className={styles.error}>{error.message}</p> : null}
          </div>

          <div className={styles.source}>
            <h2 className={styles.sourceTitle}>
              <Play size={16} strokeWidth={1.75} aria-hidden="true" /> Sample project
            </h2>
            <p className={styles.sourceText}>Inkwell, a small Next.js document editor bundled with the tool, with pages, hooks, context, API routes and database access.</p>
            <div className={styles.row}>
              <button type="button" className="btn" onClick={() => void analyze("sample")} disabled={busy !== null}>
                {busy === "sample" ? "Starting…" : "Analyze the sample"}
              </button>
            </div>
            {error?.source === "sample" ? <p className={styles.error}>{error.message}</p> : null}
          </div>
        </section>

        <section className={styles.recent}>
          <h2 className={styles.recentTitle}>Projects</h2>
          {loadError ? <p className={styles.error}>Could not load saved projects: {loadError}</p> : null}
          {projects === null && !loadError ? <p className={styles.sourceText}>Loading…</p> : null}
          {projects?.length === 0 ? <p className={styles.sourceText}>Analyzed projects will be listed here.</p> : null}
          {projects?.length ? (
            <ul className={styles.projectList}>
              {projects.map((p) => (
                <li key={p.id} className={styles.project}>
                  <button type="button" className={styles.projectMain} onClick={() => void openLatest(p)}>
                    <span className={styles.projectName}>{p.name}</span>
                    <span className={styles.projectPath}>{p.source === "git" ? p.sourceUrl : p.root}</span>
                  </button>
                  <span className={styles.projectStatus} data-status={p.latest?.status}>
                    {p.latest ? `${p.latest.status === "completed" ? "Analyzed" : p.latest.status === "running" ? "Analyzing" : p.latest.status === "failed" ? "Failed" : "Cancelled"} ${relativeTime(p.latest.startedAt)}` : "Not analyzed"}
                  </span>
                  <span className={styles.projectStats}>{p.latest?.stats ? `${p.latest.stats.filesAnalyzed} files` : ""}</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const { analysis } = await api.startAnalysis(p.id);
                      router.push(`/workspace/${analysis.id}`);
                    }}
                  >
                    Analyze again
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => void remove(p)} aria-label={`Remove ${p.name}`} title="Remove from Interface Archaeology">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </main>

      {browsing ? (
        <DirectoryBrowser
          initial={path}
          onClose={() => setBrowsing(false)}
          onPick={(p) => {
            setPath(p);
            setBrowsing(false);
          }}
        />
      ) : null}
    </div>
  );
}

function DirectoryBrowser({ initial, onClose, onPick }: { initial: string; onClose: () => void; onPick: (path: string) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((p?: string) => {
    api
      .listDirectory(p)
      .then((l) => {
        setError(null);
        setListing(l);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    open(initial || undefined);
  }, [open, initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Choose a project directory">
        <div className={styles.dialogHead}>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => listing?.parent && open(listing.parent)} disabled={!listing?.parent} aria-label="Parent directory">
            <CornerLeftUp size={14} />
          </button>
          <span className={styles.dialogPath}>{listing?.path ?? "…"}</span>
          {listing?.looksLikeProject ? <span className={styles.badge}>package.json found</span> : null}
        </div>
        <div className={styles.dirList}>
          {error ? <p className={styles.error}>{error}</p> : null}
          {listing?.directories.length === 0 ? <p className={styles.sourceText}>No subdirectories.</p> : null}
          {listing?.directories.map((d) => (
            <button key={d} type="button" className={styles.dir} onDoubleClick={() => open(`${listing.path}${listing.path.endsWith(listing.separator) ? "" : listing.separator}${d}`)} onClick={() => open(`${listing.path}${listing.path.endsWith(listing.separator) ? "" : listing.separator}${d}`)}>
              <FolderOpen size={13} aria-hidden="true" /> {d}
            </button>
          ))}
        </div>
        <div className={styles.dialogFoot}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => listing && open(listing.home)}>
            <ChevronLeft size={13} /> Home folder
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
