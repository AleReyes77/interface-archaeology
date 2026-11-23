/**
 * End-to-end analysis of the Inkwell fixture. Every relationship asserted here
 * exists in the fixture's source; if the analyzer stops finding one (or starts
 * inventing one) these tests fail.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeProject, type ExtractionCache } from "@/analyzer/pipeline";
import { indexGraph } from "@/analyzer/queries/graph-index";
import { flowPaths, traceFlow } from "@/analyzer/queries/flows";
import { computeImpact } from "@/analyzer/queries/impact";
import { toMarkdown } from "@/analyzer/export/markdown";
import { toMermaid } from "@/analyzer/export/mermaid";
import { toSvg } from "@/analyzer/export/svg";
import type { AnalysisResult, EdgeKind } from "@/analyzer/types";

const ROOT = path.join(process.cwd(), "fixtures", "inkwell");
const id = (file: string, name: string) => `sym:src/${file}#${name}`;

let result: AnalysisResult;
let index: ReturnType<typeof indexGraph>;

function edge(source: string, target: string, kind: EdgeKind) {
  return result.edges.find((e) => e.source === source && e.target === target && e.kind === kind);
}

beforeAll(async () => {
  result = await analyzeProject(ROOT);
  index = indexGraph(result);
});

describe("discovery and detection", () => {
  it("detects Next.js with the App Router from package.json and file conventions", () => {
    expect(result.framework).toMatchObject({ name: "nextjs", version: "15.1.4", router: { app: true, pages: false }, language: "typescript" });
    expect(result.project.name).toBe("inkwell");
  });

  it("analyzes source files only, and never reads .env files", () => {
    expect(result.stats.filesAnalyzed).toBe(37);
    expect(result.files.some((f) => f.path.endsWith("logo.png"))).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "env-file-skipped", file: ".env.local" }));
    expect(JSON.stringify(result)).not.toContain("never-read-by-the-analyzer");
  });

  it("resolves tsconfig path aliases (with comments in tsconfig.json)", () => {
    const editor = result.files.find((f) => f.path === "src/components/editor/DocumentEditor.tsx")!;
    expect(editor.imports.find((i) => i.specifier === "@/hooks/useDocument")!.resolved).toBe("src/hooks/useDocument.ts");
    expect(result.diagnostics.filter((d) => d.code === "unresolved-import")).toEqual([]);
  });
});

describe("classification", () => {
  it.each([
    ["app/layout.tsx", "RootLayout", "layout"],
    ["app/page.tsx", "HomePage", "page"],
    ["app/documents/[id]/loading.tsx", "Loading", "route-segment"],
    ["components/editor/SaveButton.tsx", "SaveButton", "component"],
    ["components/ErrorBoundary.tsx", "ErrorBoundary", "component"],
    ["context/SessionContext.tsx", "SessionContext", "context"],
    ["context/SessionContext.tsx", "SessionProvider", "provider"],
    ["hooks/useSaveDocument.ts", "useSaveDocument", "hook"],
    ["lib/documents-api.ts", "documentsApi", "service"],
    ["lib/api-client.ts", "http", "service"],
    ["server/document-service.ts", "DocumentService", "service"],
    ["lib/format.ts", "formatDate", "utility"],
    ["app/actions.ts", "archiveDocument", "server-action"],
    ["app/api/documents/[id]/route.ts", "PUT", "route-handler"],
    ["middleware.ts", "middleware", "middleware"],
  ])("%s#%s is a %s", (file, name, kind) => {
    expect(index.nodes.get(id(file, name))?.kind).toBe(kind);
  });

  it("marks error boundaries and the client/server rendering boundary", () => {
    expect(index.nodes.get(id("components/ErrorBoundary.tsx", "ErrorBoundary"))!.flags).toContain("error-boundary");
    expect(index.nodes.get(id("components/editor/SaveButton.tsx", "SaveButton"))!.renderEnv?.env).toBe("client");
    expect(index.nodes.get(id("components/Sidebar.tsx", "Sidebar"))!.renderEnv?.env).toBe("server");
    // CommentItem has no directive but is imported by a client module.
    expect(index.nodes.get(id("components/comments/CommentItem.tsx", "CommentItem"))!.renderEnv).toMatchObject({ env: "client", reason: expect.stringContaining("CommentsPanel") });
  });

  it("lists routes with dynamic segments and route groups", () => {
    expect(result.routes.map((r) => `${r.kind} ${r.path}`)).toEqual(
      expect.arrayContaining(["page /", "page /about", "page /documents/[id]", "loading /documents/[id]", "error /documents/[id]", "route-handler /api/documents/[id]", "layout /"]),
    );
    expect(result.routes.find((r) => r.path === "/about")!.routeGroups).toEqual(["(marketing)"]);
    expect(result.routes.find((r) => r.file.endsWith("api/documents/[id]/route.ts"))!.methods).toEqual(["GET", "PUT"]);
  });
});

describe("relationships", () => {
  it("connects components through JSX, hooks and context", () => {
    expect(edge(id("components/editor/DocumentEditor.tsx", "DocumentEditor"), id("components/editor/SaveButton.tsx", "SaveButton"), "renders")?.confidence).toBe("detected");
    expect(edge(id("components/editor/DocumentEditor.tsx", "DocumentEditor"), id("hooks/useSaveDocument.ts", "useSaveDocument"), "uses-hook")).toBeDefined();
    expect(edge(id("context/SessionContext.tsx", "useSession"), id("context/SessionContext.tsx", "SessionContext"), "consumes-context")).toBeDefined();
    expect(edge(id("context/SessionContext.tsx", "SessionProvider"), id("context/SessionContext.tsx", "SessionContext"), "provides-context")).toBeDefined();
    expect(edge(id("app/layout.tsx", "RootLayout"), id("components/AppShell.tsx", "AppShell"), "renders")).toBeDefined();
  });

  it("follows next/dynamic to the lazily loaded default export", () => {
    const lazy = edge(id("components/editor/DocumentEditor.tsx", "DocumentEditor"), id("components/comments/CommentsPanel.tsx", "CommentsPanel"), "lazy-loads");
    expect(lazy?.evidence[0]!.reason).toContain("../comments/CommentsPanel");
  });

  it("tracks service methods as members on both ends of an edge", () => {
    const call = edge(id("hooks/useSaveDocument.ts", "useSaveDocument"), id("lib/documents-api.ts", "documentsApi"), "calls");
    expect(call?.label).toBe("save");
    const query = result.edges.find((e) => e.source === id("server/document-service.ts", "DocumentService") && e.target === "db:document" && e.sourceMember === "update");
    expect(query).toMatchObject({ kind: "queries", label: "update", confidence: "detected" });
  });

  it("finds network requests and matches them to route handlers by URL", () => {
    const put = result.network.find((n) => n.method === "PUT")!;
    expect(put).toMatchObject({ client: "fetch", url: "/api/documents/:param", callerMember: "save", confidence: "detected" });
    const handled = edge("endpoint:PUT /api/documents/:param", id("app/api/documents/[id]/route.ts", "PUT"), "handled-by");
    expect(handled?.confidence).toBe("inferred");
    // GET on the same URL must not match the PUT handler.
    expect(edge("endpoint:GET /api/documents/:param", id("app/api/documents/[id]/route.ts", "PUT"), "handled-by")).toBeUndefined();
  });

  it("resolves axios instances across files and applies their baseURL", () => {
    const comments = result.network.find((n) => n.callerId === id("lib/comments-api.ts", "postComment"))!;
    expect(comments).toMatchObject({ client: "http-client", method: "POST", url: "/api/documents/:param/comments", confidence: "detected" });
    expect(edge(comments.endpointId!, id("app/api/documents/[id]/comments/route.ts", "POST"), "handled-by")).toBeDefined();
  });

  it("detects SQL tables in literal queries", () => {
    expect(result.edges.filter((e) => e.target === "db:comments").map((e) => e.label).sort()).toEqual(["insert", "select"]);
  });

  it("links events to handlers, including callbacks forwarded through props", () => {
    const save = result.nodes.find((n) => n.kind === "event" && n.file === "src/components/editor/SaveButton.tsx")!;
    expect(save.name).toBe('onClick "Save"');
    expect(save.viaProps).toEqual(["onSave → DocumentEditor.handleSave"]);
    const trigger = edge(save.id, id("hooks/useSaveDocument.ts", "useSaveDocument"), "triggers");
    expect(trigger).toMatchObject({ confidence: "inferred", label: "save" });

    const bold = result.nodes.find((n) => n.kind === "event" && n.name === 'onClick "Bold"')!;
    expect(bold.stateUpdates).toEqual(["DocumentEditor.draft"]);

    const archive = result.nodes.find((n) => n.kind === "event" && n.name === 'action "Archive"')!;
    expect(edge(archive.id, id("app/actions.ts", "archiveDocument"), "triggers")?.confidence).toBe("detected");
  });

  it("never links a node to itself and keeps evidence on every edge", () => {
    for (const e of result.edges) {
      expect(e.source).not.toBe(e.target);
      expect(e.evidence.length).toBeGreaterThan(0);
      expect(index.nodes.has(e.source) && index.nodes.has(e.target)).toBe(true);
    }
  });
});

describe("queries", () => {
  it("traces the Save button down to the database", () => {
    const save = result.nodes.find((n) => n.kind === "event" && n.name === 'onClick "Save"')!;
    const flow = traceFlow(result, save.id, index)!;
    const names = flowPaths(flow).map((p) => p.map((s) => `${index.nodes.get(s.nodeId)!.name}${s.member ? `.${s.member}` : ""}`).join(" > "));
    expect(names).toContain('onClick "Save" > useSaveDocument.save > documentsApi.save > PUT /api/documents/:param > PUT /api/documents/[id] > DocumentService.update > document.update');
    expect(flow.confidence).toBe("inferred");
    expect(flow.reaches.entities).toEqual(["db:document"]);
  });

  it("restricts a trace to the member that was entered", () => {
    const archive = result.nodes.find((n) => n.kind === "event" && n.name === 'action "Archive"')!;
    const flow = traceFlow(result, archive.id, index)!;
    const paths = flowPaths(flow).map((p) => p.map((s) => s.member ?? "").join(","));
    // DocumentService is entered via `archive`, so its other methods' queries are not followed.
    expect(paths).toEqual([",,archive,update"]);
  });

  it("reports gaps instead of inventing behaviour", () => {
    const retry = result.nodes.find((n) => n.kind === "event" && n.name === 'onClick "Try again"')!;
    expect(traceFlow(result, retry.id, index)!.gaps[0]).toContain("could not be resolved statically");
  });

  it("computes potential impact by walking dependents", () => {
    const impact = computeImpact(result, id("server/document-service.ts", "DocumentService"), index)!;
    const names = impact.items.map((i) => index.nodes.get(i.nodeId)!.name);
    expect(names).toEqual(expect.arrayContaining(["PUT /api/documents/[id]", "archiveDocument", "Sidebar", "HomePage", "documentsApi", "useSaveDocument", 'onClick "Save"', "SaveButton"]));
    expect(impact.direct.map((i) => index.nodes.get(i.nodeId)!.name)).not.toContain("SaveButton");
    expect(impact.items.find((i) => index.nodes.get(i.nodeId)!.name === "Sidebar")!.confidence).toBe("detected");
    expect(impact.items.find((i) => index.nodes.get(i.nodeId)!.name === "SaveButton")!.confidence).toBe("inferred");
    expect(impact.importingFiles.map((f) => f.file)).toContain("src/app/actions.ts");
  });
});

describe("exports and caching", () => {
  it("produces Markdown, Mermaid and SVG from the real analysis", () => {
    const md = toMarkdown(result);
    expect(md).toContain("# inkwell — Architecture report");
    expect(md).toContain("| PUT | `/api/documents/:param` | documentsApi.save |");
    expect(md).toContain("## Limitations");
    const mermaid = toMermaid(result);
    expect(mermaid.startsWith("flowchart LR")).toBe(true);
    expect(mermaid).toMatch(/-\.->\|handled by\|/);
    const svg = toSvg(result);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("DocumentService");
  });

  it("reuses cached extractions for unchanged files", async () => {
    const store = new Map();
    const cache: ExtractionCache = { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) };
    const first = await analyzeProject(ROOT, { cache });
    const second = await analyzeProject(ROOT, { cache });
    expect(first.stats.filesFromCache).toBe(0);
    expect(second.stats.filesFromCache).toBe(second.stats.filesAnalyzed);
    expect(second.edges.length).toBe(first.edges.length);
  });

  it("reports measured progress through every stage and supports cancellation", async () => {
    const stages: string[] = [];
    await analyzeProject(ROOT, { onProgress: (p) => stages.push(p.stage) });
    expect([...new Set(stages)]).toEqual(["discover", "detect", "parse", "resolve", "graph", "metrics"]);

    const controller = new AbortController();
    const run = analyzeProject(ROOT, { signal: controller.signal, onProgress: (p) => p.stage === "parse" && controller.abort() });
    await expect(run).rejects.toThrow();
  });
});
