/**
 * Stage 5 — relationship graph construction.
 *
 * Resolves the raw, per-file references produced by extraction into
 * project-wide nodes and edges. Each edge carries the evidence it is based on
 * and whether it was detected syntactically or inferred heuristically.
 */
import type { FileExtraction, RawSymbol, Ref, Effects, CallbackProp, RawNetwork } from "../extract/types.ts";
import type { ModuleResolver } from "../resolve.ts";
import type {
  Confidence,
  Diagnostic,
  EdgeKind,
  EventInfo,
  Evidence,
  FileEdge,
  FileRecord,
  FrameworkInfo,
  GraphEdge,
  GraphNode,
  ImportRecord,
  MemberInfo,
  NetworkCall,
  NodeKind,
  RouteInfo,
} from "../types.ts";
import { HOOK_NAME } from "../extract/file.ts";
import { classifyRouteFile, HTTP_METHODS, isMiddlewareFile, routeMatches } from "./routes.ts";

/** Framework packages that nearly every file uses; kept out of the symbol graph (still in file dependencies). */
const FRAMEWORK_PACKAGES = new Set(["react", "react-dom", "next", "react/jsx-runtime"]);

export interface GraphInput {
  extractions: FileExtraction[];
  resolver: ModuleResolver;
  framework: FrameworkInfo;
  packageVersions: Record<string, string>;
}

export interface GraphOutput {
  files: FileRecord[];
  fileEdges: FileEdge[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: RouteInfo[];
  network: NetworkCall[];
  diagnostics: Diagnostic[];
}

type Target =
  | { kind: "symbol"; file: string; local: string }
  | { kind: "namespace"; file: string }
  | { kind: "package"; name: string };

export const symbolId = (file: string, local: string) => `sym:${file}#${local}`;

export function buildGraph(input: GraphInput): GraphOutput {
  return new GraphBuilder(input).build();
}

class GraphBuilder {
  private readonly input: GraphInput;
  private readonly byFile = new Map<string, FileExtraction>();
  private readonly symbols = new Map<string, Map<string, RawSymbol>>();
  private readonly imports = new Map<string, ImportRecord[]>();
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly diagnostics: Diagnostic[] = [];
  private readonly network: NetworkCall[] = [];
  private readonly routes: RouteInfo[] = [];
  private readonly clientFiles = new Map<string, string>();
  /** Callback props passed to a component: target node id → bindings in parents. */
  private readonly callbackBindings = new Map<string, { parentId: string; file: string; sym: RawSymbol; binding: CallbackProp }[]>();
  /** Network call line → endpoint node id, per symbol. */
  private readonly networkEndpoints = new Map<string, string | null>();

  constructor(input: GraphInput) {
    this.input = input;
    for (const ex of input.extractions) {
      this.byFile.set(ex.path, ex);
      this.symbols.set(ex.path, new Map(ex.symbols.map((s) => [s.local, s])));
    }
  }

