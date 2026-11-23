/**
 * Detection of network requests (fetch, axios, axios-like clients) and
 * database access (Prisma-style model calls, literal SQL) in call expressions.
 */
import ts from "typescript";
import { redactSecrets, redactUrl } from "../redact.ts";
import type { RawDb, RawNetwork } from "./types.ts";

const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

const PRISMA_OPS = new Set([
  "findMany", "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert",
  "delete", "deleteMany", "count", "aggregate", "groupBy",
]);

const SQL_CALLEES = new Set(["query", "execute", "raw", "$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe", "prepare", "exec", "all", "run"]);
const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i;

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function truncate(text: string, max = 80): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

/** `process.env.API_URL` → "API_URL" */
function envName(expr: ts.Expression): string | null {
  const e = unwrap(expr);
  if (ts.isPropertyAccessExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const inner = e.expression;
    if (ts.isIdentifier(inner.expression) && inner.expression.text === "process" && inner.name.text === "env") return e.name.text;
  }
  if (ts.isPropertyAccessExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "env") {
    // import.meta.env.VITE_API
    const meta = e.expression.expression;
    if (ts.isMetaProperty(meta)) return e.name.text;
  }
  return null;
}

function placeholder(expr: ts.Expression, atStart: boolean, sf: ts.SourceFile): string {
  const env = envName(expr);
  if (env) return `{env:${env}}`;
  if (atStart) return `{${truncate(expr.getText(sf), 32)}}`;
  return ":param";
}

/** Converts a URL expression into a normalised pattern, or null when it is fully dynamic. */
export function urlPattern(expr: ts.Expression, sf: ts.SourceFile): { url: string | null; kind: RawNetwork["urlKind"] } {
  const parts = (e: ts.Expression, atStart: boolean): string | null => {
    const x = unwrap(e);
    if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text;
    if (ts.isTemplateExpression(x)) {
      let out = x.head.text;
      x.templateSpans.forEach((span, i) => {
        out += placeholder(span.expression, atStart && i === 0 && x.head.text === "", sf) + span.literal.text;
      });
      return out;
    }
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = parts(x.left, atStart) ?? placeholder(x.left, atStart, sf);
      const right = parts(x.right, false) ?? placeholder(x.right, false, sf);
      return left + right;
    }
    if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "URL" && x.arguments?.[0]) {
      return parts(x.arguments[0], atStart);
    }
    return null;
  };
  const text = parts(expr, true);
  if (text === null) return { url: null, kind: "dynamic" };
  const isTemplate = text.includes(":param") || text.includes("{");
  return { url: normalizeUrl(text), kind: isTemplate ? "template" : "literal" };
}

export function normalizeUrl(raw: string): string {
  let url = raw.trim();
  const query = url.indexOf("?");
  if (query !== -1) {
    const names = url
      .slice(query + 1)
      .split("&")
      .map((p) => p.split("=")[0])
      .filter(Boolean);
    url = url.slice(0, query) + (names.length ? `?${names.map((n) => `${n}=`).join("&")}` : "");
  }
  url = url.replace(/([^:])\/{2,}/g, "$1/");
  if (url.length > 1 && url.endsWith("/") && !url.includes("?")) url = url.slice(0, -1);
  return redactUrl(url);
}

function objectProperty(obj: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!obj) return undefined;
  const o = unwrap(obj);
  if (!ts.isObjectLiteralExpression(o)) return undefined;
  for (const prop of o.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name) && prop.name.text === name) return prop.initializer;
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) return prop.name;
  }
  return undefined;
}

function methodFrom(expr: ts.Expression | undefined, fallback: string): string {
  if (!expr) return fallback;
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.toUpperCase();
  return "UNKNOWN";
}

