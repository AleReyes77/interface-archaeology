/**
 * Stage 3 — per-file AST extraction.
 *
 * Parses one file with the TypeScript compiler (syntax only, no type checker,
 * no execution) and records symbols and the raw references they make.
 */
import ts from "typescript";
import { createHash } from "node:crypto";
import type { Diagnostic, Language, PropInfo, StateInfo } from "../types.ts";
import { redactSecrets } from "../redact.ts";
import { detectDb, detectNetwork, detectTaggedSql, lineOf } from "./network.ts";
import type {
  CallbackProp,
  DeclKind,
  Effects,
  FileExtraction,
  RawEvent,
  RawExport,
  RawImport,
  RawMember,
  RawSymbol,
  RenderRef,
} from "./types.ts";

export const HOOK_NAME = /^use[A-Z0-9]/;
const BUILTIN_HOOKS = new Set([
  "useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "useReducer",
  "useLayoutEffect", "useInsertionEffect", "useId", "useTransition", "useDeferredValue",
  "useSyncExternalStore", "useImperativeHandle", "useDebugValue", "useOptimistic", "useActionState", "useFormStatus",
]);
const STATE_HOOKS = new Set(["useState", "useReducer", "useOptimistic", "useActionState"]);
const COMPONENT_WRAPPERS = new Set(["memo", "forwardRef", "observer", "withRouter", "connect"]);
const LAZY_FACTORIES = new Set(["lazy", "dynamic", "loadable"]);

const SCRIPT_KIND: Record<Language, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
};

export function hashContent(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function endLineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
}

function calleeName(expr: ts.Expression): { name: string; member?: string } | null {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return { name: e.text };
  if (ts.isPropertyAccessExpression(e)) {
    const chain: string[] = [e.name.text];
    let cur: ts.Expression = unwrap(e.expression);
    while (ts.isPropertyAccessExpression(cur)) {
      chain.unshift(cur.name.text);
      cur = unwrap(cur.expression);
    }
    if (ts.isIdentifier(cur)) return { name: cur.text, member: chain.join(".") };
  }
  return null;
}

/** `React.useState` → `useState`; `useState` → `useState`. */
function hookNameOf(call: ts.CallExpression): string | null {
  const c = calleeName(call.expression);
  if (!c) return null;
  if (!c.member && HOOK_NAME.test(c.name)) return c.name;
  if (c.member && (c.name === "React" || c.name === "react") && HOOK_NAME.test(c.member)) return c.member;
  return null;
}

function isFunctionExpressionLike(node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isJsxExpr(node: ts.Expression): boolean {
  const e = unwrap(node);
  return ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e);
}

