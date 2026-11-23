/**
 * Next.js routing conventions (App Router and Pages Router).
 * Detection is based on file location relative to an `app/` or `pages/`
 * directory at the project root or under `src/`.
 */
import type { RouteInfo } from "../types.ts";

export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const APP_FILE = /^(?:src\/)?app\/(?:(.*)\/)?(page|layout|route|loading|error|not-found|template|default|global-error)\.(?:[cm]?[jt]sx?)$/;
const PAGES_FILE = /^(?:src\/)?pages\/(.+)\.(?:[cm]?[jt]sx?)$/;
const MIDDLEWARE_FILE = /^(?:src\/)?(middleware|proxy)\.(?:[cm]?[jt]s)$/;

export interface RouteFile {
  router: "app" | "pages";
  kind: RouteInfo["kind"];
  path: string;
  dynamicSegments: string[];
  routeGroups: string[];
}

export function routePathFromSegments(segments: string[]): { path: string; dynamicSegments: string[]; routeGroups: string[] } {
  const parts: string[] = [];
  const dynamicSegments: string[] = [];
  const routeGroups: string[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    if (/^\(\.{1,3}\)/.test(seg)) continue; // intercepting routes
    if (/^\(.+\)$/.test(seg)) {
      routeGroups.push(seg);
      continue;
    }
    if (seg.startsWith("@")) continue; // parallel route slots
    if (/^\[.+\]$/.test(seg)) dynamicSegments.push(seg.replace(/^\[+\.{0,3}|\]+$/g, ""));
    parts.push(seg);
  }
  return { path: `/${parts.join("/")}`, dynamicSegments, routeGroups };
}

export function classifyRouteFile(file: string): RouteFile | null {
  const app = APP_FILE.exec(file);
  if (app) {
    const segments = (app[1] ?? "").split("/");
    const special = app[2]!;
    const kind: RouteInfo["kind"] =
      special === "route" ? "route-handler" : special === "global-error" ? "error" : (special as RouteInfo["kind"]);
    return { router: "app", kind, ...routePathFromSegments(segments) };
  }
  const pages = PAGES_FILE.exec(file);
  if (pages) {
    const rel = pages[1]!;
    const segments = rel.split("/");
    const last = segments[segments.length - 1];
    if (last === "index") segments.pop();
    if (last === "_app" || last === "_document") return { router: "pages", kind: "layout", path: "/", dynamicSegments: [], routeGroups: [] };
    if (last === "_error" || last === "404" || last === "500") return { router: "pages", kind: "error", path: "/", dynamicSegments: [], routeGroups: [] };
    const route = routePathFromSegments(segments);
    return { router: "pages", kind: segments[0] === "api" ? "api" : "page", ...route };
  }
  return null;
}

export function isMiddlewareFile(file: string): boolean {
  return MIDDLEWARE_FILE.test(file);
}

/**
 * Matches a request URL against a route pattern.
 * `/api/documents/:param` matches `/api/documents/[id]`; `[...slug]` matches the rest.
 */
export function routeMatches(url: string, routePath: string): boolean {
  const clean = url.split("?")[0]!.replace(/^https?:\/\/[^/]+/, "");
  if (!clean.startsWith("/")) return false;
  const a = clean.split("/").filter(Boolean);
  const b = routePath.split("/").filter(Boolean);
  for (let i = 0; i < b.length; i++) {
    const seg = b[i]!;
    if (/^\[\[?\.\.\./.test(seg)) return seg.startsWith("[[") ? true : a.length > i;
    const part = a[i];
    if (part === undefined) return false;
    if (/^\[.+\]$/.test(seg)) continue;
    if (part === ":param" || /^\{.+\}$/.test(part)) return false;
    if (part !== seg) return false;
  }
  return a.length === b.length;
}
