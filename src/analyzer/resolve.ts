/**
 * Stage 4 — import resolution.
 *
 * A small, deterministic re-implementation of bundler-style resolution over
 * the set of discovered files: relative paths, tsconfig `paths` aliases,
 * `baseUrl`, extension probing, index files and `.js` → `.ts` remapping.
 * It never touches the file system, so it cannot escape the project root.
 */
import path from "node:path";
import { builtinModules } from "node:module";
import type { ResolutionConfig } from "./framework.ts";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const BUILTINS = new Set(builtinModules);

export interface ResolveOutcome {
  resolved: string | null;
  packageName: string | null;
  builtin: boolean;
}

export class ModuleResolver {
  private readonly files: Set<string>;
  private readonly config: ResolutionConfig;

  constructor(files: Iterable<string>, config: ResolutionConfig) {
    this.files = new Set(files);
    this.config = config;
  }

  resolve(specifier: string, fromFile: string): ResolveOutcome {
    if (specifier.startsWith("node:") || BUILTINS.has(specifier)) {
      return { resolved: null, packageName: specifier.startsWith("node:") ? specifier : `node:${specifier}`, builtin: true };
    }

    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
      return { resolved: target.startsWith("..") ? null : this.probe(target), packageName: null, builtin: false };
    }

    for (const alias of this.config.aliases) {
      const match = matchPattern(alias.pattern, specifier);
      if (match === null) continue;
      for (const target of alias.targets) {
        const candidate = this.probe(target.replace("*", match));
        if (candidate) return { resolved: candidate, packageName: null, builtin: false };
      }
    }

    if (this.config.baseUrl !== null) {
      const candidate = this.probe(path.posix.join(this.config.baseUrl, specifier));
      if (candidate) return { resolved: candidate, packageName: null, builtin: false };
    }

    if (specifier.startsWith("/")) return { resolved: null, packageName: null, builtin: false };
    return { resolved: null, packageName: packageNameOf(specifier), builtin: false };
  }

  private probe(target: string): string | null {
    const base = target.replace(/^\.\//, "").replace(/\/$/, "");
    if (this.files.has(base)) return base;
    for (const ext of EXTENSIONS) if (this.files.has(base + ext)) return base + ext;
    // ESM-style imports that name the emitted `.js` file while the source is `.ts`.
    const jsMatch = /\.(m|c)?jsx?$/.exec(base);
    if (jsMatch) {
      const stem = base.slice(0, -jsMatch[0].length);
      for (const ext of [".ts", ".tsx", ".mts", ".cts"]) if (this.files.has(stem + ext)) return stem + ext;
    }
    for (const ext of EXTENSIONS) if (this.files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    return null;
  }
}

function matchPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}
