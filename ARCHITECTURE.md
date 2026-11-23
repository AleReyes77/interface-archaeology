# Architecture

Interface Archaeology has three layers with one-way dependencies:

```
src/analyzer   pure analysis engine (Node.js, no web framework)
     ▲
src/server     storage, jobs, project import, highlighting (Node.js)
     ▲
src/app        Next.js application: API routes, workspace UI, landing page
src/components UI components used by src/app
```

The analyzer never imports from `server` or `app`. Its relative imports use explicit `.ts` extensions and only erasable TypeScript syntax, so it runs directly on Node (`npm run analyze`) without a build step, and is bundled unchanged by Next.js.

## Analyzer (`src/analyzer`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | The data model: nodes, edges with evidence and confidence, files, routes, network calls, diagnostics, stages. Plain JSON. |
| `discover.ts` | Safe directory walk: no symlinks, ignored directories, file-count and size limits, `.env*` skipped, `resolveInside` path guard. |
| `framework.ts` | Reads `package.json` and `tsconfig/jsconfig` (via `ts.parseConfigFileTextToJson`, so comments are allowed) and detects Next.js / React, the router in use, and path aliases. |
| `extract/file.ts` | Per-file extraction with the TypeScript compiler API (`createSourceFile`, syntax only). Produces a `FileExtraction`: imports, exports, symbols and the raw references each symbol makes. |
| `extract/network.ts` | Detection of `fetch`/axios requests (method, URL pattern, body, response handling) and Prisma/SQL data access. |
| `resolve.ts` | Bundler-style module resolution over the set of discovered files: relative, aliases, `baseUrl`, extensions, index files, `.js` → `.ts`. |
| `graph/build.ts` | Cross-file resolution and graph construction (see below). |
| `graph/routes.ts` | Next.js routing conventions and URL ↔ route matching. |
| `graph/deps.ts` | File-level metrics: iterative Tarjan SCC (cycles), condensed-DAG depth, hubs, isolated modules. |
| `queries/*` | Isomorphic queries used by both server and browser: adjacency index, flow tracing, impact analysis. |
| `layout.ts` | Layered layout via dagre, shared by the interactive map and the SVG exporter. |
| `export/*` | Markdown report, Mermaid flowchart, standalone SVG. |
| `pipeline.ts` | Orchestrates the stages, reports measured progress, supports cancellation (`AbortSignal`) and a pluggable extraction cache. |

### Extraction is per file, resolution is global

Extraction only uses one file's syntax tree, so its output is cacheable by `(analyzer version, path, content hash)`. It records references by the name written in the source, for example "renders `<SaveButton>` at line 39", or "the `onClick` handler calls `save`, which came from `useSaveDocument()`".

`GraphBuilder` then resolves names through each file's import bindings, following re-exports, `export *`, namespace imports, `next/dynamic`/`React.lazy` aliases and default exports. It creates:

- **Symbol nodes**, classified with a recorded reason (`kindReason`). Framework conventions come first (App/Pages Router files, route handlers, middleware, `"use server"`), then React semantics (hooks by name, JSX-returning PascalCase functions, class components, context providers), then I/O (services perform network or data access).
- **Endpoint nodes** for each distinct `METHOD url` pattern, **data-store nodes** for Prisma models and SQL tables, **package nodes** for external modules referenced by symbols (framework packages are excluded to keep the graph readable; they remain in file-level dependencies), and **event nodes** for each JSX event handler.
- **Edges** with one or more pieces of evidence (`file`, `line`, `reason`) and a confidence:
  - `detected`: read directly from syntax (an import, a JSX element, a call).
  - `inferred`: established by a heuristic. There are three: URL pattern matching between a request and a route handler (`handled-by`); event effects followed through a prop callback to the parent that bound it; HTTP clients recognised by name when their definition cannot be resolved.
- **Members.** Calls into object or class services carry the member used (`label`) and the member the call originates from (`sourceMember`). The flow tracer uses this to follow `DocumentService.update` without wandering into `DocumentService.list`.

### Client/server boundary