const RESPONSE_PATTERNS: [RegExp, string][] = [
  [/\.json\(\)/, "parses JSON body"],
  [/\.ok\b/, "checks response.ok"],
  [/\.status\b/, "checks status code"],
  [/\.data\b/, "reads response data"],
  [/\.then\(/, "promise chain (.then)"],
  [/\bcatch\b/, "handles errors (catch)"],
  [/\bthrow\b/, "throws on failure"],
];

function responseHandling(call: ts.CallExpression, sf: ts.SourceFile): string[] {
  let fn: ts.Node | undefined = call.parent;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  const scope = fn ?? call.parent;
  const text = scope.getText(sf);
  return RESPONSE_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** Recognises a network request. `from` is filled in by the caller. */
export function detectNetwork(call: ts.CallExpression, sf: ts.SourceFile): RawNetwork | null {
  const callee = unwrap(call.expression);
  const args = call.arguments;
  const line = lineOf(sf, call);

  const build = (client: RawNetwork["client"], method: string, urlExpr: ts.Expression | undefined, bodyExpr: ts.Expression | undefined, confidence: RawNetwork["confidence"], via?: string): RawNetwork => {
    const { url, kind } = urlExpr ? urlPattern(urlExpr, sf) : { url: null, kind: "dynamic" as const };
    return {
      client,
      method,
      url,
      rawUrl: urlExpr ? redactUrl(truncate(urlExpr.getText(sf), 120)) : "(none)",
      urlKind: kind,
      line,
      confidence,
      via,
      requestBody: bodyExpr ? redactSecrets(truncate(bodyExpr.getText(sf))) : undefined,
      responseHandling: responseHandling(call, sf),
    };
  };

  // fetch(url, init) / window.fetch / globalThis.fetch
  const isFetch =
    (ts.isIdentifier(callee) && callee.text === "fetch") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch" && ts.isIdentifier(callee.expression) && ["window", "globalThis", "self"].includes(callee.expression.text));
  if (isFetch) {
    const init = args[1];
    return build("fetch", methodFrom(objectProperty(init, "method"), "GET"), args[0], objectProperty(init, "body"), "detected");
  }

  // axios(config) / axios(url, config)
  if (ts.isIdentifier(callee) && callee.text === "axios") {
    const first = args[0] ? unwrap(args[0]) : undefined;
    if (first && ts.isObjectLiteralExpression(first)) {
      return build("axios", methodFrom(objectProperty(first, "method"), "GET"), objectProperty(first, "url"), objectProperty(first, "data"), "detected");
    }
    return build("axios", methodFrom(objectProperty(args[1], "method"), "GET"), args[0], objectProperty(args[1], "data"), "detected");
  }

  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const object = callee.expression.text;
    const verb = callee.name.text;
    if (object === "axios" && (HTTP_VERBS.has(verb) || verb === "request")) {
      if (verb === "request") {
        return build("axios", methodFrom(objectProperty(args[0], "method"), "GET"), objectProperty(args[0], "url"), objectProperty(args[0], "data"), "detected");
      }
      const hasBody = verb === "post" || verb === "put" || verb === "patch";
      return build("axios", verb.toUpperCase(), args[0], hasBody ? args[1] : undefined, "detected");
    }
    // client.get('/path') — only when the first argument looks like a URL path,
    // which filters out Map#get, FormData#get, URLSearchParams#get, etc.
    if (HTTP_VERBS.has(verb) && args[0]) {
      const { url } = urlPattern(args[0], sf);
      if (url !== null && /^(?:\/|https?:|\{)/.test(url)) {
        const hasBody = verb === "post" || verb === "put" || verb === "patch";
        return build("http-client", verb.toUpperCase(), args[0], hasBody ? args[1] : undefined, "inferred", object);
      }
    }
  }
  return null;
}

function sqlText(expr: ts.Expression | undefined): string | null {
  if (!expr) return null;
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => ` ? ${s.literal.text}`).join("");
  return null;
}

export function sqlAccess(sql: string, line: number): RawDb[] {
  if (!SQL_START.test(sql)) return [];
  const operation = (SQL_START.exec(sql)?.[1] ?? "query").toLowerCase();
  const tables = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+["`[]?([A-Za-z_][\w.]*)["`\]]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) if (m[1] && !/^(SELECT|SET|VALUES)$/i.test(m[1])) tables.add(m[1]);
  return [...tables].map((entity) => ({ entity, operation, client: "sql" as const, line, confidence: "detected" as const }));
}

/** Recognises Prisma-style `client.model.op()` calls and SQL passed as a literal. */
export function detectDb(call: ts.CallExpression, sf: ts.SourceFile, prismaClients: Set<string>): RawDb[] {
  const callee = unwrap(call.expression);
  const line = lineOf(sf, call);

  if (ts.isPropertyAccessExpression(callee)) {
    const op = callee.name.text;
    const model = callee.expression;
    if (PRISMA_OPS.has(op) && ts.isPropertyAccessExpression(model)) {
      const clientExpr = model.expression;
      const clientName = ts.isIdentifier(clientExpr)
        ? clientExpr.text
        : ts.isPropertyAccessExpression(clientExpr)
          ? clientExpr.name.text
          : null;
      if (clientName) {
        const known = clientName === "prisma" || prismaClients.has(clientName);
        const plausible = /^(db|client|orm|database)$/i.test(clientName);
        if (known || plausible) {
          return [{ entity: model.name.text, operation: op, client: "prisma", line, confidence: known ? "detected" : "inferred" }];
        }
      }
    }
    if (SQL_CALLEES.has(op)) {
      const sql = sqlText(call.arguments[0]);
      if (sql) return sqlAccess(sql, line);
    }
  }
  if (ts.isIdentifier(callee) && SQL_CALLEES.has(callee.text)) {
    const sql = sqlText(call.arguments[0]);
    if (sql) return sqlAccess(sql, line);
  }
  return [];
}

export function detectTaggedSql(node: ts.TaggedTemplateExpression, sf: ts.SourceFile): RawDb[] {
  const tag = unwrap(node.tag);
  const tagName = ts.isIdentifier(tag) ? tag.text : ts.isPropertyAccessExpression(tag) ? tag.name.text : "";
  if (!/^(sql|\$queryRaw|\$executeRaw)$/.test(tagName)) return [];
  const t = node.template;
  const text = ts.isNoSubstitutionTemplateLiteral(t) ? t.text : t.head.text + t.templateSpans.map((s) => ` ? ${s.literal.text}`).join("");
  return sqlAccess(text, lineOf(sf, node));
}
