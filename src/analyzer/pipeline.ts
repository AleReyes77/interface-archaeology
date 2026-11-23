/**
 * The analysis pipeline: discover → detect → parse → resolve → graph → metrics.
 *
 * Pure Node.js; no dependency on the web application. Progress callbacks
 * report measured work (stage index, files parsed), never estimates.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_LIMITS, discoverFiles, looksBinary } from "./discover.ts";
import { detectFramework, readPackageManifest, readResolutionConfig } from "./framework.ts";
import { extractFile, hashContent } from "./extract/file.ts";
import type { FileExtraction } from "./extract/types.ts";
import { ModuleResolver } from "./resolve.ts";
import { buildGraph } from "./graph/build.ts";
import { computeDependencyMetrics } from "./graph/deps.ts";
import { findSecrets } from "./redact.ts";
import {
  ANALYSIS_STAGES,
  ANALYZER_VERSION,
  type AnalysisLimits,
  type AnalysisProgress,
  type AnalysisResult,
  type AnalysisStage,
  type Diagnostic,
  type NodeKind,
} from "./types.ts";

/** Cache of per-file extraction results keyed by content hash. */
export interface ExtractionCache {
  get(key: string): FileExtraction | undefined;
  set(key: string, value: FileExtraction): void;
}

export interface AnalyzeOptions {
  limits?: Partial<AnalysisLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
  cache?: ExtractionCache;
  /** Display name; defaults to package.json name or the directory name. */
  name?: string;
}

export function cacheKey(filePath: string, hash: string): string {
  return `${ANALYZER_VERSION}:${filePath}:${hash}`;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function analyzeProject(rootInput: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const started = Date.now();
  const limits: AnalysisLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const { signal, onProgress, cache } = options;
  const stageIndex = (id: AnalysisStage) => ANALYSIS_STAGES.findIndex((s) => s.id === id);
  const report = (stage: AnalysisStage, extra: Partial<AnalysisProgress> = {}) =>
    onProgress?.({ stage, stageIndex: stageIndex(stage), stageCount: ANALYSIS_STAGES.length, ...extra });

  // 1. Discover
  report("discover");
  const discovery = await discoverFiles(rootInput, limits, signal);
  const diagnostics: Diagnostic[] = [...discovery.diagnostics];
  const root = discovery.root;

  // 2. Detect
  signal?.throwIfAborted();
  report("detect");
  const manifest = await readPackageManifest(root);
  const framework = detectFramework(manifest, discovery.files, discovery.configFiles);
  const resolution = await readResolutionConfig(root, discovery.configFiles);

  // 3. Parse
  const extractions: FileExtraction[] = [];
  let fromCache = 0;
  let skippedBinary = 0;
  const total = discovery.files.length;
  report("parse", { processed: 0, total });
  for (let i = 0; i < discovery.files.length; i++) {
    signal?.throwIfAborted();
    const file = discovery.files[i]!;
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(file.absolutePath);
    } catch (error) {
      diagnostics.push({ code: "read-error", severity: "warning", message: (error as Error).message, file: file.path });
      continue;
    }
    if (looksBinary(buffer)) {
      diagnostics.push({ code: "binary-skipped", severity: "info", message: "Binary content in a source file extension; skipped", file: file.path });
      skippedBinary++;
      continue;
    }
    const text = buffer.toString("utf8");
    const hash = hashContent(text);
    const key = cacheKey(file.path, hash);
    let extraction = cache?.get(key);
    if (extraction) fromCache++;
    else {
      try {
        extraction = extractFile({ path: file.path, language: file.language, text, bytes: file.bytes });
      } catch (error) {
        diagnostics.push({ code: "parse-error", severity: "error", message: `Analyzer failed on this file: ${(error as Error).message}`, file: file.path });
        continue;
      }
      cache?.set(key, extraction);
    }
    diagnostics.push(...extraction.diagnostics);
    for (const secret of findSecrets(text)) {
      diagnostics.push({ code: "possible-secret", severity: "warning", message: `Possible ${secret.kind}; value is redacted in all output`, file: file.path, line: secret.line });
    }
    extractions.push(extraction);
    if (i % 25 === 0 || i === total - 1) {
      report("parse", { processed: i + 1, total });
      await yieldToEventLoop();
    }
  }

  // 4. Resolve (performed inside the graph builder; reported separately for transparency)
  signal?.throwIfAborted();
  report("resolve", { total: extractions.length });
  const resolver = new ModuleResolver(
    extractions.map((e) => e.path),
    resolution,
  );

  // 5. Graph
  await yieldToEventLoop();
  signal?.throwIfAborted();
  report("graph");
  const graph = buildGraph({ extractions, resolver, framework, packageVersions: manifest?.dependencies ?? {} });
  diagnostics.push(...graph.diagnostics);

  // 6. Metrics
  await yieldToEventLoop();
  signal?.throwIfAborted();
  report("metrics");
  const dependencies = computeDependencyMetrics(graph.files.map((f) => f.path), graph.fileEdges);

  const nodesByKind: Partial<Record<NodeKind, number>> = {};
  for (const n of graph.nodes) nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;

  return {
    analyzerVersion: ANALYZER_VERSION,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    project: { name: options.name ?? manifest?.name ?? path.basename(root), root },
    framework,
    limits,
    files: graph.files,
    fileEdges: graph.fileEdges,
    nodes: graph.nodes,
    edges: graph.edges,
    routes: graph.routes,
    network: graph.network,
    dependencies,
    diagnostics,
    stats: {
      filesDiscovered: discovery.files.length,
      filesAnalyzed: extractions.length,
      filesFromCache: fromCache,
      filesSkipped: discovery.skipped + skippedBinary,
      totalLoc: graph.files.reduce((sum, f) => sum + f.loc, 0),
      nodesByKind,
      edges: graph.edges.length,
      networkCalls: graph.network.length,
    },
  };
}
