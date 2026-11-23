# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-23

First working release.

### Added

- Static analysis engine for TypeScript/JavaScript (TSX/JSX) with React and Next.js awareness: components, hooks, state, context, providers, event handlers, prop callbacks, lazy loading, error boundaries, App and Pages Router conventions, route handlers, server actions, middleware and proxy, and the `"use client"` boundary.
- Network request detection (fetch, axios, axios instances with `baseURL`) matched to route handlers; Prisma and literal-SQL data access.
- Evidence and confidence (`detected` / `inferred`) on every relationship.
- Data-flow tracing with member-level precision and explicit gaps; impact analysis by reverse traversal; file-level dependency metrics (cycles, depth, hubs, isolated modules).
- Web workspace: architecture map, inspector with source viewer, component explorer, flow tracer, API explorer, dependency explorer, impact analysis, analysis history with comparison, project settings, and a Ctrl+K command palette.
- Local and Git project import with safety limits; SQLite persistence; content-hash extraction cache; change detection.
- Exports: Markdown report, Mermaid, SVG, JSON. CLI: `npm run analyze`.
- Inkwell sample project, unit, integration and end-to-end tests, and CI.
