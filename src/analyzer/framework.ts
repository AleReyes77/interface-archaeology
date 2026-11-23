/**
 * Stage 2 — framework detection and project configuration.
 *
 * Reads package.json and tsconfig/jsconfig as data (JSON with comments).
 * Nothing from the analyzed project is ever executed.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { DiscoveredFile } from "./discover.ts";
import { resolveInside } from "./discover.ts";
import type { FrameworkInfo } from "./types.ts";

export interface PackageManifest {
  name?: string;
  dependencies: Record<string, string>;
}

export async function readPackageManifest(root: string): Promise<PackageManifest | null> {
  const file = resolveInside(root, "package.json");
  if (!file) return null;
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    const dependencies: Record<string, string> = {};
    for (const key of ["peerDependencies", "devDependencies", "dependencies"]) {
      const block = raw[key];
      if (block && typeof block === "object") {
        for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
          if (typeof version === "string") dependencies[name] = version;
        }
      }
    }
    return { name: typeof raw.name === "string" ? raw.name : undefined, dependencies };
  } catch {
    return null;
  }
}

/** Matches an App Router special file under `app/` or `src/app/`. */
export const APP_ROUTER_FILE = /^(?:src\/)?app\/(?:.*\/)?(page|layout|route|loading|error|not-found|template|default|global-error)\.(?:[cm]?[jt]sx?)$/;
/** Matches a Pages Router file under `pages/` or `src/pages/`. */
export const PAGES_ROUTER_FILE = /^(?:src\/)?pages\/.+\.(?:[cm]?[jt]sx?)$/;

export function detectFramework(manifest: PackageManifest | null, files: DiscoveredFile[], configFiles: string[]): FrameworkInfo {
  const deps = manifest?.dependencies ?? {};
  const signals: string[] = [];
  const tsFiles = files.filter((f) => f.language === "ts" || f.language === "tsx").length;
  const jsFiles = files.length - tsFiles;
  const language: FrameworkInfo["language"] = jsFiles === 0 ? "typescript" : tsFiles === 0 ? "javascript" : "mixed";

  const interesting = ["next", "react", "react-dom", "axios", "@tanstack/react-query", "swr", "@prisma/client", "drizzle-orm", "pg", "zustand", "redux", "@reduxjs/toolkit", "graphql", "@apollo/client", "react-router", "react-router-dom", "vite"];
  const packages: Record<string, string> = {};
  for (const name of interesting) if (deps[name]) packages[name] = deps[name];

  const hasNextConfig = configFiles.some((f) => f.startsWith("next.config."));
  const app = files.some((f) => APP_ROUTER_FILE.test(f.path));
  const pages = files.some((f) => PAGES_ROUTER_FILE.test(f.path));

  if (deps.next || hasNextConfig) {
    if (deps.next) signals.push(`package.json declares next@${deps.next}`);
    if (hasNextConfig) signals.push("next.config file present");
    if (app) signals.push("App Router conventions found (app/**/page, layout, route)");
    if (pages) signals.push("Pages Router directory found (pages/)");
    return {
      name: "nextjs",
      label: "Next.js",
      version: deps.next,
      router: { app, pages },
      signals,
      packages,
      language,
    };
  }

  const jsxFiles = files.filter((f) => f.language === "tsx" || f.language === "jsx").length;
  if (deps.react || jsxFiles > 0) {
    if (deps.react) signals.push(`package.json declares react@${deps.react}`);
    if (jsxFiles > 0) signals.push(`${jsxFiles} JSX/TSX files`);
    if (deps.vite) signals.push(`vite@${deps.vite}`);
    return { name: "react", label: deps.vite ? "React (Vite)" : "React", version: deps.react, signals, packages, language };
  }

  signals.push("No React or Next.js signals found; generic TypeScript/JavaScript analysis");
  return { name: "unknown", label: language === "javascript" ? "JavaScript" : "TypeScript", signals, packages, language };
}

export interface PathAlias {
  /** e.g. "@/*" */
  pattern: string;
  /** Project-relative POSIX targets, e.g. ["src/*"] */
  targets: string[];
}

export interface ResolutionConfig {
  /** Project-relative POSIX base directory for non-relative imports, or null. */
  baseUrl: string | null;
  aliases: PathAlias[];
}

/**
 * Reads compilerOptions.baseUrl / paths from tsconfig.json or jsconfig.json,
 * following a single relative `extends` that stays inside the project.
 */
export async function readResolutionConfig(root: string, configFiles: string[]): Promise<ResolutionConfig> {
  const name = configFiles.includes("tsconfig.json") ? "tsconfig.json" : configFiles.includes("jsconfig.json") ? "jsconfig.json" : null;
  if (!name) return { baseUrl: null, aliases: [] };

  const load = async (relative: string, depth: number): Promise<{ dir: string; options: Record<string, unknown> }> => {
    const absolute = resolveInside(root, relative);
    if (!absolute) return { dir: "", options: {} };
    let text: string;
    try {
      text = await fs.readFile(absolute, "utf8");
    } catch {
      return { dir: "", options: {} };
    }
    const parsed = ts.parseConfigFileTextToJson(absolute, text);
    const config = (parsed.config ?? {}) as { extends?: unknown; compilerOptions?: Record<string, unknown> };
    const dir = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative);
    let inherited: Record<string, unknown> = {};
    if (depth < 3 && typeof config.extends === "string" && config.extends.startsWith(".")) {
      let target = path.posix.normalize(path.posix.join(dir, config.extends));
      if (!target.endsWith(".json")) target += ".json";
      const base = await load(target, depth + 1);
      inherited = rebaseOptions(base.options, base.dir, dir);
    }
    return { dir, options: { ...inherited, ...(config.compilerOptions ?? {}) } };
  };

  const { dir, options } = await load(name, 0);
  const baseUrlRaw = typeof options.baseUrl === "string" ? options.baseUrl : null;
  const baseUrl = baseUrlRaw !== null ? normalizeRel(path.posix.join(dir, baseUrlRaw)) : null;
  // Since TS 4.1 `paths` resolve relative to the config file when baseUrl is absent.
  const pathsBase = baseUrl ?? dir;
  const aliases: PathAlias[] = [];
  const paths = options.paths;
  if (paths && typeof paths === "object") {
    for (const [pattern, targets] of Object.entries(paths as Record<string, unknown>)) {
      if (!Array.isArray(targets)) continue;
      aliases.push({
        pattern,
        targets: targets.filter((t): t is string => typeof t === "string").map((t) => normalizeRel(path.posix.join(pathsBase, t))),
      });
    }
  }
  return { baseUrl, aliases };
}

function normalizeRel(p: string): string {
  const n = path.posix.normalize(p);
  return n === "." ? "" : n.replace(/^\.\//, "").replace(/\/$/, "");
}

function rebaseOptions(options: Record<string, unknown>, fromDir: string, toDir: string): Record<string, unknown> {
  // Paths in an extended config are relative to that config; rewrite baseUrl so it stays correct.
  if (typeof options.baseUrl !== "string") return options;
  const absoluteRel = path.posix.join(fromDir, options.baseUrl);
  return { ...options, baseUrl: path.posix.relative(toDir || ".", absoluteRel) || "." };
}