function emptyEffects(): Effects {
  return { calls: [], setters: [], propCalls: [], network: [] };
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

interface TypeMember {
  name: string;
  type?: string;
  optional: boolean;
  line: number;
}

class FileExtractor {
  private readonly sf: ts.SourceFile;
  private readonly typeMembers = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>();
  private readonly prismaClients = new Set<string>();
  readonly symbols: RawSymbol[] = [];
  readonly imports: RawImport[] = [];
  readonly exports: RawExport[] = [];
  readonly directives: string[] = [];

  constructor(sf: ts.SourceFile) {
    this.sf = sf;
  }

  run(): void {
    const sf = this.sf;
    for (const stmt of sf.statements) {
      if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) this.directives.push(stmt.expression.text);
      else break;
    }
    // Pre-pass: local type declarations (for props) and Prisma client variables.
    for (const stmt of sf.statements) {
      if (ts.isInterfaceDeclaration(stmt)) this.typeMembers.set(stmt.name.text, stmt);
      if (ts.isTypeAliasDeclaration(stmt)) this.typeMembers.set(stmt.name.text, stmt.type);
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          const init = d.initializer ? unwrap(d.initializer) : undefined;
          if (ts.isIdentifier(d.name) && init && ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "PrismaClient") {
            this.prismaClients.add(d.name.text);
          }
        }
      }
    }
    for (const stmt of sf.statements) this.statement(stmt);
    this.collectModuleLevelImports(sf);
  }

  // ---------------------------------------------------------------- imports/exports

  private statement(stmt: ts.Statement): void {
    const sf = this.sf;
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      const bindings: RawImport["bindings"] = [];
      if (clause?.name) bindings.push({ local: clause.name.text, imported: "default" });
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) bindings.push({ local: clause.namedBindings.name.text, imported: "*" });
        else for (const el of clause.namedBindings.elements) bindings.push({ local: el.name.text, imported: (el.propertyName ?? el.name).text });
      }
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      this.imports.push({ specifier: stmt.moduleSpecifier.text, line: lineOf(sf, stmt), kind: typeOnly ? "type" : "static", bindings });
      return;
    }

    if (ts.isExportDeclaration(stmt)) {
      const from = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
      const line = lineOf(sf, stmt);
      if (from) this.imports.push({ specifier: from, line, kind: stmt.isTypeOnly ? "type" : "reexport", bindings: [] });
      if (!stmt.exportClause) {
        if (from) this.exports.push({ exported: "*", local: null, from, imported: "*", line });
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        this.exports.push({ exported: stmt.exportClause.name.text, local: null, from, imported: "*", line });
      } else {
        for (const el of stmt.exportClause.elements) {
          const source = (el.propertyName ?? el.name).text;
          this.exports.push(from ? { exported: el.name.text, local: null, from, imported: source, line } : { exported: el.name.text, local: source, from: null, line });
        }
      }
      return;
    }

    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = unwrap(stmt.expression);
      const line = lineOf(sf, stmt);
      if (ts.isIdentifier(expr)) {
        this.exports.push({ exported: "default", local: expr.text, from: null, line });
      } else if (ts.isCallExpression(expr) && expr.arguments[0] && ts.isIdentifier(unwrap(expr.arguments[0]))) {
        // export default memo(Component)
        this.exports.push({ exported: "default", local: (unwrap(expr.arguments[0]) as ts.Identifier).text, from: null, line });
      } else if (isFunctionExpressionLike(expr) || ts.isClassExpression(expr)) {
        const sym = this.newSymbol("default", this.defaultName(), ts.isClassExpression(expr) ? "class" : "function", expr);
        if (ts.isClassExpression(expr)) this.analyzeClass(expr, sym);
        else this.analyzeFunction(expr, sym, undefined);
        this.symbols.push(sym);
        this.exports.push({ exported: "default", local: "default", from: null, line });
      }
      return;
    }

    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      const local = stmt.name?.text ?? "default";
      const sym = this.newSymbol(local, stmt.name?.text ?? this.defaultName(), "function", stmt);
      this.analyzeFunction(stmt, sym, undefined);
      this.symbols.push(sym);
      if (exported) this.exports.push({ exported: isDefault ? "default" : local, local, from: null, line: sym.line });
      return;
    }

    if (ts.isClassDeclaration(stmt)) {
      const local = stmt.name?.text ?? "default";
      const sym = this.newSymbol(local, stmt.name?.text ?? this.defaultName(), "class", stmt);
      this.analyzeClass(stmt, sym);
      this.symbols.push(sym);
      if (exported) this.exports.push({ exported: isDefault ? "default" : local, local, from: null, line: sym.line });
      return;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const sym = this.variableSymbol(decl.name.text, decl);
        if (!sym) continue;
        this.symbols.push(sym);
        if (exported) this.exports.push({ exported: decl.name.text, local: decl.name.text, from: null, line: sym.line });
      }
    }
  }

  /** Dynamic `import()` and `require()` anywhere in the file. */
  private collectModuleLevelImports(sf: ts.SourceFile): void {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const arg = node.arguments[0];
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && arg && ts.isStringLiteralLike(arg)) {
          this.imports.push({ specifier: arg.text, line: lineOf(sf, node), kind: "dynamic", bindings: [] });
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require" && arg && ts.isStringLiteralLike(arg)) {
          const bindings: RawImport["bindings"] = [];
          const parent = node.parent;
          if (ts.isVariableDeclaration(parent)) {
            if (ts.isIdentifier(parent.name)) bindings.push({ local: parent.name.text, imported: "*" });
            else if (ts.isObjectBindingPattern(parent.name)) {
              for (const el of parent.name.elements) {
                if (ts.isIdentifier(el.name)) bindings.push({ local: el.name.text, imported: el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text });
              }
            }
          }
          this.imports.push({ specifier: arg.text, line: lineOf(sf, node), kind: "require", bindings });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  private defaultName(): string {
    // `app/documents/[id]/page.tsx` → "DocumentsIdPage"-like names are noisy; use the file stem.
    const base = this.sf.fileName.split("/").pop() ?? "default";
    const stem = base.replace(/\.[^.]+$/, "");
    const pretty = stem.replace(/[-_.](\w)/g, (_, c: string) => c.toUpperCase());
    return pretty.charAt(0).toUpperCase() + pretty.slice(1);
  }

  // ---------------------------------------------------------------- symbols

  private newSymbol(local: string, name: string, declKind: DeclKind, node: ts.Node): RawSymbol {
    return {
      local,
      name,
      declKind,
      line: lineOf(this.sf, node),
      endLine: endLineOf(this.sf, node),
      isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
      returnsJsx: false,
      isClassComponent: false,
      isErrorBoundary: false,
      wrappers: [],
      directives: [],
      props: [],
      state: [],
      hooks: [],
      renders: [],
      hookCalls: [],
      calls: [],
      contextUses: [],
      providesContext: [],
      events: [],
      network: [],
      db: [],
      lazy: [],
      members: [],
      hookBindings: {},
      suspense: false,
      conditionalRenders: 0,
    };
  }

  private variableSymbol(local: string, decl: ts.VariableDeclaration): RawSymbol | null {
    let init = unwrap(decl.initializer!);
    const wrappers: string[] = [];

    // memo(…), forwardRef(…), React.memo(…), observer(…)
    while (ts.isCallExpression(init)) {
      const c = calleeName(init.expression);
      const fnName = c?.member ?? c?.name;
      if (!fnName || !COMPONENT_WRAPPERS.has(fnName) || !init.arguments[0]) break;
      wrappers.push(fnName);
      init = unwrap(init.arguments[0]);
    }

    if (isFunctionExpressionLike(init)) {
      const sym = this.newSymbol(local, local, "function", decl);
      sym.isAsync = hasModifier(init, ts.SyntaxKind.AsyncKeyword);
      sym.wrappers = wrappers;
      const typeArg = decl.type && ts.isTypeReferenceNode(decl.type) ? decl.type.typeArguments?.[0] : undefined;
      this.analyzeFunction(init, sym, typeArg);
      return sym;
    }

    if (ts.isClassExpression(init)) {
      const sym = this.newSymbol(local, local, "class", decl);
      this.analyzeClass(init, sym);
      return sym;
    }

    if (ts.isCallExpression(init)) {
      const c = calleeName(init.expression);
      const fnName = c?.member ?? c?.name;
      if (fnName === "createContext") {
        return this.newSymbol(local, local, "context", decl);
      }
      if (c?.name === "axios" && c.member === "create") {
        const sym = this.newSymbol(local, local, "http-client", decl);
        const config = init.arguments[0] ? unwrap(init.arguments[0]) : undefined;
        let baseURL: string | null = null;
        if (config && ts.isObjectLiteralExpression(config)) {
          for (const p of config.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "baseURL" && ts.isStringLiteralLike(p.initializer)) baseURL = p.initializer.text;
          }
        }
        sym.httpClient = { baseURL };
        return sym;
      }
      if (fnName && LAZY_FACTORIES.has(fnName)) {
        const specifier = this.findImportSpecifier(init);
        if (specifier) {
          const sym = this.newSymbol(local, local, "lazy", decl);
          sym.lazy.push({ specifier, line: lineOf(this.sf, init) });
          return sym;
        }
      }
      return null;
    }

    if (ts.isObjectLiteralExpression(init)) {
      const hasFunctions = init.properties.some((p) => ts.isMethodDeclaration(p) || (ts.isPropertyAssignment(p) && isFunctionExpressionLike(unwrap(p.initializer))));
      if (!hasFunctions) return null;
      const sym = this.newSymbol(local, local, "object", decl);
      this.analyzeObject(init, sym);
      return sym;
    }
    return null;
  }

  private findImportSpecifier(node: ts.Node): string | null {
    let found: string | null = null;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        found = n.arguments[0].text;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  private analyzeObject(obj: ts.ObjectLiteralExpression, sym: RawSymbol): void {
    for (const prop of obj.properties) {
      let fn: ts.FunctionLikeDeclaration | undefined;
      let name: string | undefined;
      if (ts.isMethodDeclaration(prop) && prop.body) {
        fn = prop;
        name = prop.name.getText(this.sf);
      } else if (ts.isPropertyAssignment(prop) && isFunctionExpressionLike(unwrap(prop.initializer))) {
        fn = unwrap(prop.initializer) as ts.ArrowFunction;
        name = prop.name.getText(this.sf);
      }
      if (!fn || !name) continue;
      this.addMember(sym, name, prop, fn);
    }
  }

  private addMember(sym: RawSymbol, name: string, node: ts.Node, fn: ts.FunctionLikeDeclaration): void {
    const member: RawMember = { name, line: lineOf(this.sf, node), endLine: endLineOf(this.sf, node), isAsync: hasModifier(fn, ts.SyntaxKind.AsyncKeyword) };
    sym.members.push(member);
    if (fn.body) this.walkBody(fn.body, sym, this.newScope(), name);
  }

  private analyzeClass(cls: ts.ClassLikeDeclaration, sym: RawSymbol): void {
    const heritage = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    const base = heritage ? heritage.expression.getText(this.sf) : "";
    sym.isClassComponent = /^(React\.)?(Pure)?Component$/.test(base);

    if (sym.isClassComponent) {
      const propsType = heritage?.typeArguments?.[0];
      if (propsType) sym.props = this.membersOfType(propsType).map((m) => ({ name: m.name, type: m.type, optional: m.optional, line: m.line }));
    }

    for (const member of cls.members) {
      const name = member.name ? member.name.getText(this.sf) : undefined;
      if (!name) continue;
      if (sym.isClassComponent && (name === "componentDidCatch" || name === "getDerivedStateFromError")) sym.isErrorBoundary = true;

      if (sym.isClassComponent && ts.isPropertyDeclaration(member) && name === "state" && member.initializer) {
        const init = unwrap(member.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (p.name) sym.state.push({ name: p.name.getText(this.sf), hook: "this.state", initial: ts.isPropertyAssignment(p) ? truncate(redactSecrets(p.initializer.getText(this.sf)), 40) : undefined, line: lineOf(this.sf, p) });
          }
        }
      }

      let fn: ts.FunctionLikeDeclaration | undefined;
      if ((ts.isMethodDeclaration(member) || ts.isGetAccessor(member)) && member.body) fn = member;
      else if (ts.isPropertyDeclaration(member) && member.initializer && isFunctionExpressionLike(unwrap(member.initializer))) fn = unwrap(member.initializer) as ts.ArrowFunction;
      if (!fn) continue;

      if (sym.isClassComponent) {
        if (fn.body) {
          const scope = this.newScope();
          scope.props.add("props");
          this.walkBody(fn.body, sym, scope, undefined);
          if (name === "render" && containsJsx(fn.body)) sym.returnsJsx = true;
        }
      } else {
        this.addMember(sym, name, member, fn);
      }
    }
  }

  private analyzeFunction(fn: ts.FunctionLikeDeclaration, sym: RawSymbol, fallbackPropsType: ts.TypeNode | undefined): void {
    if (!fn.body) return;
    sym.isAsync = sym.isAsync || hasModifier(fn, ts.SyntaxKind.AsyncKeyword);
    sym.returnsJsx = containsJsx(fn.body);

    if (ts.isBlock(fn.body)) {
      const first = fn.body.statements[0];
      if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) sym.directives.push(first.expression.text);
    }

    const scope = this.newScope();
    const param = fn.parameters[0];
    if (param && /^[A-Z]/.test(sym.name)) {
      sym.props = this.extractProps(param, fallbackPropsType);
      for (const p of sym.props) scope.props.add(p.name);
      if (ts.isIdentifier(param.name)) scope.props.add(param.name.text);
    }
    this.walkBody(fn.body, sym, scope, undefined);
  }

  private extractProps(param: ts.ParameterDeclaration, fallback: ts.TypeNode | undefined): PropInfo[] {
    const typeNode = param.type ?? fallback;
    const typed = typeNode ? this.membersOfType(typeNode) : [];
    const byName = new Map(typed.map((m) => [m.name, m]));
    if (ts.isObjectBindingPattern(param.name)) {
      return param.name.elements.map((el) => {
        const name = el.dotDotDotToken ? `...${el.name.getText(this.sf)}` : (el.propertyName ?? el.name).getText(this.sf);
        const t = byName.get(name);
        return { name, type: t?.type, optional: !!el.initializer || (t?.optional ?? false), line: lineOf(this.sf, el) };
      });
    }
    return typed.map((m) => ({ name: m.name, type: m.type, optional: m.optional, line: m.line }));
  }

  private membersOfType(node: ts.TypeNode, depth = 0): TypeMember[] {
    if (depth > 4) return [];
    const sf = this.sf;
    const fromMembers = (members: ts.NodeArray<ts.TypeElement>): TypeMember[] =>
      members.filter(ts.isPropertySignature).map((m) => ({
        name: m.name.getText(sf),
        type: m.type ? truncate(m.type.getText(sf), 60) : undefined,
        optional: !!m.questionToken,
        line: lineOf(sf, m),
      }));
    if (ts.isTypeLiteralNode(node)) return fromMembers(node.members);
    if (ts.isIntersectionTypeNode(node)) return node.types.flatMap((t) => this.membersOfType(t, depth + 1));
    if (ts.isParenthesizedTypeNode(node)) return this.membersOfType(node.type, depth + 1);
    if (ts.isTypeReferenceNode(node)) {
      const ref = this.typeMembers.get(node.typeName.getText(sf));
      if (!ref) return [];
      if (ts.isInterfaceDeclaration(ref)) return fromMembers(ref.members);
      return this.membersOfType(ref, depth + 1);
    }
    return [];
  }

  // ---------------------------------------------------------------- bodies

  private newScope(): Scope {
    return { props: new Set(), setters: new Set(), localFns: new Map() };
  }

  /** Collects local functions, state and hook bindings declared at the top of a body. */
  private prepareScope(body: ts.ConciseBody, sym: RawSymbol, scope: Scope): void {
    if (!ts.isBlock(body)) return;
    for (const stmt of body.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) scope.localFns.set(stmt.name.text, stmt);
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer ? unwrap(decl.initializer) : undefined;
        if (!init) continue;
        if (ts.isIdentifier(decl.name) && isFunctionExpressionLike(init)) scope.localFns.set(decl.name.text, init);
        if (!ts.isCallExpression(init)) continue;
        const hook = hookNameOf(init);
        if (!hook) continue;
        // const save = useCallback(async () => {...}, [])
        if ((hook === "useCallback" || hook === "useMemo") && ts.isIdentifier(decl.name) && isFunctionExpressionLike(init.arguments[0] ? unwrap(init.arguments[0]) : undefined)) {
          scope.localFns.set(decl.name.text, unwrap(init.arguments[0]!) as ts.ArrowFunction);
          continue;
        }
        if (STATE_HOOKS.has(hook) && ts.isArrayBindingPattern(decl.name)) {
          const [valueEl, setterEl] = decl.name.elements;
          const value = valueEl && ts.isBindingElement(valueEl) ? valueEl.name.getText(this.sf) : "state";
          const setter = setterEl && ts.isBindingElement(setterEl) ? setterEl.name.getText(this.sf) : undefined;
          if (setter) scope.setters.add(setter);
          const initial = init.arguments[0];
          sym.state.push({ name: value, setter, hook, initial: initial ? truncate(redactSecrets(initial.getText(this.sf)), 40) : undefined, line: lineOf(this.sf, decl) } satisfies StateInfo);
          continue;
        }
        if (!BUILTIN_HOOKS.has(hook)) {
          if (ts.isIdentifier(decl.name)) sym.hookBindings[decl.name.text] = { hook };
          else if (ts.isObjectBindingPattern(decl.name)) {
            for (const el of decl.name.elements) {
              if (!ts.isIdentifier(el.name)) continue;
              const member = el.propertyName ? el.propertyName.getText(this.sf) : el.name.text;
              sym.hookBindings[el.name.text] = { hook, member };
            }
          } else if (ts.isArrayBindingPattern(decl.name)) {
            decl.name.elements.forEach((el, i) => {
              if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) sym.hookBindings[el.name.text] = { hook, member: `[${i}]` };
            });
          }
        }
      }
    }
  }

  private walkBody(body: ts.ConciseBody, sym: RawSymbol, scope: Scope, from: string | undefined): void {
    const sf = this.sf;
    this.prepareScope(body, sym, scope);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) this.onCall(node, sym, from);
      else if (ts.isTaggedTemplateExpression(node)) sym.db.push(...detectTaggedSql(node, sf).map((d) => ({ ...d, from })));
      else if (ts.isJsxSelfClosingElement(node)) this.onJsx(node, node, sym, scope);
      else if (ts.isJsxElement(node)) this.onJsx(node.openingElement, node, sym, scope);
      else if (ts.isConditionalExpression(node) && (isJsxExpr(node.whenTrue) || isJsxExpr(node.whenFalse))) sym.conditionalRenders++;
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && isJsxExpr(node.right)) sym.conditionalRenders++;
      else if (ts.isIfStatement(node) && containsReturnOfJsx(node.thenStatement)) sym.conditionalRenders++;
      ts.forEachChild(node, visit);
    };
    visit(body);
  }

  private onCall(call: ts.CallExpression, sym: RawSymbol, from: string | undefined): void {
    const sf = this.sf;
    const line = lineOf(sf, call);

    if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = call.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) sym.lazy.push({ specifier: arg.text, line });
      return;
    }

    const network = detectNetwork(call, sf);
    if (network) {
      sym.network.push({ ...network, from });
      return;
    }
    const db = detectDb(call, sf, this.prismaClients);
    if (db.length) {
      sym.db.push(...db.map((d) => ({ ...d, from })));
      return;
    }

    const hook = hookNameOf(call);
    if (hook) {
      if (!sym.hooks.includes(hook)) sym.hooks.push(hook);
      if ((hook === "useContext" || hook === "use") && call.arguments[0]) {
        const target = calleeName(call.arguments[0]);
        if (target) sym.contextUses.push({ name: target.name, member: target.member, line, from });
      }
      const c = calleeName(call.expression)!;
      if (!BUILTIN_HOOKS.has(hook) && hook !== "use") {
        // `hooks.useThing()` keeps the namespace so it can be resolved through the import.
        const namespaced = c.member !== undefined && c.name !== "React" && c.name !== "react";
        sym.hookCalls.push(namespaced ? { name: c.name, member: c.member, line, from } : { name: hook, line, from });
      }
      return;
    }

    const c = calleeName(call.expression);
    if (c && c.name !== "this" && c.name !== "console") sym.calls.push({ name: c.name, member: c.member, line, from });
  }

  private onJsx(opening: ts.JsxOpeningLikeElement, element: ts.JsxElement | ts.JsxSelfClosingElement, sym: RawSymbol, scope: Scope): void {
    const sf = this.sf;
    const tagExpr = opening.tagName;
    const tag = tagExpr.getText(sf);
    const line = lineOf(sf, opening);
    const intrinsic = ts.isIdentifier(tagExpr) && /^[a-z]/.test(tag);

    if (tag === "Suspense" || tag === "React.Suspense") sym.suspense = true;

    if (intrinsic) {
      const label = elementLabel(opening, element, sf);
      for (const attr of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) continue;
        const name = attr.name.getText(sf);
        const isEvent = /^on[A-Z]/.test(name) || ((name === "action" || name === "formAction") && !ts.isStringLiteralLike(attr.initializer.expression));
        if (!isEvent) continue;
        const expr = attr.initializer.expression;
        sym.events.push({
          event: name,
          element: tag,
          label,
          line: lineOf(sf, attr),
          handler: truncate(expr.getText(sf), 60),
          effects: this.effectsOf(expr, scope, new Set()),
        } satisfies RawEvent);
      }
      return;
    }

    if (/^[A-Za-z_$][\w$]*\.(Provider)$/.test(tag)) {
      sym.providesContext.push({ name: tag.split(".")[0]!, line });
      return;
    }
    if (/^[A-Za-z_$][\w$]*\.(Consumer)$/.test(tag)) {
      sym.contextUses.push({ name: tag.split(".")[0]!, line });
      return;
    }

    const callbackProps: CallbackProp[] = [];
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) continue;
      const expr = unwrap(attr.initializer.expression);
      const name = attr.name.getText(sf);
      const callbackName = /^on[A-Z]/.test(name) || name === "action" || name === "formAction";
      const isCallable =
        isFunctionExpressionLike(expr) ||
        (ts.isIdentifier(expr) && (callbackName || scope.localFns.has(expr.text) || scope.setters.has(expr.text))) ||
        (ts.isPropertyAccessExpression(expr) && callbackName);
      if (!isCallable) continue;
      callbackProps.push({ prop: name, handler: truncate(expr.getText(sf), 60), line: lineOf(sf, attr), effects: this.effectsOf(expr, scope, new Set()) });
    }

    const [root, ...rest] = tag.split(".");
    const label = ts.isJsxElement(element) && element.children.every((c) => ts.isJsxText(c)) ? elementLabel(opening, element, sf) : undefined;
    const render: RenderRef = { name: root!, member: rest.length ? rest.join(".") : undefined, line, callbackProps, label };
    sym.renders.push(render);
  }

  /** What invoking a handler expression does: calls, state updates, prop callbacks. */
  private effectsOf(expr: ts.Expression, scope: Scope, visited: Set<string>): Effects {
    const effects = emptyEffects();
    const sf = this.sf;

    const onCallee = (callee: ts.Expression, line: number) => {
      const e = unwrap(callee);
      if (ts.isIdentifier(e)) {
        const name = e.text;
        if (scope.setters.has(name)) pushUnique(effects.setters, name);
        else if (scope.props.has(name)) pushUnique(effects.propCalls, name);
        else if (scope.localFns.has(name)) {
          if (!visited.has(name)) {
            visited.add(name);
            merge(effects, this.effectsOfNode(scope.localFns.get(name)!.body!, scope, visited));
          }
        } else effects.calls.push({ name, line });
        return;
      }
      if (ts.isPropertyAccessExpression(e)) {
        const c = calleeName(e);
        if (!c) return;
        if (c.name === "props" && c.member && scope.props.has("props")) pushUnique(effects.propCalls, c.member.split(".")[0]!);
        else if (c.name !== "this" && c.name !== "console") effects.calls.push({ name: c.name, member: c.member, line });
      }
    };

    const e = unwrap(expr);
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) onCallee(e, lineOf(sf, e));
    else merge(effects, this.effectsOfNode(isFunctionExpressionLike(e) ? e.body : e, scope, visited));
    return effects;
  }

  private effectsOfNode(node: ts.Node, scope: Scope, visited: Set<string>): Effects {
    const effects = emptyEffects();
    const sf = this.sf;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        if (detectNetwork(n, sf)) effects.network.push(lineOf(sf, n));
        else {
          const sub = this.effectsOf(n.expression, scope, visited);
          merge(effects, sub);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return effects;
  }
}

