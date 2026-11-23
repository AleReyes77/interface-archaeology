import { describe, expect, it } from "vitest";
import { extractFile } from "@/analyzer/extract/file";

const extract = (text: string, path = "src/File.tsx") => extractFile({ path, language: path.endsWith("x") ? "tsx" : "ts", text, bytes: text.length });
const sym = (r: ReturnType<typeof extract>, name: string) => {
  const s = r.symbols.find((x) => x.local === name);
  if (!s) throw new Error(`symbol ${name} not extracted`);
  return s;
};

describe("extractFile: modules", () => {
  it("records static, type-only, dynamic, require and re-export imports", () => {
    const r = extract(`
      import React, { useState } from "react";
      import type { Doc } from "./types";
      import * as utils from "./utils";
      export { helper as aid } from "./helper";
      export * from "./barrel";
      const lazy = () => import("./Lazy");
      const fs = require("fs");
    `);
    const kinds = r.imports.map((i) => `${i.kind}:${i.specifier}`);
    expect(kinds).toEqual(expect.arrayContaining(["static:react", "type:./types", "static:./utils", "reexport:./helper", "reexport:./barrel", "dynamic:./Lazy", "require:fs"]));
    expect(r.imports.find((i) => i.specifier === "react")!.bindings).toEqual([
      { local: "React", imported: "default" },
      { local: "useState", imported: "useState" },
    ]);
    expect(r.imports.find((i) => i.specifier === "./utils")!.bindings).toEqual([{ local: "utils", imported: "*" }]);
    expect(r.exports).toEqual(expect.arrayContaining([expect.objectContaining({ exported: "aid", from: "./helper", imported: "helper" }), expect.objectContaining({ exported: "*", from: "./barrel" })]));
  });

  it("captures directives and default exports, including anonymous ones", () => {
    const r = extract(`"use client";\nexport default function () { return <div/>; }`, "app/settings/page.tsx");
    expect(r.directives).toEqual(["use client"]);
    expect(r.exports).toContainEqual(expect.objectContaining({ exported: "default", local: "default" }));
    expect(r.symbols[0]!.name).toBe("Page");
  });

  it("follows `export default memo(Component)` to the wrapped component", () => {
    const r = extract(`function Card() { return <div/>; }\nexport default memo(Card);`);
    expect(r.exports).toContainEqual(expect.objectContaining({ exported: "default", local: "Card" }));
  });

  it("counts parse errors without throwing", () => {
    const r = extract(`export function Broken( { return <div> }`);
    expect(r.parseErrors).toBeGreaterThan(0);
    expect(r.diagnostics[0]!.code).toBe("parse-error");
  });
});

describe("extractFile: React", () => {
  it("extracts props from a local interface, state, hooks, renders and conditionals", () => {
    const r = extract(`
      interface Props { title: string; onSave?: () => void }
      export function Editor({ title, onSave }: Props) {
        const [draft, setDraft] = useState("");
        const { save, status } = useSaveDocument();
        if (!title) return <Empty />;
        return <Panel>{status === "saving" ? <Spinner/> : null}{draft && <Preview text={draft} />}</Panel>;
      }
    `);
    const editor = sym(r, "Editor");
    expect(editor.returnsJsx).toBe(true);
    expect(editor.props).toEqual([
      expect.objectContaining({ name: "title", type: "string", optional: false }),
      expect.objectContaining({ name: "onSave", optional: true }),
    ]);
    expect(editor.state).toEqual([expect.objectContaining({ name: "draft", setter: "setDraft", hook: "useState", initial: '""' })]);
    expect(editor.hookCalls.map((h) => h.name)).toEqual(["useSaveDocument"]);
    expect(editor.hookBindings).toEqual({ save: { hook: "useSaveDocument", member: "save" }, status: { hook: "useSaveDocument", member: "status" } });
    expect(editor.renders.map((x) => x.name)).toEqual(expect.arrayContaining(["Empty", "Panel", "Spinner", "Preview"]));
    expect(editor.conditionalRenders).toBe(3);
  });

  it("resolves event handler effects through local functions, setters and props", () => {
    const r = extract(`
      export function Toolbar({ onFormat }: { onFormat: (m: string) => void }) {
        const [open, setOpen] = useState(false);
        const { save } = useSaveDocument();
        async function handleSave() { await save(); track("saved"); }
        return (
          <div>
            <button aria-label="Bold" onClick={() => onFormat("bold")} />
            <button onClick={handleSave}>Save now</button>
            <button onClick={() => setOpen(!open)}>Toggle</button>
          </div>
        );
      }
    `);
    const events = sym(r, "Toolbar").events;
    expect(events.map((e) => [e.event, e.element, e.label])).toEqual([
      ["onClick", "button", "Bold"],
      ["onClick", "button", "Save now"],
      ["onClick", "button", "Toggle"],
    ]);
    expect(events[0]!.effects.propCalls).toEqual(["onFormat"]);
    expect(events[1]!.effects.calls.map((c) => c.name)).toEqual(["save", "track"]);
    expect(events[2]!.effects.setters).toEqual(["setOpen"]);
  });

  it("records callback props passed to child components", () => {
    const r = extract(`
      export function Parent() {
        const [v, setV] = useState(0);
        function handle() { api.update(v); }
        return <Child onChange={setV} onCommit={handle} label="x" />;
      }
    `);
    const render = sym(r, "Parent").renders.find((x) => x.name === "Child")!;
    expect(render.callbackProps.map((c) => c.prop)).toEqual(["onChange", "onCommit"]);
    expect(render.callbackProps[0]!.effects.setters).toEqual(["setV"]);
    expect(render.callbackProps[1]!.effects.calls).toEqual([expect.objectContaining({ name: "api", member: "update" })]);
  });

  it("detects contexts, providers, consumers, lazy components and Suspense", () => {
    const r = extract(`
      export const ThemeContext = createContext(null);
      const Panel = lazy(() => import("./Panel"));
      export function ThemeProvider({ children }) {
        return <ThemeContext.Provider value={1}><Suspense fallback={null}><Panel/></Suspense>{children}</ThemeContext.Provider>;
      }
      export function useTheme() { return useContext(ThemeContext); }
    `);
    expect(sym(r, "ThemeContext").declKind).toBe("context");
    expect(sym(r, "Panel")).toMatchObject({ declKind: "lazy", lazy: [{ specifier: "./Panel" }] });
    expect(sym(r, "ThemeProvider")).toMatchObject({ suspense: true, providesContext: [expect.objectContaining({ name: "ThemeContext" })] });
    expect(sym(r, "useTheme").contextUses).toEqual([expect.objectContaining({ name: "ThemeContext" })]);
  });

  it("recognises class components and error boundaries", () => {
    const r = extract(`
      export class Boundary extends React.Component<{ fallback: string }> {
        state = { failed: false };
        static getDerivedStateFromError() { return { failed: true }; }
        render() { return this.state.failed ? <p>{this.props.fallback}</p> : this.props.children; }
      }
    `);
    expect(sym(r, "Boundary")).toMatchObject({ isClassComponent: true, isErrorBoundary: true, returnsJsx: true, props: [expect.objectContaining({ name: "fallback" })], state: [expect.objectContaining({ name: "failed", hook: "this.state" })] });
  });

  it("unwraps memo and forwardRef", () => {
    const r = extract(`export const Input = forwardRef((props, ref) => <input ref={ref} />);`);
    expect(sym(r, "Input")).toMatchObject({ declKind: "function", wrappers: ["forwardRef"], returnsJsx: true });
  });
});

