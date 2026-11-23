/**
 * Per-file extraction output. Everything here is derived from a single file's
 * syntax tree, which makes it cacheable by content hash. Cross-file meaning
 * (what an identifier refers to) is resolved later, in the graph stage.
 */
import type { Confidence, Diagnostic, Language, PropInfo, StateInfo } from "../types.ts";

export interface Ref {
  /** Identifier as written in the source (the root of a member chain). */
  name: string;
  /** Accessed member, e.g. `update` in `DocumentService.update()`. */
  member?: string;
  line: number;
  /** Member of the *calling* symbol this reference occurs in (service methods). */
  from?: string;
}

export interface Effects {
  calls: Ref[];
  /** State setter identifiers invoked (from useState/useReducer destructuring). */
  setters: string[];
  /** Props of the component that are invoked as callbacks. */
  propCalls: string[];
  /** Line numbers of network calls made directly in the handler. */
  network: number[];
}

export interface CallbackProp {
  prop: string;
  handler: string;
  line: number;
  effects: Effects;
}

export interface RenderRef extends Ref {
  callbackProps: CallbackProp[];
  label?: string;
}

export interface RawEvent {
  event: string;
  element: string;
  label?: string;
  line: number;
  handler: string;
  effects: Effects;
}

export interface RawNetwork {
  client: "fetch" | "axios" | "http-client";
  method: string;
  url: string | null;
  rawUrl: string;
  urlKind: "literal" | "template" | "dynamic";
  line: number;
  confidence: Confidence;
  /** For `client.get(...)`: the identifier that issued the request. */
  via?: string;
  from?: string;
  requestBody?: string;
  responseHandling: string[];
}

export interface RawDb {
  entity: string;
  operation: string;
  client: "prisma" | "sql";
  line: number;
  confidence: Confidence;
  from?: string;
}

export interface RawMember {
  name: string;
  line: number;
  endLine: number;
  isAsync: boolean;
}

export type DeclKind = "function" | "class" | "object" | "context" | "http-client" | "lazy";

export interface RawSymbol {
  local: string;
  /** Display name; differs from `local` for anonymous default exports. */
  name: string;
  declKind: DeclKind;
  line: number;
  endLine: number;
  isAsync: boolean;
  returnsJsx: boolean;
  isClassComponent: boolean;
  isErrorBoundary: boolean;
  wrappers: string[];
  directives: string[];
  props: PropInfo[];
  state: StateInfo[];
  hooks: string[];
  renders: RenderRef[];
  hookCalls: Ref[];
  calls: Ref[];
  contextUses: Ref[];
  providesContext: Ref[];
  events: RawEvent[];
  network: RawNetwork[];
  db: RawDb[];
  lazy: { specifier: string; line: number }[];
  members: RawMember[];
  /** Local binding → the hook call it came from (`const { save } = useSaveDocument()`). */
  hookBindings: Record<string, { hook: string; member?: string }>;
  suspense: boolean;
  conditionalRenders: number;
  httpClient?: { baseURL: string | null };
}

export interface RawImport {
  specifier: string;
  line: number;
  kind: "static" | "dynamic" | "type" | "require" | "reexport";
  bindings: { local: string; imported: string }[];
}

export interface RawExport {
  exported: string;
  /** Local symbol name (for `export { a as b }` or declarations). */
  local: string | null;
  /** Source module for re-exports. */
  from: string | null;
  /** Name imported from `from` ("*" for namespace / star re-exports). */
  imported?: string;
  line: number;
}

export interface FileExtraction {
  path: string;
  language: Language;
  hash: string;
  bytes: number;
  loc: number;
  directives: string[];
  imports: RawImport[];
  exports: RawExport[];
  symbols: RawSymbol[];
  parseErrors: number;
  diagnostics: Diagnostic[];
}
