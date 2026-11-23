# Contributing

Thanks for helping make unfamiliar codebases easier to understand.

## Setup

```bash
npm install
npm run dev        # http://127.0.0.1:4310
npm test           # Vitest: unit + integration
npm run build && npm run test:e2e   # Playwright (first time: npx playwright install chromium)
```

Node.js 22.13+ is required.

## Where things live

- `src/analyzer`: the engine. Pure Node.js. Relative imports use `.ts` extensions; keep to erasable TypeScript syntax (no enums, namespaces or parameter properties) so `npm run analyze` keeps working without a build step.
- `src/server`: storage, jobs, project import.
- `src/app`, `src/components`: the Next.js app. Styling uses the tokens in `src/styles/tokens.css`; avoid hard-coded colours and spacing.
- `fixtures/inkwell`: the sample project and integration fixture. It is analyzed, never built.

[ARCHITECTURE.md](ARCHITECTURE.md) explains how the pieces fit.

## Ground rules for analysis changes

1. **Never present a guess as a fact.** If a relationship comes from a heuristic, mark the edge `inferred` and say why in its evidence `reason`.
2. **Every edge needs evidence**: the file and line it was read from.
3. **Prefer a reported gap to a wrong answer.** Flow tracing shows where it cannot follow; don't paper over it.
4. **Treat analyzed code as untrusted.** Don't execute it, read outside the project root, follow symlinks or read environment files.
5. **Add a fixture.** New detectors need code in `fixtures/` (extend Inkwell or add a fixture project) and assertions in `tests/integration` that check the exact relationships the new code produces. Tests that only check that something renders are not enough.

## Adding a detector

Most detectors are two small changes:

1. Record the raw fact during extraction (`src/analyzer/extract/`) on the `RawSymbol`. Example: a new HTTP client goes in `detectNetwork`.
2. Turn it into nodes and edges in `GraphBuilder` (`src/analyzer/graph/build.ts`).

Bump `ANALYZER_VERSION` in `src/analyzer/types.ts` when extraction output changes, so cached extractions are invalidated.

## Pull requests

- Keep changes focused; one feature or fix per PR.
- Run `npm run typecheck`, `npm run lint` and `npm test` before pushing; CI runs these plus the build and end-to-end tests.
- Update `CHANGELOG.md` under *Unreleased*.
- UI changes: include a screenshot.

## Reporting bugs

Use the bug report template. For analysis bugs, the most useful report includes a minimal code sample, what the analyzer showed, and what you expected.
