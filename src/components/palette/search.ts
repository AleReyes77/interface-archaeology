/**
 * Search over an analysis result: symbols, files, routes and endpoints.
 * Scoring prefers exact and prefix matches on names, then word-boundary
 * matches, then fuzzy subsequence matches, then path matches.
 */
import { KIND_META } from "@/analyzer/presentation";
import type { AnalysisResult, NodeKind } from "@/analyzer/types";

export type SearchItemType = "symbol" | "file" | "route";

export interface SearchItem {
  id: string;
  type: SearchItemType;
  title: string;
  subtitle?: string;
  kind?: NodeKind;
  group: string;
  /** Node to select when opened (files and routes resolve to a node when possible). */
  nodeId?: string;
  file?: string;
}

export function buildSearchItems(result: AnalysisResult): SearchItem[] {
  const items: SearchItem[] = [];
  for (const n of result.nodes) {
    items.push({ id: n.id, type: "symbol", title: n.name, subtitle: n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : n.route, kind: n.kind, group: KIND_META[n.kind].plural, nodeId: n.id, file: n.file });
  }
  for (const r of result.routes) {
    items.push({ id: `route:${r.file}`, type: "route", title: r.path, subtitle: `${r.kind} in ${r.file}`, group: "Routes", nodeId: r.nodeId ?? undefined, file: r.file });
  }
  for (const f of result.files) {
    items.push({ id: `file:${f.path}`, type: "file", title: f.path.split("/").pop()!, subtitle: f.path, group: "Files", nodeId: f.symbols[0], file: f.path });
  }
  return items;
}

function subsequence(query: string, text: string): number {
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      score += i === last + 1 ? 3 : 1;
      if (i === 0 || /[\s/._\-[(A-Z]/.test(text[i - 1]!)) score += 2;
      last = i;
      qi++;
    }
  }
  return qi === query.length ? score : 0;
}

export function scoreItem(item: SearchItem, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 1;
  const title = item.title.toLowerCase();
  const sub = (item.subtitle ?? "").toLowerCase();
  if (title === q) return 1000;
  if (title.startsWith(q)) return 800 - title.length;
  const wordIndex = title.search(new RegExp(`(^|[\\s/._\\-])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (wordIndex >= 0) return 600 - wordIndex;
  if (title.includes(q)) return 500 - title.indexOf(q);
  const fuzzy = subsequence(q, title);
  if (fuzzy) return 200 + fuzzy;
  if (sub.includes(q)) return 100;
  return 0;
}

const GROUP_ORDER = ["Pages", "Layouts", "Components", "Providers", "Hooks", "Contexts", "Services", "Server actions", "Route handlers", "Endpoints", "Routes", "Events", "Utilities", "Data stores", "Middleware", "Route segments", "Packages", "Files"];

export function search(items: SearchItem[], query: string, perGroup = 6): { group: string; items: SearchItem[] }[] {
  const scored = items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  const groups = new Map<string, SearchItem[]>();
  for (const { item } of scored) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    const list = groups.get(item.group)!;
    if (list.length < perGroup) list.push(item);
  }
  const order = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  // With a query, the group of the best match comes first; without one, a stable order.
  const best = new Map<string, number>();
  scored.forEach(({ item, score }) => best.set(item.group, Math.max(best.get(item.group) ?? 0, score)));
  return [...groups]
    .sort(([a], [b]) => (query.trim() ? (best.get(b) ?? 0) - (best.get(a) ?? 0) || order(a) - order(b) : order(a) - order(b)))
    .map(([group, list]) => ({ group, items: list }));
}