For App Router projects, every module statically reachable from a `"use client"` module (through non-type imports) is marked client-side, with the import chain as the reason; other components are server components. `"use server"` modules stop the propagation.

### Queries

- **Flow tracing** walks `triggers`, `calls`, `uses-hook`, `requests`, `handled-by` and `queries` edges forward from an entry point, restricting service nodes to the member entered and stopping on cycles. Gaps (dynamic URLs, unmatched endpoints, unresolved handlers) are recorded on the step where they occur.
- **Impact analysis** is a breadth-first reverse traversal over all behavioural and structural edges. It keeps the shortest path to each dependent (for the explanation) and marks the path inferred if any edge on it is.

## Server (`src/server`)

- `storage.ts`: a `Storage` interface and a `SqliteStorage` implementation on Node's built-in `node:sqlite`, so there is no native module to compile. Tables: `projects`, `analyses` (summary columns + result JSON), `extraction_cache`. Schema versioning uses `PRAGMA user_version`. Runs that were in progress when the server stopped are marked failed on startup.
- `jobs.ts`: in-process job runner. Analyses run asynchronously and yield to the event loop between files, so progress polling and cancellation stay responsive. One running analysis per project.
- `projects.ts`: local path validation, sample registration, shallow Git clone with hardened options, and change detection (content hashes on disk compared with those recorded in an analysis).
- `highlight.ts`: syntax highlighting with the TypeScript scanner (no extra dependency), including template literals and regex re-scanning.

Why not worker threads? Parsing is CPU-bound but chunked per file with `setImmediate` yields, which keeps the server responsive for the project sizes this release targets, without the bundling complexity of workers inside Next.js. Moving `analyzeProject` into a worker is on the roadmap; the pipeline is already isolated behind a single async function with an `AbortSignal`.

## Web application (`src/app`, `src/components`)

- **API routes** (`src/app/api`) are thin: validation, then calls into `server/*`. `src/proxy.ts` (the Next.js 16 request proxy) restricts `/api` to localhost hosts and same-origin writes.
- **Workspace** (`/workspace/[analysisId]/*`): a client-side layout loads the stored `AnalysisResult` once into a Zustand store with a prebuilt adjacency index; every view (map, components, flows, dependencies, API, impact, history, settings) is a pure function of that data plus URL parameters such as `?node=`, `?start=` and `?file=`, which keeps deep links shareable.
- **Map**: React Flow (`@xyflow/react`) renders custom nodes; edges are drawn through the points computed by dagre, so routing stays consistent with the layout. Nodes are not draggable, by design, so the layout remains the source of truth. Large graphs use `onlyRenderVisibleElements`.
- **Design system**: CSS custom properties in `src/styles/tokens.css` (colour, type, spacing, radius, elevation, focus, motion, z-index) consumed by CSS Modules. Node-kind colours are mirrored in `analyzer/presentation.ts` so exported SVGs match the interface.
- **Landing page** (`/`) is statically generated. At build time it runs the analyzer on the sample project and renders the real flow trace and SVG export.

## Decisions

| Decision | Alternatives considered | Reason |
| --- | --- | --- |
| TypeScript compiler API (`typescript@6`) for parsing | Babel, SWC, tree-sitter | One dependency parses TS/TSX/JS/JSX with exact positions and also provides the tokenizer for highlighting. TypeScript 7 (native) only exposes an unstable API today. |
| Own module resolver | `ts.resolveModuleName` with a Program | Resolution over the discovered file set cannot touch the file system or escape the project root, and needs no Program. |
| dagre (layered layout) | ELK, force-directed | Architecture graphs are mostly DAG-shaped (pages → components → hooks → services → network → data). Layered layout keeps direction readable; dagre is small and synchronous. ELK is a candidate for larger graphs. |
| `node:sqlite` | better-sqlite3, JSON files | No native compilation on any OS, transactional, single file. |
| CSS Modules + tokens | Tailwind, component kits | Full control over a small, specific visual language without a utility-class build step. |
| Zustand | Redux, context | Minimal store for one loaded analysis and UI state. |
