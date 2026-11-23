"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FileCode2, Search, Signpost } from "lucide-react";
import { exportUrl } from "@/lib/api";
import { useAnalysis, useWorkspace } from "@/lib/store";
import { KindDot } from "../KindBadge";
import { navHref, PROJECT_NAV, WORKSPACE_NAV } from "../shell/nav";
import { buildSearchItems, scoreItem, search, type SearchItem } from "./search";
import styles from "./palette.module.css";

interface Command {
  id: string;
  title: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useWorkspace((s) => s.paletteOpen);
  const setOpen = useWorkspace((s) => s.setPaletteOpen);
  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { result, analysisId } = useAnalysis();
  const select = useWorkspace((s) => s.select);
  const hiddenKinds = useWorkspace((s) => s.hiddenKinds);
  const setHiddenKinds = useWorkspace((s) => s.setHiddenKinds);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => buildSearchItems(result), [result]);

  const commands: Command[] = useMemo(
    () => [
      ...[...WORKSPACE_NAV, ...PROJECT_NAV].map((n) => ({ id: `go:${n.id}`, title: `Go to ${n.label.toLowerCase()}`, run: () => router.push(navHref(analysisId, n)) })),
      { id: "export:md", title: "Export architecture report (Markdown)", run: () => (window.location.href = exportUrl(analysisId, "markdown")) },
      { id: "export:svg", title: "Export graph image (SVG)", run: () => (window.location.href = exportUrl(analysisId, "svg", hiddenKinds)) },
      { id: "export:mmd", title: "Export Mermaid diagram", run: () => (window.location.href = exportUrl(analysisId, "mermaid", hiddenKinds)) },
      { id: "export:json", title: "Export full analysis (JSON)", run: () => (window.location.href = exportUrl(analysisId, "json")) },
      { id: "map:all", title: "Show all node kinds in the map", run: () => setHiddenKinds([]) },
    ],
    [analysisId, router, hiddenKinds, setHiddenKinds],
  );

  const groups = useMemo(() => {
    const matched = search(items, query);
    const cmd = commands.filter((c) => scoreItem({ id: c.id, type: "symbol", title: c.title, group: "" }, query) > 0).slice(0, query ? 4 : 6);
    return { matched, cmd };
  }, [items, commands, query]);

  const flat = useMemo(() => [...groups.matched.flatMap((g) => g.items.map((i) => ({ type: "item" as const, item: i }))), ...groups.cmd.map((c) => ({ type: "cmd" as const, cmd: c }))], [groups]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openItem = (item: SearchItem) => {
    onClose();
    if (item.nodeId) {
      select(item.nodeId);
      router.push(`/workspace/${analysisId}/map?node=${encodeURIComponent(item.nodeId)}`);
    } else if (item.file) {
      router.push(`/workspace/${analysisId}/dependencies?file=${encodeURIComponent(item.file)}`);
    }
  };

  const run = (index: number) => {
    const entry = flat[index];
    if (!entry) return;
    if (entry.type === "item") openItem(entry.item);
    else {
      onClose();
      entry.cmd.run();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let index = -1;
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Search the architecture" onKeyDown={onKeyDown}>
        <div className={styles.inputRow}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search components, hooks, files, routes, endpoints or commands"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={flat.length ? `palette-${active}` : undefined}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className={styles.results} id="palette-results" role="listbox" ref={listRef}>
          {flat.length === 0 ? <p className={styles.empty}>Nothing in this analysis matches “{query}”.</p> : null}
          {groups.matched.map((g) => (
            <div key={g.group} className={styles.group} role="group" aria-label={g.group}>
              <p className={styles.groupTitle}>{g.group}</p>
              {g.items.map((item) => {
                index++;
                const i = index;
                return (
                  <div key={item.id} id={`palette-${i}`} role="option" aria-selected={active === i} data-index={i} className={styles.option} onMouseMove={() => setActive(i)} onClick={() => run(i)}>
                    <span className={styles.optionIcon}>{item.kind ? <KindDot kind={item.kind} /> : item.type === "route" ? <Signpost size={13} /> : <FileCode2 size={13} />}</span>
                    <span className={styles.optionTitle}>{item.title}</span>
                    <span className={styles.optionSub}>{item.subtitle}</span>
                    {active === i ? <CornerDownLeft size={12} className={styles.enter} /> : null}
                  </div>
                );
              })}
            </div>
          ))}
          {groups.cmd.length ? (
            <div className={styles.group} role="group" aria-label="Commands">
              <p className={styles.groupTitle}>Commands</p>
              {groups.cmd.map((c) => {
                index++;
                const i = index;
                return (
                  <div key={c.id} id={`palette-${i}`} role="option" aria-selected={active === i} data-index={i} className={styles.option} onMouseMove={() => setActive(i)} onClick={() => run(i)}>
                    <span className={styles.optionIcon} />
                    <span className={styles.optionTitle} data-plain>
                      {c.title}
                    </span>
                    {active === i ? <CornerDownLeft size={12} className={styles.enter} /> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className={styles.footer}>
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> to move
          </span>
          <span>
            <span className="kbd">Enter</span> to open
          </span>
          <span className={styles.footerCount}>{items.length.toLocaleString("en")} indexed items</span>
        </div>
      </div>
    </div>
  );
}