interface Scope {
  props: Set<string>;
  setters: Set<string>;
  localFns: Map<string, ts.FunctionLikeDeclaration>;
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function merge(into: Effects, from: Effects): void {
  for (const c of from.calls) if (!into.calls.some((x) => x.name === c.name && x.member === c.member)) into.calls.push(c);
  for (const s of from.setters) pushUnique(into.setters, s);
  for (const p of from.propCalls) pushUnique(into.propCalls, p);
  for (const n of from.network) if (!into.network.includes(n)) into.network.push(n);
}

function containsReturnOfJsx(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return !!stmt.expression && isJsxExpr(stmt.expression);
  if (ts.isBlock(stmt)) return stmt.statements.some((s) => ts.isReturnStatement(s) && !!s.expression && isJsxExpr(s.expression));
  return false;
}

/** A human label for an element: aria-label, title, placeholder or its static text. */
function elementLabel(opening: ts.JsxOpeningLikeElement, element: ts.JsxElement | ts.JsxSelfClosingElement, sf: ts.SourceFile): string | undefined {
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
    const name = attr.name.getText(sf);
    if (["aria-label", "title", "placeholder", "alt"].includes(name) && ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  }
  if (ts.isJsxSelfClosingElement(element)) return undefined;
  const texts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = n.text.trim();
      if (t) texts.push(t);
    }
    ts.forEachChild(n, visit);
  };
  element.children.forEach(visit);
  const text = texts.join(" ").replace(/\s+/g, " ");
  return text ? truncate(text, 40) : undefined;
}

export interface ExtractInput {
  path: string;
  language: Language;
  text: string;
  bytes: number;
}

export function extractFile(input: ExtractInput): FileExtraction {
  const sf = ts.createSourceFile(input.path, input.text, ts.ScriptTarget.Latest, true, SCRIPT_KIND[input.language]);
  const diagnostics: Diagnostic[] = [];
  // parseDiagnostics is not part of the public type surface but is stable across TS releases.
  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  for (const d of parseDiagnostics.slice(0, 5)) {
    diagnostics.push({
      code: "parse-error",
      severity: "warning",
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      file: input.path,
      line: d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : undefined,
    });
  }

  const extractor = new FileExtractor(sf);
  extractor.run();

  return {
    path: input.path,
    language: input.language,
    hash: hashContent(input.text),
    bytes: input.bytes,
    loc: input.text.length === 0 ? 0 : input.text.split(/\r?\n/).length,
    directives: extractor.directives,
    imports: extractor.imports,
    exports: extractor.exports,
    symbols: extractor.symbols,
    parseErrors: parseDiagnostics.length,
    diagnostics,
  };
}
