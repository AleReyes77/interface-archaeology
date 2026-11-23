/** Default analysis limits. Pure module: safe to import from browser code. */
import type { AnalysisLimits } from "./types.ts";

export const DEFAULT_IGNORED_DIRECTORIES = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".cache",
  ".output",
  ".svelte-kit",
  "dist",
  "build",
  "out",
  "coverage",
  "storybook-static",
];

export const DEFAULT_LIMITS: AnalysisLimits = {
  maxFiles: 5000,
  maxFileBytes: 1_000_000,
  ignoredDirectories: DEFAULT_IGNORED_DIRECTORIES,
};