describe("extractFile: network and data", () => {
  it("normalises fetch URLs, methods and bodies", () => {
    const r = extract(`
      export async function save(doc) {
        const res = await fetch(\`/api/docs/\${doc.id}?token=abc&v=1\`, { method: "put", body: JSON.stringify(doc) });
        if (!res.ok) throw new Error("x");
        return res.json();
      }
      export const list = () => fetch(process.env.API_URL + "/docs");
      export const dynamicCall = (u) => fetch(u);
    `, "src/api.ts");
    const [put] = sym(r, "save").network;
    expect(put).toMatchObject({ client: "fetch", method: "PUT", url: "/api/docs/:param?token=&v=", urlKind: "template", requestBody: "JSON.stringify(doc)", confidence: "detected" });
    expect(put!.responseHandling).toEqual(expect.arrayContaining(["parses JSON body", "checks response.ok", "throws on failure"]));
    expect(sym(r, "list").network[0]).toMatchObject({ method: "GET", url: "{env:API_URL}/docs" });
    expect(sym(r, "dynamicCall").network[0]).toMatchObject({ url: null, urlKind: "dynamic" });
  });

  it("detects axios calls, axios instances and ignores non-HTTP .get()", () => {
    const r = extract(`
      export const http = axios.create({ baseURL: "/api" });
      export function load(id) { return axios.post("/items", { id }); }
      export function viaClient(id) { return http.get(\`/items/\${id}\`); }
      export function notHttp(form) { return form.get("name") + params.get("q"); }
    `, "src/client.ts");
    expect(sym(r, "http")).toMatchObject({ declKind: "http-client", httpClient: { baseURL: "/api" } });
    expect(sym(r, "load").network[0]).toMatchObject({ client: "axios", method: "POST", url: "/items" });
    expect(sym(r, "viaClient").network[0]).toMatchObject({ client: "http-client", method: "GET", url: "/items/:param", via: "http", confidence: "inferred" });
    expect(sym(r, "notHttp").network).toEqual([]);
  });

  it("detects Prisma model operations and literal SQL", () => {
    const r = extract(`
      export class Repo {
        static find(id) { return prisma.user.findUnique({ where: { id } }); }
        static audit() { return db.query("INSERT INTO audit_log (event) VALUES ($1)", ["x"]); }
        static join() { return sql\`SELECT * FROM orders o JOIN users u ON u.id = o.user_id\`; }
      }
    `, "src/repo.ts");
    const repo = sym(r, "Repo");
    expect(repo.members.map((m) => m.name)).toEqual(["find", "audit", "join"]);
    expect(repo.db).toEqual([
      expect.objectContaining({ entity: "user", operation: "findUnique", client: "prisma", confidence: "detected", from: "find" }),
      expect.objectContaining({ entity: "audit_log", operation: "insert", client: "sql", from: "audit" }),
      expect.objectContaining({ entity: "orders", operation: "select", from: "join" }),
      expect.objectContaining({ entity: "users", operation: "select", from: "join" }),
    ]);
  });
});
