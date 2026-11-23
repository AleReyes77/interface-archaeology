import { describe, expect, it } from "vitest";
import { computeDependencyMetrics, tarjan } from "@/analyzer/graph/deps";
import { findSecrets, redactSecrets, redactUrl } from "@/analyzer/redact";
import { resolveInside } from "@/analyzer/discover";
import { highlight } from "@/server/highlight";
import { buildSearchItems, scoreItem, search } from "@/components/palette/search";
import type { AnalysisResult, FileEdge } from "@/analyzer/types";
import path from "node:path";

const edge = (from: string, to: string, kind: FileEdge["kind"] = "static"): FileEdge => ({ from, to, kind, line: 1 });

describe("dependency metrics", () => {
  it("finds cycles with Tarjan's algorithm and ignores type-only imports", () => {
    const files = ["a", "b", "c", "d", "e"];
    const m = computeDependencyMetrics(files, [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "d"), edge("d", "e", "type"), edge("e", "d")]);
    expect(m.cycles).toEqual([["a", "b", "c"]]);
    expect(m.depthByFile).toMatchObject({ d: 0, c: 1, a: 1, b: 1, e: 1 });
    expect(m.maxDepth).toBe(1);
    expect(m.isolated).toEqual([]);
  });

  it("reports isolated modules and hubs", () => {
    const m = computeDependencyMetrics(["x", "y", "z", "lonely"], [edge("x", "z"), edge("y", "z")]);
    expect(m.isolated).toEqual(["lonely"]);
    expect(m.hubs[0]).toEqual({ file: "z", fanIn: 2, fanOut: 0 });
  });

  it("handles deep chains without recursion limits", () => {
    const n = 20000;
    const nodes = Array.from({ length: n }, (_, i) => `f${i}`);
    const out = new Map(nodes.map((id, i) => [id, new Set(i + 1 < n ? [`f${i + 1}`] : [])]));
    expect(tarjan(nodes, out)).toHaveLength(n);
  });
});

describe("secrets and path safety", () => {
  it("detects and redacts credential-like values", () => {
    const src = `const key = "AKIAABCDEFGHIJKLMNOP";\nconst apiKey = "s3cr3t-value-123";\nconst ok = "hello";`;
    expect(findSecrets(src).map((s) => s.line)).toEqual([1, 2]);
    const red = redactSecrets(src);
    expect(red).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(red).not.toContain("s3cr3t-value-123");
    expect(red).toContain('"hello"');
  });

  it("redacts sensitive query parameters in URLs", () => {
    expect(redactUrl("/api/x?token=abc123&page=2")).toBe("/api/x?token=[redacted]&page=2");
    expect(redactUrl("postgres://user:pass@host/db")).toContain("[redacted]");
  });

  it("refuses paths that escape the project root", () => {
    const root = path.resolve("/projects/app");
    expect(resolveInside(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"));
    expect(resolveInside(root, "../other/secret.ts")).toBeNull();
    expect(resolveInside(root, path.resolve("/etc/passwd"))).toBeNull();
  });
});

describe("syntax highlighting", () => {
  it("tokenises TSX including template literals and comments, preserving text", () => {
    const code = "// note\nconst a = `x${b}y`;\nexport function Hi() { return <p>{a}</p>; }";
    const lines = highlight(code, "tsx");
    expect(lines.map((l) => l.map(([, t]) => t).join(""))).toEqual(code.split("\n"));
    expect(lines[0]![0]).toEqual(["com", "// note"]);
    expect(lines[1]!.some(([c, t]) => c === "str" && t.startsWith("`x"))).toBe(true);
    expect(lines[2]!.some(([c, t]) => c === "fn" && t === "Hi")).toBe(true);
  });
});

describe("command palette search", () => {
  const result = {
    nodes: [
      { id: "sym:a#SaveButton", kind: "component", name: "SaveButton", file: "src/SaveButton.tsx", line: 1, flags: [] },
      { id: "sym:b#useSaveDocument", kind: "hook", name: "useSaveDocument", file: "src/hooks/useSaveDocument.ts", line: 1, flags: [] },
      { id: "sym:c#Sidebar", kind: "component", name: "Sidebar", file: "src/Sidebar.tsx", line: 1, flags: [] },
    ],
    routes: [],
    files: [{ path: "src/SaveButton.tsx", symbols: ["sym:a#SaveButton"] }],
  } as unknown as AnalysisResult;
  const items = buildSearchItems(result);

  it("ranks exact and prefix matches above fuzzy ones", () => {
    expect(scoreItem(items[0]!, "savebutton")).toBeGreaterThan(scoreItem(items[1]!, "savebutton"));
    expect(scoreItem(items[1]!, "usd")).toBeGreaterThan(0);
    expect(scoreItem(items[2]!, "zzz")).toBe(0);
  });

  it("groups results by kind and resolves files to their first symbol", () => {
    const groups = search(items, "save");
    expect(groups.map((g) => g.group)).toEqual(expect.arrayContaining(["Components", "Hooks", "Files"]));
    expect(groups.find((g) => g.group === "Files")!.items[0]!.nodeId).toBe("sym:a#SaveButton");
  });
});
