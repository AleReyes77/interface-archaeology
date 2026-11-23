import { describe, expect, it } from "vitest";
import { ModuleResolver, packageNameOf } from "@/analyzer/resolve";
import { classifyRouteFile, routeMatches, isMiddlewareFile } from "@/analyzer/graph/routes";

const files = ["src/lib/api.ts", "src/components/index.tsx", "src/components/Button.tsx", "src/utils/format.ts", "lib/legacy.js"];

describe("ModuleResolver", () => {
  const resolver = new ModuleResolver(files, { baseUrl: ".", aliases: [{ pattern: "@/*", targets: ["src/*"] }] });

  it("resolves relative imports with extension probing and index files", () => {
    expect(resolver.resolve("./Button", "src/components/Card.tsx").resolved).toBe("src/components/Button.tsx");
    expect(resolver.resolve("../components", "src/lib/api.ts").resolved).toBe("src/components/index.tsx");
    expect(resolver.resolve("../utils/format.js", "src/lib/api.ts").resolved).toBe("src/utils/format.ts");
  });

  it("resolves tsconfig path aliases and baseUrl", () => {
    expect(resolver.resolve("@/lib/api", "src/components/Button.tsx").resolved).toBe("src/lib/api.ts");
    expect(resolver.resolve("lib/legacy", "src/components/Button.tsx").resolved).toBe("lib/legacy.js");
  });

  it("classifies packages and Node built-ins", () => {
    expect(resolver.resolve("@tanstack/react-query/devtools", "src/a.ts")).toMatchObject({ resolved: null, packageName: "@tanstack/react-query" });
    expect(resolver.resolve("fs", "src/a.ts")).toMatchObject({ packageName: "node:fs", builtin: true });
    expect(resolver.resolve("node:path", "src/a.ts")).toMatchObject({ packageName: "node:path", builtin: true });
  });

  it("never resolves outside the project", () => {
    expect(resolver.resolve("../../../etc/passwd", "src/lib/api.ts").resolved).toBeNull();
  });

  it("extracts package names", () => {
    expect(packageNameOf("lodash/merge")).toBe("lodash");
    expect(packageNameOf("@scope/pkg/sub")).toBe("@scope/pkg");
  });
});

describe("Next.js route conventions", () => {
  it("maps App Router files to URL paths, ignoring route groups and slots", () => {
    expect(classifyRouteFile("src/app/(marketing)/about/page.tsx")).toMatchObject({ router: "app", kind: "page", path: "/about", routeGroups: ["(marketing)"] });
    expect(classifyRouteFile("app/page.tsx")).toMatchObject({ kind: "page", path: "/" });
    expect(classifyRouteFile("app/shop/[...slug]/page.tsx")).toMatchObject({ path: "/shop/[...slug]", dynamicSegments: ["slug"] });
    expect(classifyRouteFile("app/@modal/login/page.tsx")).toMatchObject({ path: "/login" });
    expect(classifyRouteFile("app/api/items/[id]/route.ts")).toMatchObject({ kind: "route-handler", path: "/api/items/[id]" });
    expect(classifyRouteFile("app/global-error.tsx")).toMatchObject({ kind: "error" });
    expect(classifyRouteFile("src/components/page.tsx")).toBeNull();
  });

  it("maps Pages Router files", () => {
    expect(classifyRouteFile("pages/index.tsx")).toMatchObject({ router: "pages", kind: "page", path: "/" });
    expect(classifyRouteFile("pages/api/users/[id].ts")).toMatchObject({ kind: "api", path: "/api/users/[id]" });
    expect(classifyRouteFile("pages/_app.tsx")).toMatchObject({ kind: "layout" });
  });

  it("recognises middleware and proxy files", () => {
    expect(isMiddlewareFile("src/middleware.ts")).toBe(true);
    expect(isMiddlewareFile("proxy.ts")).toBe(true);
    expect(isMiddlewareFile("src/lib/middleware.ts")).toBe(false);
  });

  it("matches request URLs to route patterns", () => {
    expect(routeMatches("/api/items/:param", "/api/items/[id]")).toBe(true);
    expect(routeMatches("/api/items/42", "/api/items/[id]")).toBe(true);
    expect(routeMatches("/api/items", "/api/items/[id]")).toBe(false);
    expect(routeMatches("/api/items/:param/comments", "/api/items/[id]")).toBe(false);
    expect(routeMatches("/docs/a/b/c", "/docs/[...slug]")).toBe(true);
    expect(routeMatches("/docs", "/docs/[[...slug]]")).toBe(true);
    expect(routeMatches("/api/:param", "/api/health")).toBe(false);
    expect(routeMatches("{env:API}/items", "/items")).toBe(false);
    expect(routeMatches("/api/items?page=", "/api/items")).toBe(true);
  });
});
