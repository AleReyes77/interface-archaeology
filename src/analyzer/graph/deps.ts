/**
 * Stage 6 — file-level dependency metrics.
 *
 * All values are measured from the resolved import graph. Type-only imports
 * are excluded from cycle detection because they are erased at runtime.
 */
import type { DependencyMetrics, FileEdge } from "../types.ts";

export function computeDependencyMetrics(files: string[], edges: FileEdge[]): DependencyMetrics {
  const runtime = edges.filter((e) => e.kind !== "type");
  const out = new Map<string, Set<string>>(files.map((f) => [f, new Set()]));
  const inc = new Map<string, Set<string>>(files.map((f) => [f, new Set()]));
  for (const e of runtime) {
    out.get(e.from)?.add(e.to);
    inc.get(e.to)?.add(e.from);
  }

  const sccs = tarjan(files, out);
  const cycles = sccs
    .filter((c) => c.length > 1 || (c.length === 1 && out.get(c[0]!)?.has(c[0]!)))
    .map((c) => [...c].sort());

  // Height in the condensed DAG: longest chain of runtime dependencies below a file.
  const compOf = new Map<string, number>();
  sccs.forEach((c, i) => c.forEach((f) => compOf.set(f, i)));
  const compHeight = new Map<number, number>();
  // Tarjan emits SCCs in reverse topological order (dependencies first).
  sccs.forEach((c, i) => {
    let h = 0;
    for (const f of c) {
      for (const dep of out.get(f) ?? []) {
        const j = compOf.get(dep)!;
        if (j !== i) h = Math.max(h, (compHeight.get(j) ?? 0) + 1);
      }
    }
    compHeight.set(i, h);
  });
  const depthByFile: Record<string, number> = {};
  for (const f of files) depthByFile[f] = compHeight.get(compOf.get(f)!) ?? 0;

  const hubs = files
    .map((file) => ({ file, fanIn: inc.get(file)!.size, fanOut: out.get(file)!.size }))
    .filter((h) => h.fanIn + h.fanOut > 0)
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut) || a.file.localeCompare(b.file))
    .slice(0, 25);

  const isolated = files.filter((f) => inc.get(f)!.size === 0 && out.get(f)!.size === 0);

  return { cycles, hubs, isolated, maxDepth: Math.max(0, ...Object.values(depthByFile)), depthByFile };
}

/** Iterative Tarjan's strongly connected components (no recursion limits on large graphs). */
export function tarjan(nodes: string[], out: Map<string, Set<string>>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  for (const root of nodes) {
    if (indices.has(root)) continue;
    const work: { node: string; it: Iterator<string> }[] = [];
    const enter = (n: string) => {
      indices.set(n, index);
      low.set(n, index);
      index++;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, it: (out.get(n) ?? new Set<string>()).values() });
    };
    enter(root);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const next = frame.it.next();
      if (!next.done) {
        const w = next.value;
        if (!indices.has(w)) enter(w);
        else if (onStack.has(w)) low.set(frame.node, Math.min(low.get(frame.node)!, indices.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]!.node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === indices.get(frame.node)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== frame.node);
        result.push(comp);
      }
    }
  }
  return result;
}
