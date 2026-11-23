import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ANALYSIS_STAGES } from "@/analyzer/types";
import { repoLink, site } from "@/lib/site";
import { loadLandingData } from "./landing-data";
import styles from "./landing.module.css";

export const dynamic = "force-static";

export default async function LandingPage() {
  const data = await loadLandingData();
  const github = repoLink();
  const { stats } = data;

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand}>
          <Logo size={20} /> {site.name}
        </Link>
        <nav className={styles.navLinks} aria-label="Site">
          <a href="#how">How it works</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#open-source">Open source</a>
          {github ? <a href={github}>GitHub</a> : null}
          <Link href="/workspace" className="btn btn-sm">
            Open the app
          </Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <h1 className={styles.headline}>Understand the code beneath the interface.</h1>
            <p className={styles.lede}>Explore unfamiliar applications, trace component relationships, follow data flows, and uncover architectural dependencies without spending hours searching through files.</p>
            <div className={styles.ctas}>
              <Link href="/workspace/demo" className="btn btn-primary">
                Explore the demo
              </Link>
              {github ? (
                <a href={github} className="btn">
                  View on GitHub
                </a>
              ) : (
                <span className={`btn ${styles.unavailable}`} aria-disabled="true" title="Set NEXT_PUBLIC_REPOSITORY_URL to link the public repository">
                  View on GitHub (repository not published yet)
                </span>
              )}
            </div>
            <p className={styles.heroNote}>Runs locally. Reads your source, never executes it.</p>
          </div>

          <figure className={styles.section} aria-label="Cross-section of a real interaction">
            <div className={styles.surface}>
              <span className={styles.surfaceLabel}>The interface</span>
              <span className={styles.fakeButton} aria-hidden="true">
                Save
              </span>
            </div>
            <ol className={styles.layers}>
              {data.layers.map((l, i) => (
                <li key={i} className={styles.layer} style={{ "--i": i, "--kind": `var(--k-${l.kind})` } as React.CSSProperties}>
                  <span className={styles.layerName}>{l.layer}</span>
                  <span className={styles.layerCode}>
                    <span className={styles.layerSymbol}>{l.name}</span>
                    <span className={styles.layerLoc}>{l.location}</span>
                  </span>
                  {l.confidence === "inferred" ? (
                    <span className={styles.layerConf} title="Established by a heuristic (prop forwarding or URL matching)">
                      inferred
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            <figcaption className={styles.caption}>
              The {data.eventLabel} handler in <code>{data.ownerName}</code>, traced by the analyzer through the bundled sample project at build time.
            </figcaption>
          </figure>
        </section>

        <section className={styles.preview} aria-labelledby="preview-title">
          <div className={styles.previewHead}>
            <h2 id="preview-title" className={styles.h2}>
              One map of how the application fits together
            </h2>
            <p className={styles.body}>
              Pages, components, hooks, services, endpoints, route handlers and data stores, connected by the relationships found in the code. This image is the analyzer&apos;s SVG export of the sample project: {stats.files} files, {stats.relationships} relationships, {stats.inferred} of them marked as inferred.
            </p>
          </div>
          <div className={styles.previewFrame} dangerouslySetInnerHTML={{ __html: data.svg }} />
          <Link href="/workspace/demo" className={styles.previewLink}>
            Open this map interactively
          </Link>
        </section>

        <section id="capabilities" className={styles.features} aria-label="Capabilities">
          <Feature title="Explore the architecture" fact={`${stats.components} components, ${stats.hooks} hooks and ${stats.routes} route files mapped in the sample`}>
            A layered graph with pan, zoom, filters, folder grouping and focus mode. Select any element to see its file, props, state, hooks, event handlers and every relationship, each with the line of code it comes from.
          </Feature>
          <Feature title="Trace data flows" fact={`${stats.events} UI events traced in the sample`}>
            Follow a click from its handler, through props passed down from parent components, into hooks and services, across the network to the route handler and the data it touches. Where the code cannot be followed statically, the trace shows a gap instead of a guess.
          </Feature>
          <Feature title="Investigate API calls" fact={`${stats.endpoints} endpoints matched to their handlers`}>
            Every fetch and axios request with its method, normalised URL, calling function, request body and response handling, matched to the Next.js route handler that serves it.
          </Feature>
          <Feature title="Understand dependencies" fact="Cycles, depth, fan-in and isolated modules, measured">
            File-level import graphs with reverse dependencies, cycle detection and the longest import chains. Measurements and heuristics are labelled separately.
          </Feature>
          <Feature title="Predict modification impact" fact={data.impact ? `Changing ${data.impact.name} reaches ${data.impact.direct + data.impact.indirect} elements and ${data.impact.flows} user interactions` : "Reverse traversal of every relationship"}>
            Ask what might break before touching a component, hook or service. Dependents are grouped by distance, each with the chain of relationships that connects it.
          </Feature>
          <Feature title="Search and export" fact="Ctrl+K from anywhere; Markdown, JSON, Mermaid and SVG">
            A command palette over every component, file, route and endpoint. Export an architecture report for onboarding documents and pull requests.
          </Feature>
        </section>

        <section id="how" className={styles.how} aria-labelledby="how-title">
          <div>
            <h2 id="how-title" className={styles.h2}>
              How the analysis works
            </h2>
            <p className={styles.body}>A pipeline of static passes over the TypeScript syntax tree. The analyzed project is treated as untrusted input: no scripts, installs or builds, no reading outside the project folder, no following symlinks, and environment files are never opened.</p>
          </div>
          <ol className={styles.pipeline}>
            {ANALYSIS_STAGES.map((s, i) => (
              <li key={s.id}>
                <span className={styles.stageNum}>{i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
          <dl className={styles.support}>
            <div>
              <dt>Languages</dt>
              <dd>TypeScript, JavaScript, TSX, JSX</dd>
            </div>
            <div>
              <dt>Frameworks</dt>
              <dd>React (function and class components, hooks, context), Next.js App Router and Pages Router, route handlers, server actions, middleware</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>fetch, axios, axios instances</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>Prisma-style model calls, SQL in string literals</dd>
            </div>
            <div>
              <dt>Not yet</dt>
              <dd>Vue, Svelte, Angular, GraphQL documents, tRPC, runtime tracing</dd>
            </div>
          </dl>
        </section>

        <section id="open-source" className={styles.oss} aria-labelledby="oss-title">
          <h2 id="oss-title" className={styles.h2}>
            Open source, built to be extended
          </h2>
          <div className={styles.ossCols}>
            <p className={styles.body}>Interface Archaeology exists for the moment you inherit a codebase nobody documented. The analyzer is a standalone TypeScript module with its own CLI, so it can be used without the interface, in CI, or as the base for other tools.</p>
            <p className={styles.body}>Good first contributions: detectors for more HTTP clients and ORMs, support for React Router and Remix conventions, new export formats, and fixture projects that exercise edge cases. The roadmap and contribution guide live in the repository.</p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.brand}>
          <Logo /> {site.name}
        </span>
        <nav aria-label="Project links" className={styles.footerLinks}>
          {github ? (
            <>
              <a href={github}>GitHub</a>
              <a href={repoLink("/blob/main/README.md")!}>Documentation</a>
              <a href={repoLink("/blob/main/CONTRIBUTING.md")!}>Contributing</a>
              <a href={repoLink("/blob/main/LICENSE")!}>MIT License</a>
            </>
          ) : (
            <span className={styles.footerNote}>MIT License. Documentation, contribution guide and roadmap are in the repository (README.md, CONTRIBUTING.md, ROADMAP.md).</span>
          )}
        </nav>
      </footer>
    </div>
  );
}

function Feature({ title, fact, children }: { title: string; fact: string; children: React.ReactNode }) {
  return (
    <article className={styles.feature}>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.body}>{children}</p>
      <p className={styles.fact}>{fact}</p>
    </article>
  );
}
