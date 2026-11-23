/**
 * Stage 1 — file discovery.
 *
 * Walks the project directory without following symlinks, never reads files
 * outside the project root, never reads `.env*` files, and enforces file-size
 * and file-count limits. Imported projects are treated as untrusted input.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnalysisLimits, Diagnostic, Language } from "./types.ts";
import { DEFAULT_LIMITS } from "./limits.ts";

export { DEFAULT_IGNORED_DIRECTORIES, DEFAULT_LIMITS } from "./limits.ts";

const SOURCE_EXTENSIONS: Record<string, Language> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
};

export interface DiscoveredFile {
  /** Project-relative POSIX path. */
  path: string;
  absolutePath: string;
  language: Language;
  bytes: number;
}

export interface DiscoveryResult {
  root: string;
  files: DiscoveredFile[];
  /** Project-relative paths of known config files that exist (package.json, tsconfig.json...). */
  configFiles: string[];
  /** Number of files that were seen but not analyzed (symlinks, env files, limits). */
  skipped: number;
  diagnostics: Diagnostic[];
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function languageOf(filePath: string): Language | null {
  if (filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts")) return null;
  return SOURCE_EXTENSIONS[path.extname(filePath).toLowerCase()] ?? null;
}

/**
 * Resolves `relative` against `root` and guarantees the result stays inside it.
 * Returns null for traversal attempts such as `../../etc/passwd`.
 */
export function resolveInside(root: string, relative: string): string | null {
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (rel === "") return absolute;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return absolute;
}

const CONFIG_FILE_NAMES = new Set(["package.json", "tsconfig.json", "jsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts", "vite.config.ts", "vite.config.js"]);

export async function discoverFiles(
  rootInput: string,
  limits: AnalysisLimits = DEFAULT_LIMITS,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  const root = await fs.realpath(rootInput);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${rootInput}`);

  const ignored = new Set(limits.ignoredDirectories);
  const files: DiscoveredFile[] = [];
  const configFiles: string[] = [];
  const diagnostics: Diagnostic[] = [];
  let skipped = 0;
  let limitReached = false;

  // Iterative DFS keeps stack depth bounded on deeply nested trees.
  const stack: string[] = [root];
  while (stack.length > 0) {
    signal?.throwIfAborted();
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        code: "read-error",
        severity: "warning",
        message: `Could not read directory: ${(error as Error).message}`,
        file: toPosix(path.relative(root, dir)) || ".",
      });
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = toPosix(path.relative(root, absolute));

      if (entry.isSymbolicLink()) {
        // Symlinks can point outside the project boundary; never follow them.
        diagnostics.push({ code: "symlink-skipped", severity: "info", message: "Symbolic link not followed", file: relative });
        skipped++;
        continue;
      }
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;

      if (entry.name.startsWith(".env")) {
        diagnostics.push({
          code: "env-file-skipped",
          severity: "info",
          message: "Environment file detected; its contents are never read",
          file: relative,
        });
        skipped++;
        continue;
      }

      if (CONFIG_FILE_NAMES.has(entry.name) && !relative.includes("/")) configFiles.push(relative);

      const language = languageOf(entry.name);
      if (!language) continue;

      if (files.length >= limits.maxFiles) {
        if (!limitReached) {
          diagnostics.push({
            code: "file-limit-reached",
            severity: "warning",
            message: `File limit of ${limits.maxFiles} reached; remaining files were not analyzed`,
          });
          limitReached = true;
        }
        skipped++;
        continue;
      }

      const fileStat = await fs.stat(absolute);
      if (fileStat.size > limits.maxFileBytes) {
        diagnostics.push({
          code: "file-too-large",
          severity: "warning",
          message: `Skipped: ${(fileStat.size / 1024).toFixed(0)} KB exceeds the ${(limits.maxFileBytes / 1024).toFixed(0)} KB limit`,
          file: relative,
        });
        skipped++;
        continue;
      }
      files.push({ path: relative, absolutePath: absolute, language, bytes: fileStat.size });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root, files, configFiles, skipped, diagnostics };
}

/** Returns true when the buffer looks like binary content (NUL byte in the first 8 KB). */
export function looksBinary(buffer: Uint8Array): boolean {
  const len = Math.min(buffer.length, 8192);
  for (let i = 0; i < len; i++) if (buffer[i] === 0) return true;
  return false;
}
