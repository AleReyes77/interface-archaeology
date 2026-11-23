/**
 * Captures the README screenshots from a production build.
 *
 *   npm run build && npm run screenshots
 *
 * Starts `next start` on a spare port with an isolated data directory,
 * captures the pages, and stops the server.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const PORT = 4312;
const base = `http://127.0.0.1:${PORT}`;
const out = "docs/screenshots";
await mkdir(out, { recursive: true });

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ia-shots-"));
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
  env: { ...process.env, IA_DATA_DIR: dataDir },
  stdio: "ignore",
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    if (i > 120) throw new Error("server did not start");
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(`${base}/`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/landing.png` });

const demo = await page.request.post(`${base}/api/demo`, { headers: { Origin: base } });
const { analysis } = (await demo.json()) as { analysis: { id: string } };
for (let i = 0; i < 80; i++) {
  const s = (await (await page.request.get(`${base}/api/analyses/${analysis.id}`)).json()) as { analysis: { status: string } };
  if (s.analysis.status === "completed") break;
  await page.waitForTimeout(250);
}
const ws = `${base}/workspace/${analysis.id}`;

await page.goto(`${ws}/map?node=${encodeURIComponent("sym:src/components/editor/DocumentEditor.tsx#DocumentEditor")}`);
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/architecture-map.png` });

await page.goto(`${ws}/flows?start=${encodeURIComponent("event:sym:src/components/editor/SaveButton.tsx#SaveButton@10:onClick")}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/flow-tracer.png` });

await page.goto(`${ws}/impact?node=${encodeURIComponent("sym:src/server/document-service.ts#DocumentService")}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/impact-analysis.png` });

await page.goto(`${ws}/components?node=${encodeURIComponent("sym:src/hooks/useSaveDocument.ts#useSaveDocument")}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/component-explorer.png` });

await browser.close();
server.kill();
console.log(`Screenshots written to ${out}/`);