  build(): GraphOutput {
    const files = this.resolveImports();
    const fileEdges = this.fileEdges();
    this.computeClientBoundary(fileEdges);
    this.createSymbolNodes();
    this.createRoutes();
    for (const ex of this.input.extractions) for (const sym of ex.symbols) this.linkSymbol(ex, sym);
    this.matchEndpointsToHandlers();
    for (const ex of this.input.extractions) for (const sym of ex.symbols) this.linkEvents(ex, sym);

    for (const file of files) file.symbols = [...this.nodes.values()].filter((n) => n.file === file.path && n.kind !== "event").map((n) => n.id);

    return {
      files,
      fileEdges,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      routes: this.routes.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind)),
      network: this.network,
      diagnostics: this.diagnostics,
    };
  }

  // ------------------------------------------------------------------ files

  private resolveImports(): FileRecord[] {
    const records: FileRecord[] = [];
    for (const ex of this.input.extractions) {
      const imports: ImportRecord[] = ex.imports.map((imp) => {
        const outcome = this.input.resolver.resolve(imp.specifier, ex.path);
        if (!outcome.resolved && !outcome.packageName) {
          this.diagnostics.push({
            code: "unresolved-import",
            severity: "info",
            message: `Could not resolve "${imp.specifier}" inside the project`,
            file: ex.path,
            line: imp.line,
          });
        }
        return { ...imp, resolved: outcome.resolved, packageName: outcome.packageName };
      });
      this.imports.set(ex.path, imports);
      const exportNames = [...new Set(ex.exports.map((e) => e.exported))];
      records.push({
        path: ex.path,
        language: ex.language,
        loc: ex.loc,
        bytes: ex.bytes,
        hash: ex.hash,
        directives: ex.directives,
        imports,
        exports: exportNames,
        symbols: [],
        parseErrors: ex.parseErrors,
      });
    }
    return records;
  }

  private fileEdges(): FileEdge[] {
    const edges: FileEdge[] = [];
    const seen = new Set<string>();
    for (const [file, imports] of this.imports) {
      for (const imp of imports) {
        if (!imp.resolved || imp.resolved === file) continue;
        const key = `${file}→${imp.resolved}→${imp.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: file, to: imp.resolved, kind: imp.kind, line: imp.line });
      }
    }
    return edges;
  }

  /** Every module statically imported (transitively) by a "use client" module runs on the client. */
  private computeClientBoundary(fileEdges: FileEdge[]): void {
    const out = new Map<string, string[]>();
    for (const e of fileEdges) {
      if (e.kind === "type") continue;
      if (!out.has(e.from)) out.set(e.from, []);
      out.get(e.from)!.push(e.to);
    }
    const queue: string[] = [];
    for (const ex of this.input.extractions) {
      if (ex.directives.includes("use client")) {
        this.clientFiles.set(ex.path, 'declares "use client"');
        queue.push(ex.path);
      }
    }
    while (queue.length) {
      const file = queue.shift()!;
      for (const next of out.get(file) ?? []) {
        if (this.clientFiles.has(next)) continue;
        if (this.byFile.get(next)?.directives.includes("use server")) continue;
        this.clientFiles.set(next, `imported by client module ${file}`);
        queue.push(next);
      }
    }
  }

  // ------------------------------------------------------------------ resolution

  private resolveExport(file: string, name: string, seen = new Set<string>()): Target | null {
    const key = `${file}::${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const ex = this.byFile.get(file);
    if (!ex) return null;
    const imports = this.imports.get(file) ?? [];
    const resolveSpec = (spec: string) => imports.find((i) => i.specifier === spec);

    for (const exp of ex.exports) {
      if (exp.exported !== name) continue;
      if (exp.from === null && exp.local) {
        if (this.symbols.get(file)?.has(exp.local)) return { kind: "symbol", file, local: exp.local };
        return this.resolveBinding(file, exp.local, seen);
      }
      if (exp.from) {
        const imp = resolveSpec(exp.from);
        if (imp?.resolved) return exp.imported === "*" ? { kind: "namespace", file: imp.resolved } : this.resolveExport(imp.resolved, exp.imported ?? name, seen);
        if (imp?.packageName) return { kind: "package", name: imp.packageName };
      }
    }
    if (name !== "default") {
      for (const exp of ex.exports) {
        if (exp.exported !== "*" || !exp.from) continue;
        const imp = resolveSpec(exp.from);
        if (!imp?.resolved) continue;
        const target = this.resolveExport(imp.resolved, name, seen);
        if (target) return target;
      }
    }
    return null;
  }

  private resolveBinding(file: string, local: string, seen = new Set<string>()): Target | null {
    if (this.symbols.get(file)?.has(local)) return { kind: "symbol", file, local };
    for (const imp of this.imports.get(file) ?? []) {
      const binding = imp.bindings.find((b) => b.local === local);
      if (!binding) continue;
      if (imp.resolved) {
        if (binding.imported === "*") return { kind: "namespace", file: imp.resolved };
        return this.resolveExport(imp.resolved, binding.imported, seen);
      }
      if (imp.packageName) return { kind: "package", name: imp.packageName };
    }
    return null;
  }

  /** Resolves a reference like `Foo`, `ns.Foo` or `DocumentService.update` to a target. */
  private resolveRef(file: string, ref: Pick<Ref, "name" | "member">): { target: Target; member?: string } | null {
    const target = this.resolveBinding(file, ref.name);
    if (!target) return null;
    if (target.kind === "namespace") {
      if (!ref.member) return null;
      const [first, ...rest] = ref.member.split(".");
      const inner = this.resolveExport(target.file, first!);
      return inner ? { target: inner, member: rest.length ? rest.join(".") : undefined } : null;
    }
    return { target, member: ref.member };
  }

  private nodeIdFor(target: Target): string | null {
    if (target.kind === "symbol") {
      const sym = this.symbols.get(target.file)?.get(target.local);
      if (sym?.declKind === "lazy") return this.lazyTarget(target.file, sym);
      const id = symbolId(target.file, target.local);
      return this.nodes.has(id) ? id : null;
    }
    if (target.kind === "package") return this.externalNode(target.name);
    return null;
  }

  private lazyTarget(file: string, sym: RawSymbol): string | null {
    const spec = sym.lazy[0]?.specifier;
    if (!spec) return null;
    const imp = (this.imports.get(file) ?? []).find((i) => i.specifier === spec && i.resolved);
    if (!imp?.resolved) return null;
    const target = this.resolveExport(imp.resolved, "default");
    if (target?.kind === "symbol") return symbolId(target.file, target.local);
    return null;
  }

  // ------------------------------------------------------------------ nodes

  private createSymbolNodes(): void {
    const isNext = this.input.framework.name === "nextjs";
    for (const ex of this.input.extractions) {
      const route = isNext ? classifyRouteFile(ex.path) : null;
      const fileUseServer = ex.directives.includes("use server");
      for (const sym of ex.symbols) {
        if (sym.declKind === "lazy") continue;
        const exportsOf = ex.exports.filter((e) => e.from === null && e.local === sym.local).map((e) => e.exported);
        const isDefault = exportsOf.includes("default");
        const isNamed = exportsOf.some((e) => e !== "default");
        const exported: GraphNode["exported"] = isDefault && isNamed ? "both" : isDefault ? "default" : isNamed ? "named" : null;
        const { kind, reason } = this.classify(ex, sym, route, isDefault, exportsOf, fileUseServer);

        const flags: string[] = [];
        if (sym.isAsync) flags.push("async");
        if (sym.isClassComponent) flags.push("class");
        if (sym.isErrorBoundary) flags.push("error-boundary");
        if (sym.suspense) flags.push("suspense");
        if (sym.httpClient) flags.push("http-client");
        flags.push(...sym.wrappers);
        if (ex.directives.includes("use client")) flags.push("use client");
        if (fileUseServer || sym.directives.includes("use server")) flags.push("use server");

        const node: GraphNode = {
          id: symbolId(ex.path, sym.local),
          kind,
          name: sym.name,
          file: ex.path,
          line: sym.line,
          endLine: sym.endLine,
          loc: sym.endLine - sym.line + 1,
          exported,
          flags,
          kindReason: reason,
        };
        if (sym.props.length) node.props = sym.props;
        if (sym.state.length) node.state = sym.state;
        if (sym.hooks.length) node.hooks = sym.hooks;
        if (sym.conditionalRenders) node.conditionalRenders = sym.conditionalRenders;
        if (sym.members.length) {
          node.members = sym.members.map<MemberInfo>((m) => ({
            name: m.name,
            line: m.line,
            endLine: m.endLine,
            calls: [...new Set(sym.calls.filter((c) => c.from === m.name).map((c) => (c.member ? `${c.name}.${c.member}` : c.name)))],
            network: sym.network.filter((n) => n.from === m.name).length,
            db: [...new Set(sym.db.filter((d) => d.from === m.name).map((d) => `${d.operation} ${d.entity}`))],
          }));
        }
        if (sym.db.length) node.db = sym.db.map(({ entity, operation, client, line, confidence }) => ({ entity, operation, client, line, confidence }));
        if (route && isDefault && (kind === "page" || kind === "layout" || kind === "route-segment")) node.route = route.path;
        if (kind === "route-handler" && route) {
          node.route = route.path;
          node.method = route.kind === "api" ? "ANY" : sym.local;
          node.name = `${node.method} ${route.path}`;
        }

        if (isNext && this.input.framework.router?.app && (kind === "component" || kind === "page" || kind === "layout" || kind === "provider" || kind === "route-segment")) {
          const client = this.clientFiles.get(ex.path);
          node.renderEnv = client ? { env: "client", reason: `Client component: ${client}` } : { env: "server", reason: "Server component: no \"use client\" boundary reaches this module" };
        }
        this.nodes.set(node.id, node);
      }
    }
  }

  private classify(
    ex: FileExtraction,
    sym: RawSymbol,
    route: ReturnType<typeof classifyRouteFile>,
    isDefault: boolean,
    exportsOf: string[],
    fileUseServer: boolean,
  ): { kind: NodeKind; reason: string } {
    const isNext = this.input.framework.name === "nextjs";
    if (route && isDefault) {
      if (route.kind === "page") return { kind: "page", reason: `Default export of a ${route.router === "app" ? "App Router page file" : "Pages Router page"}` };
      if (route.kind === "layout") return { kind: "layout", reason: route.router === "app" ? "Default export of an App Router layout file" : "Pages Router _app/_document" };
      if (route.kind === "api") return { kind: "route-handler", reason: "Default export of a Pages Router API route" };
      if (route.kind !== "route-handler") return { kind: "route-segment", reason: `Default export of an App Router ${route.kind} file` };
    }
    if (route?.kind === "route-handler" && exportsOf.length && HTTP_METHODS.has(sym.local)) {
      return { kind: "route-handler", reason: `Exported ${sym.local} function in an App Router route file` };
    }
    if (isNext && isMiddlewareFile(ex.path) && (sym.local === "middleware" || sym.local === "proxy" || isDefault)) {
      return { kind: "middleware", reason: "Next.js middleware file convention" };
    }
    if (sym.declKind === "context") return { kind: "context", reason: "Created with createContext()" };
    if (sym.declKind === "http-client") return { kind: "service", reason: "HTTP client created with axios.create()" };
    if ((fileUseServer && exportsOf.length && sym.declKind === "function") || sym.directives.includes("use server")) {
      return { kind: "server-action", reason: fileUseServer ? 'Exported function in a "use server" module' : 'Function with an inline "use server" directive' };
    }
    if (sym.declKind === "function" && HOOK_NAME.test(sym.name)) return { kind: "hook", reason: "Function named use* (React hook convention)" };
    if (sym.isClassComponent) return { kind: "component", reason: "Class extending React.Component" };
    if (sym.returnsJsx && /^[A-Z]/.test(sym.name)) {
      if (sym.providesContext.length) return { kind: "provider", reason: "Component that renders <Context.Provider>" };
      return { kind: "component", reason: "PascalCase function that returns JSX" };
    }
    const hasIo = sym.network.length > 0 || sym.db.length > 0;
    if (sym.declKind === "object" || sym.declKind === "class") {
      if (hasIo) return { kind: "service", reason: "Groups methods that perform network or database access" };
      if (/(Service|Api|API|Client|Repository|Repo|Store|Gateway)$/.test(sym.name)) return { kind: "service", reason: "Naming convention (*Service / *Api / *Client …)" };
      return { kind: "utility", reason: "Object or class without detected I/O" };
    }
    if (hasIo) return { kind: "service", reason: "Function that performs network or database access" };
    return { kind: "utility", reason: "Function without JSX, hooks or detected I/O" };
  }

  private externalNode(pkg: string): string | null {
    if (pkg.startsWith("node:") || FRAMEWORK_PACKAGES.has(pkg)) return null;
    const id = `pkg:${pkg}`;
    if (!this.nodes.has(id)) {
      const version = this.input.packageVersions[pkg];
      this.nodes.set(id, { id, kind: "external", name: pkg, flags: version ? [] : ["undeclared"], version, kindReason: version ? "Declared in package.json" : "Imported but not declared in package.json" });
    }
    return id;
  }

  private createRoutes(): void {
    if (this.input.framework.name !== "nextjs") return;
    for (const ex of this.input.extractions) {
      const route = classifyRouteFile(ex.path);
      if (!route) continue;
      const defaultExport = ex.exports.find((e) => e.exported === "default" && e.from === null);
      const handlers = ex.exports.filter((e) => HTTP_METHODS.has(e.exported) && e.from === null).map((e) => e.exported);
      const nodeId =
        route.kind === "route-handler"
          ? (handlers[0] ? symbolId(ex.path, handlers[0]) : null)
          : defaultExport?.local
            ? symbolId(ex.path, defaultExport.local)
            : null;
      this.routes.push({
        path: route.path,
        kind: route.kind,
        router: route.router,
        file: ex.path,
        nodeId: nodeId && this.nodes.has(nodeId) ? nodeId : null,
        methods: route.kind === "route-handler" ? handlers : route.kind === "api" ? ["ANY"] : undefined,
        dynamicSegments: route.dynamicSegments,
        routeGroups: route.routeGroups,
      });
    }
  }

  // ------------------------------------------------------------------ edges

  private addEdge(source: string, target: string, kind: EdgeKind, evidence: Evidence, label?: string, sourceMember?: string): void {
    if (source === target) return;
    const id = `${kind}:${source}->${target}${label ? `.${label}` : ""}${sourceMember ? `@${sourceMember}` : ""}`;
    const existing = this.edges.get(id);
    if (existing) {
      if (!existing.evidence.some((e) => e.file === evidence.file && e.line === evidence.line)) existing.evidence.push(evidence);
      if (evidence.confidence === "detected" && existing.confidence === "inferred" && existing.evidence.every((e) => e.confidence === "detected")) existing.confidence = "detected";
      return;
    }
    this.edges.set(id, { id, source, target, kind, confidence: evidence.confidence, evidence: [evidence], label, sourceMember });
  }

  private linkSymbol(ex: FileExtraction, sym: RawSymbol): void {
    if (sym.declKind === "lazy") return;
    const self = symbolId(ex.path, sym.local);
    if (!this.nodes.has(self)) return;
    const ev = (line: number, reason: string, confidence: Confidence = "detected"): Evidence => ({ file: ex.path, line, confidence, reason });

    for (const r of sym.renders) {
      const resolved = this.resolveRef(ex.path, r);
      if (!resolved) continue;
      const lazySym = resolved.target.kind === "symbol" ? this.symbols.get(resolved.target.file)?.get(resolved.target.local) : undefined;
      const target = this.nodeIdFor(resolved.target);
      if (!target) continue;
      if (resolved.target.kind === "package") {
        this.addEdge(self, target, "uses-package", ev(r.line, `Renders <${r.member ? `${r.name}.${r.member}` : r.name}> from ${resolved.target.name}`));
        continue;
      }
      if (lazySym?.declKind === "lazy") {
        this.addEdge(self, target, "lazy-loads", ev(r.line, `Renders <${r.name}>, lazily loaded via dynamic import("${lazySym.lazy[0]?.specifier}")`));
      } else {
        this.addEdge(self, target, "renders", ev(r.line, `Renders <${r.name}${r.member ? `.${r.member}` : ""}>`));
      }
      for (const binding of r.callbackProps) {
        if (!this.callbackBindings.has(target)) this.callbackBindings.set(target, []);
        this.callbackBindings.get(target)!.push({ parentId: self, file: ex.path, sym, binding });
      }
    }

    for (const h of sym.hookCalls) {
      const resolved = this.resolveRef(ex.path, h);
      if (!resolved) continue;
      const target = this.nodeIdFor(resolved.target);
      if (!target) continue;
      const kind: EdgeKind = resolved.target.kind === "package" ? "uses-package" : "uses-hook";
      this.addEdge(self, target, kind, ev(h.line, `Calls ${h.member ? `${h.name}.${h.member}` : h.name}()`), undefined, h.from);
    }

    for (const c of sym.contextUses) {
      const resolved = this.resolveRef(ex.path, c);
      const target = resolved && this.nodeIdFor(resolved.target);
      if (target && this.nodes.get(target)?.kind === "context") this.addEdge(self, target, "consumes-context", ev(c.line, `Reads context ${c.name}`));
    }
    for (const c of sym.providesContext) {
      const resolved = this.resolveRef(ex.path, c);
      const target = resolved && this.nodeIdFor(resolved.target);
      if (target) this.addEdge(self, target, "provides-context", ev(c.line, `Renders <${c.name}.Provider>`));
    }

    for (const c of sym.calls) {
      if (sym.hookBindings[c.name]) continue; // represented by the uses-hook edge
      const resolved = this.resolveRef(ex.path, c);
      if (!resolved) continue;
      const target = this.nodeIdFor(resolved.target);
      if (!target) continue;
      if (resolved.target.kind === "package") {
        this.addEdge(self, target, "uses-package", ev(c.line, `Calls ${c.member ? `${c.name}.${c.member}` : c.name}() from ${resolved.target.name}`), undefined, c.from);
        continue;
      }
      const member = resolved.member?.split(".")[0];
      this.addEdge(self, target, "calls", ev(c.line, `Calls ${c.member ? `${c.name}.${c.member}` : c.name}()`), member, c.from);
    }

    for (const l of sym.lazy) {
      if (sym.declKind === "function" || sym.declKind === "object" || sym.declKind === "class") {
        const imp = (this.imports.get(ex.path) ?? []).find((i) => i.specifier === l.specifier && i.resolved);
        if (!imp?.resolved) continue;
        const t = this.resolveExport(imp.resolved, "default");
        const target = t && this.nodeIdFor(t);
        if (target) this.addEdge(self, target, "lazy-loads", ev(l.line, `Dynamic import("${l.specifier}")`));
      }
    }

    sym.network.forEach((n) => this.linkNetwork(ex, sym, self, n));

    for (const d of sym.db) {
      const id = `db:${d.entity}`;
      if (!this.nodes.has(id)) this.nodes.set(id, { id, kind: "db-entity", name: d.entity, flags: [d.client], kindReason: d.client === "prisma" ? "Prisma model accessed via client.<model>.<operation>()" : "Table named in a literal SQL statement" });
      this.addEdge(self, id, "queries", ev(d.line, d.client === "prisma" ? `prisma.${d.entity}.${d.operation}()` : `SQL ${d.operation.toUpperCase()} on ${d.entity}`, d.confidence), d.operation, d.from);
    }
  }

  private linkNetwork(ex: FileExtraction, sym: RawSymbol, self: string, n: RawNetwork): void {
    let url = n.url;
    let confidence = n.confidence;
    let reason = `${n.client === "fetch" ? "fetch" : n.client === "axios" ? `axios.${n.method.toLowerCase()}` : `${n.via}.${n.method.toLowerCase()}`}(${n.rawUrl})`;

    if (n.client === "http-client" && n.via) {
      const resolved = this.resolveRef(ex.path, { name: n.via });
      const clientSym = resolved?.target.kind === "symbol" ? this.symbols.get(resolved.target.file)?.get(resolved.target.local) : undefined;
      if (clientSym?.httpClient) {
        confidence = "detected";
        const base = clientSym.httpClient.baseURL;
        if (base && url && url.startsWith("/") && !/^https?:/.test(url)) url = `${base.replace(/\/$/, "")}${url}`;
        reason += ` — ${n.via} is an axios instance${base ? ` with baseURL "${base}"` : ""}`;
      } else if (!/api|http|client|axios|request|fetcher|instance/i.test(n.via)) {
        return; // `.get("/x")` on something we cannot identify as an HTTP client
      } else {
        reason += ` — ${n.via} assumed to be an HTTP client by name`;
      }
    }

    const endpointId = url ? `endpoint:${n.method} ${url}` : null;
    if (endpointId && !this.nodes.has(endpointId)) {
      this.nodes.set(endpointId, {
        id: endpointId,
        kind: "endpoint",
        name: `${n.method} ${url}`,
        method: n.method,
        route: url!,
        flags: /^https?:/.test(url!) || url!.startsWith("{") ? ["external-url"] : [],
        kindReason: "URL of a network request found in source",
      });
    }
    if (endpointId) this.addEdge(self, endpointId, "requests", { file: ex.path, line: n.line, confidence, reason }, undefined, n.from);
    this.networkEndpoints.set(`${self}@${n.line}`, endpointId);

    this.network.push({
      id: `net:${ex.path}:${n.line}:${this.network.length}`,
      file: ex.path,
      line: n.line,
      callerId: self,
      callerMember: n.from,
      client: n.client,
      method: n.method,
      url,
      rawUrl: n.rawUrl,
      urlKind: n.urlKind,
      confidence,
      endpointId,
      requestBody: n.requestBody,
      responseHandling: n.responseHandling,
    });
    void sym;
  }

  private matchEndpointsToHandlers(): void {
    const handlers = [...this.nodes.values()].filter((n) => n.kind === "route-handler" && n.route);
    for (const endpoint of this.nodes.values()) {
      if (endpoint.kind !== "endpoint" || !endpoint.route) continue;
      for (const h of handlers) {
        if (h.method !== "ANY" && h.method !== endpoint.method) continue;
        if (!routeMatches(endpoint.route, h.route!)) continue;
        this.addEdge(endpoint.id, h.id, "handled-by", {
          file: h.file!,
          line: h.line ?? 1,
          confidence: "inferred",
          reason: `${endpoint.method} ${endpoint.route} matches route ${h.route} (${h.method})`,
        });
      }
    }
  }

  // ------------------------------------------------------------------ events

  private linkEvents(ex: FileExtraction, sym: RawSymbol): void {
    const self = symbolId(ex.path, sym.local);
    const owner = this.nodes.get(self);
    if (!owner || !sym.events.length) return;
    const infos: EventInfo[] = [];

    for (const e of sym.events) {
      const id = `event:${self}@${e.line}:${e.event}`;
      const label = e.label ? `"${e.label}"` : `<${e.element}>`;
      const resolved = this.resolveEffects(ex.path, sym, self, e.effects, 0, "detected");
      this.nodes.set(id, {
        id,
        kind: "event",
        name: `${e.event} ${label}`,
        file: ex.path,
        line: e.line,
        endLine: e.line,
        flags: [e.element],
        handler: e.handler,
        stateUpdates: resolved.stateUpdates.length ? resolved.stateUpdates : undefined,
        viaProps: resolved.viaProps.length ? resolved.viaProps : undefined,
        kindReason: `${e.event} handler on <${e.element}> in ${owner.name}`,
      });
      this.addEdge(self, id, "handles", { file: ex.path, line: e.line, confidence: "detected", reason: `<${e.element} ${e.event}={${e.handler}}>` });
      for (const t of resolved.targets) this.addEdge(id, t.nodeId, "triggers", t.evidence, t.label);
      infos.push({ id, event: e.event, element: e.element, label: e.label, line: e.line, handler: e.handler });
    }
    owner.events = infos;
  }

  private resolveEffects(
    file: string,
    sym: RawSymbol,
    symId: string,
    effects: Effects,
    depth: number,
    confidence: Confidence,
    via?: string,
  ): { targets: { nodeId: string; label?: string; evidence: Evidence }[]; stateUpdates: string[]; viaProps: string[] } {
    const targets: { nodeId: string; label?: string; evidence: Evidence }[] = [];
    const stateUpdates: string[] = [];
    const viaProps: string[] = [];
    const owner = this.nodes.get(symId)?.name ?? sym.name;
    const suffix = via ? ` (${via})` : "";

    for (const c of effects.calls) {
      const hookBinding = sym.hookBindings[c.name];
      if (hookBinding) {
        const resolved = this.resolveRef(file, { name: hookBinding.hook });
        const target = resolved && this.nodeIdFor(resolved.target);
        if (target && resolved.target.kind !== "package") {
          targets.push({
            nodeId: target,
            label: hookBinding.member,
            evidence: { file, line: c.line, confidence, reason: `Calls ${c.name}(), returned by ${hookBinding.hook}()${suffix}` },
          });
        }
        continue;
      }
      const resolved = this.resolveRef(file, c);
      if (!resolved) continue;
      const target = this.nodeIdFor(resolved.target);
      if (!target || resolved.target.kind === "package") continue;
      targets.push({
        nodeId: target,
        label: resolved.member?.split(".")[0],
        evidence: { file, line: c.line, confidence, reason: `Calls ${c.member ? `${c.name}.${c.member}` : c.name}()${suffix}` },
      });
    }

    for (const setter of effects.setters) {
      const state = sym.state.find((s) => s.setter === setter);
      stateUpdates.push(`${owner}.${state?.name ?? setter}`);
    }

    for (const line of effects.network) {
      const endpoint = this.networkEndpoints.get(`${symId}@${line}`);
      if (endpoint) targets.push({ nodeId: endpoint, evidence: { file, line, confidence, reason: `Network request in handler${suffix}` } });
    }

    if (depth < 4) {
      for (const prop of effects.propCalls) {
        for (const parent of this.callbackBindings.get(symId) ?? []) {
          if (parent.binding.prop !== prop) continue;
          const parentName = this.nodes.get(parent.parentId)?.name ?? parent.sym.name;
          const step = `${prop} → ${parentName}.${parent.binding.handler}`;
          viaProps.push(step);
          const sub = this.resolveEffects(parent.file, parent.sym, parent.parentId, parent.binding.effects, depth + 1, "inferred", `via prop ${prop} bound in ${parentName}`);
          targets.push(...sub.targets);
          stateUpdates.push(...sub.stateUpdates);
          viaProps.push(...sub.viaProps);
        }
      }
    }
    return { targets, stateUpdates: [...new Set(stateUpdates)], viaProps: [...new Set(viaProps)] };
  }
}
