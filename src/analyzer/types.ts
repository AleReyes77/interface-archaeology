/**
 * Core data model of the analysis engine.
 *
 * Everything here is plain, serialisable data: the analyzer produces it, the
 * server persists it as JSON, and the UI consumes it. No functions, no classes.
 */

export const ANALYZER_VERSION = "0.1.0";

/** How a relationship or fact was established. */
export type Confidence =
  /** Read directly from syntax: an import, a JSX element, a call expression. */
  | "detected"
  /** Derived by a heuristic: URL pattern matching, naming conventions, prop forwarding. */
  | "inferred";

export interface Evidence {
  file: string;
  line: number;
  confidence: Confidence;
  /** Human-readable explanation of why this relationship exists. */
  reason: string;
}

export type Language = "ts" | "tsx" | "js" | "jsx";

export type NodeKind =
  | "page"
  | "layout"
  | "route-segment"
  | "component"
  | "provider"
  | "context"
  | "hook"
  | "service"
  | "utility"
  | "route-handler"
  | "server-action"
  | "middleware"
  | "endpoint"
  | "db-entity"
  | "external"
  | "event";

export const NODE_KINDS: readonly NodeKind[] = [
  "page",
  "layout",
  "route-segment",
  "component",
  "provider",
  "context",
  "hook",
  "service",
  "utility",
  "route-handler",
  "server-action",
  "middleware",
  "endpoint",
  "db-entity",
  "external",
  "event",
];

export type EdgeKind =
  /** Component renders another component in its JSX. */
  | "renders"
  /** Symbol invokes a custom hook. */
  | "uses-hook"
  /** Symbol reads a React context (useContext / use). */
  | "consumes-context"
  /** Provider renders `<Context.Provider>`. */
  | "provides-context"
  /** Symbol calls a function / method of another symbol. */
  | "calls"
  /** Event handler belongs to a component. */
  | "handles"
  /** Event triggers a function call. */
  | "triggers"
  /** Code issues a network request to an endpoint. */
  | "requests"
  /** Endpoint is served by a route handler (URL pattern match). */
  | "handled-by"
  /** Code reads or writes a database entity. */
  | "queries"
  /** Code lazy-loads another module (dynamic import / React.lazy / next/dynamic). */
  | "lazy-loads"
  /** Symbol imports an external package. */
  | "uses-package";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** Weakest confidence among the evidence entries. */
  confidence: Confidence;
  evidence: Evidence[];
  /** Member of the target that is used, e.g. `update` for `DocumentService.update()`. */
  label?: string;
  /** Member of the source the relationship originates in (service methods). */
  sourceMember?: string;
}

export interface PropInfo {
  name: string;
  type?: string;
  optional: boolean;
  line: number;
}

export interface StateInfo {
  name: string;
  setter?: string;
  hook: string;
  initial?: string;
  line: number;
}

export interface EventInfo {
  /** Graph id of the event node. */
  id: string;
  event: string;
  element: string;
  label?: string;
  line: number;
  handler: string;
}

export interface NetworkCall {
  id: string;
  file: string;
  line: number;
  /** Graph id of the symbol that issues the call. */
  callerId: string;
  /** Member of the caller (e.g. a service method), when applicable. */
  callerMember?: string;
  client: "fetch" | "axios" | "http-client";
  method: string;
  /** Normalised endpoint, e.g. `/api/documents/:param`, or null when dynamic. */
  url: string | null;
  /** The source expression for the URL, redacted. */
  rawUrl: string;
  urlKind: "literal" | "template" | "dynamic";
  confidence: Confidence;
  /** Graph id of the endpoint node. */
  endpointId: string | null;
  requestBody?: string;
  responseHandling: string[];
}

export interface DbAccess {
  entity: string;
  operation: string;
  client: "prisma" | "sql";
  line: number;
  confidence: Confidence;
}

export interface MemberInfo {
  name: string;
  line: number;
  endLine: number;
  calls: string[];
  network: number;
  db: string[];
}

