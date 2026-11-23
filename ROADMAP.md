# Roadmap

What exists today is described in the [README](README.md). This file lists what comes next, roughly in order. Items move when someone starts working on them; open an issue to discuss before large changes.

## Next milestone (0.2)

- **Worker-thread analysis.** Move `analyzeProject` into a `worker_threads` worker so very large repositories cannot affect server latency.
- **Incremental re-analysis.** Rebuild the graph from cached extractions after a change is detected, and watch the project directory to keep an analysis fresh.
- **Type-aware resolution (opt-in).** Use a TypeScript Program to resolve calls through typed values, such as functions passed as arguments or services injected through constructors.
- **More data-access patterns.** Drizzle, Kysely, Mongoose and Supabase clients.
- **More request patterns.** TanStack Query and SWR keys linked to their fetchers, `ky`, `ofetch`, and generated OpenAPI clients.
- **Flow tracing from server entry points.** Start traces at route handlers and server actions as well as UI events.

## Later

- React Router, Remix and Vite file conventions.
- Vue and Svelte single-file components (a second extractor implementing the same `FileExtraction` contract).
- GraphQL documents and tRPC procedures as endpoints.
- ELK layout for graphs with thousands of nodes, and graph virtualisation beyond viewport culling.
- Compare two analyses visually, highlighting added and removed relationships on the map.
- An editor integration that opens the map at the symbol under the cursor.
- Monorepo awareness: per-package analysis with cross-package edges.

## Non-goals

- Executing or instrumenting the analyzed application. Interface Archaeology stays a static, read-only tool; runtime tracing would be a separate, opt-in component.
- Scoring code quality. The tool reports measurements and observations, not grades.
