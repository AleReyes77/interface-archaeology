/**
 * Command-line entry point for the analyzer.
 *
 *   npm run analyze -- <project-dir> [--format json|markdown|mermaid|summary] [--out file]
 *
 * Runs with Node's built-in TypeScript type stripping; no build step required.
 */
import { writeFile } from "node:fs/promises";
import { analyzeProject } from "../src/analyzer/pipeline.ts";
import { toMarkdown } from "../src/analyzer/export/markdown.ts";
import { toMermaid } from "../src/analyzer/export/mermaid.ts";
import { ANALYSIS_STAGES } from "../src/analyzer/types.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const target = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!target) {
  console.error("Usage: npm run analyze -- <project-dir> [--format json|markdown|mermaid|summary] [--out file]");
  process.exit(1);
}
const format = flag("--format") ?? "summary";

const result = await analyzeProject(target, {
  onProgress: (p) => process.stderr.write(`\r[${p.stageIndex + 1}/${p.stageCount}] ${ANALYSIS_STAGES[p.stageIndex]?.label}${p.total ? ` ${p.processed ?? 0}/${p.total}` : ""}      `),
});
process.stderr.write("\n");

let output: string;
switch (format) {
  case "json":
    output = JSON.stringify(result, null, 2);
    break;
  case "markdown":
    output = toMarkdown(result);
    break;
  case "mermaid":
    output = toMermaid(result);
    break;
  default: {
    const kinds = Object.entries(result.stats.nodesByKind).map(([k, v]) => `${k}: ${v}`).join(", ");
    output = [
      `${result.project.name} — ${result.framework.label}${result.framework.version ? ` ${result.framework.version}` : ""}`,
      `${result.stats.filesAnalyzed} files, ${result.stats.totalLoc} lines, analyzed in ${result.durationMs} ms`,
      `Nodes — ${kinds}`,
      `Edges: ${result.edges.length} (${result.edges.filter((e) => e.confidence === "inferred").length} inferred)`,
      `Routes: ${result.routes.length}, network calls: ${result.network.length}, dependency cycles: ${result.dependencies.cycles.length}`,
      `Diagnostics: ${result.diagnostics.length}`,
    ].join("\n");
  }
}

const out = flag("--out");
if (out) await writeFile(out, output, "utf8");
else process.stdout.write(`${output}\n`);
