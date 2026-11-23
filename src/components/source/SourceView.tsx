"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import { api, type SourceFile } from "@/lib/api";
import styles from "./source.module.css";

interface SourceViewProps {
  analysisId: string;
  file: string;
  /** First and last line to highlight and scroll to. */
  line?: number;
  endLine?: number;
  /** Identifier to emphasise inside the highlighted range. */
  symbol?: string;
  compact?: boolean;
}

export function SourceView({ analysisId, file, line, endLine, symbol, compact }: SourceViewProps) {
  // Loaded state is keyed by file so a stale file is never shown while the next one loads.
  const key = `${analysisId}:${file}`;
  const [loaded, setLoaded] = useState<{ key: string; source: SourceFile | null; error: string | null }>({ key: "", source: null, error: null });
  const source = loaded.key === key ? loaded.source : null;
  const error = loaded.key === key ? loaded.error : null;
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSource(analysisId, file)
      .then((s) => !cancelled && setLoaded({ key, source: s, error: null }))
      .catch((e: Error) => !cancelled && setLoaded({ key, source: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [analysisId, file, key]);

  const plainLines = useMemo(() => source?.lines.map((l) => l.map(([, t]) => t).join("")) ?? [], [source]);
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return plainLines.flatMap((text, i) => (text.toLowerCase().includes(q) ? [i + 1] : []));
  }, [plainLines, query]);

  const scrollToLine = (n: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-line="${n}"]`);
    if (el && bodyRef.current) bodyRef.current.scrollTop = el.offsetTop - bodyRef.current.clientHeight / 3;
  };

  useEffect(() => {
    if (source && line) requestAnimationFrame(() => scrollToLine(line));
  }, [source, line]);

  useEffect(() => {
    const target = matches[matchIndex];
    if (target) scrollToLine(target);
  }, [matches, matchIndex]);

  const copy = async () => {
    await navigator.clipboard.writeText(plainLines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const step = (delta: number) => {
    if (!matches.length) return;
    setMatchIndex((i) => (i + delta + matches.length) % matches.length);
  };

  const editorHref = source ? `vscode://file/${source.absolutePath.replace(/\\/g, "/")}${line ? `:${line}` : ""}` : undefined;
  const matchSet = new Set(matches);
  const redacted = new Set(source?.redactedLines ?? []);
  const q = query.trim().toLowerCase();

  return (
    <div className={styles.viewer} data-compact={compact || undefined}>
      <div className={styles.toolbar}>
        <span className={styles.file} title={file}>
          {file}
          {source ? <span className={styles.lang}>{source.language.toUpperCase()}</span> : null}
        </span>
        <div className={styles.find}>
          <input
            className={`input ${styles.findInput}`}
            placeholder="Find in file"
            value={query}
            aria-label="Find in file"
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
            }}
          />
          {q ? <span className={styles.count}>{matches.length ? `${matchIndex + 1}/${matches.length}` : "0"}</span> : null}
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => step(-1)} disabled={!matches.length} aria-label="Previous match">
            <ArrowUp size={13} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => step(1)} disabled={!matches.length} aria-label="Next match">
            <ArrowDown size={13} />
          </button>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={copy} disabled={!source} aria-label="Copy file contents" title="Copy file contents (secrets stay redacted)">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {editorHref ? (
          <a className="btn btn-ghost btn-icon" href={editorHref} aria-label="Open in VS Code" title="Open in VS Code (requires VS Code to be installed)">
            <ExternalLink size={13} />
          </a>
        ) : null}
      </div>
      {source?.changedSinceAnalysis ? (
        <p className={styles.notice}>
          <TriangleAlert size={13} aria-hidden="true" /> This file changed after the analysis ran. Line numbers may no longer match; re-analyze to refresh.
        </p>
      ) : null}
      {source?.redactedLines.length ? (
        <p className={styles.notice}>
          <TriangleAlert size={13} aria-hidden="true" /> Credential-like values on {source.redactedLines.length === 1 ? "line" : "lines"} {source.redactedLines.join(", ")} are redacted.
        </p>
      ) : null}
      <div className={styles.body} ref={bodyRef} tabIndex={0} aria-label={`Source of ${file}`}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!source && !error ? <p className={styles.loading}>Loading source…</p> : null}
        {source ? (
          <pre className={styles.code}>
            {source.lines.map((tokens, i) => {
              const n = i + 1;
              const inRange = line !== undefined && n >= line && n <= (endLine ?? line);
              return (
                <div key={n} data-line={n} className={styles.line} data-range={inRange || undefined} data-match={matchSet.has(n) || undefined} data-current={matches[matchIndex] === n || undefined} data-redacted={redacted.has(n) || undefined}>
                  <span className={styles.gutter}>{n}</span>
                  <span className={styles.text}>
                    {tokens.map(([cls, text], j) => (
                      <span key={j} className={styles[cls]} data-symbol={inRange && symbol && text === symbol ? "" : undefined}>
                        {text}
                      </span>
                    ))}
                    {tokens.length === 0 ? " " : null}
                  </span>
                </div>
              );
            })}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