export interface RouteInfo {
  /** URL pattern, e.g. `/documents/[id]` */
  path: string;
  kind: "page" | "layout" | "route-handler" | "loading" | "error" | "not-found" | "template" | "default" | "api";
  router: "app" | "pages";
  file: string;
  nodeId: string | null;
  methods?: string[];
  dynamicSegments: string[];
  routeGroups: string[];
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  file?: string;
  line?: number;
  endLine?: number;
  exported?: "named" | "default" | "both" | null;
  /** Free-form flags: "client", "server", "class", "error-boundary", "async", "suspense", ... */
  flags: string[];
  props?: PropInfo[];
  state?: StateInfo[];
  hooks?: string[];
  events?: EventInfo[];
  members?: MemberInfo[];
  db?: DbAccess[];
  route?: string;
  method?: string;
  conditionalRenders?: number;
  /** For external packages: version range declared in package.json. */
  version?: string;
  /** Number of source lines the symbol spans. */
  loc?: number;
  /** Why this node has its kind (e.g. "returns JSX and is PascalCase"). */
  kindReason?: string;
  /** Next.js App Router rendering environment, derived from the "use client" boundary. */
  renderEnv?: { env: "client" | "server"; reason: string };
  /** Event nodes: state setters invoked by the handler, as `Component.state`. */
  stateUpdates?: string[];
  /** Event nodes: prop callbacks followed to a parent, e.g. `onSave → DocumentEditor.handleSave`. */
  viaProps?: string[];
  /** Event nodes: the handler expression as written. */
  handler?: string;
}

export interface ImportRecord {
  specifier: string;
  line: number;
  kind: "static" | "dynamic" | "type" | "require" | "reexport";
  bindings: { local: string; imported: string }[];
  /** Resolved project-relative path, or null for packages/unresolved. */
  resolved: string | null;
  /** Package name for bare specifiers. */
  packageName: string | null;
}

export interface FileRecord {
  path: string;
  language: Language;
  loc: number;
  bytes: number;
  hash: string;
  directives: string[];
  imports: ImportRecord[];
  exports: string[];
  symbols: string[];
  parseErrors: number;
}

export interface FileEdge {
  from: string;
  to: string;
  kind: ImportRecord["kind"];
  line: number;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "symlink-skipped"
  | "file-too-large"
  | "binary-skipped"
  | "env-file-skipped"
  | "file-limit-reached"
  | "parse-error"
  | "unresolved-import"
  | "possible-secret"
  | "read-error"
  | "outside-root"
  | "unsupported-language";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
}

export interface FrameworkInfo {
  name: "nextjs" | "react" | "unknown";
  label: string;
  version?: string;
  router?: { app: boolean; pages: boolean };
  /** Signals that led to the detection. */
  signals: string[];
  packages: Record<string, string>;
  language: "typescript" | "javascript" | "mixed";
}

export interface DependencyMetrics {
  cycles: string[][];
  /** Files ordered by fan-in + fan-out. */
  hubs: { file: string; fanIn: number; fanOut: number }[];
  isolated: string[];
  maxDepth: number;
  depthByFile: Record<string, number>;
}

export interface AnalysisStats {
  filesDiscovered: number;
  filesAnalyzed: number;
  filesFromCache: number;
  filesSkipped: number;
  totalLoc: number;
  nodesByKind: Partial<Record<NodeKind, number>>;
  edges: number;
  networkCalls: number;
}

export interface AnalysisLimits {
  maxFiles: number;
  maxFileBytes: number;
  ignoredDirectories: string[];
}

export interface AnalysisResult {
  analyzerVersion: string;
  generatedAt: string;
  durationMs: number;
  project: { name: string; root: string };
  framework: FrameworkInfo;
  limits: AnalysisLimits;
  files: FileRecord[];
  fileEdges: FileEdge[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: RouteInfo[];
  network: NetworkCall[];
  dependencies: DependencyMetrics;
  diagnostics: Diagnostic[];
  stats: AnalysisStats;
}

export type AnalysisStage =
  | "discover"
  | "detect"
  | "parse"
  | "resolve"
  | "graph"
  | "metrics";

export const ANALYSIS_STAGES: readonly { id: AnalysisStage; label: string }[] = [
  { id: "discover", label: "Discovering files" },
  { id: "detect", label: "Detecting framework" },
  { id: "parse", label: "Parsing & extracting symbols" },
  { id: "resolve", label: "Resolving imports" },
  { id: "graph", label: "Building relationship graph" },
  { id: "metrics", label: "Computing dependency metrics" },
];

export interface AnalysisProgress {
  stage: AnalysisStage;
  stageIndex: number;
  stageCount: number;
  /** Units of measured work done within the stage (files parsed, etc.), when countable. */
  processed?: number;
  total?: number;
  message?: string;
}
