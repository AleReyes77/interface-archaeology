"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useWorkspace } from "@/lib/store";
import { Logo } from "../Logo";
import { activeNav, navHref, PROJECT_NAV, WORKSPACE_NAV, type NavItem } from "./nav";
import styles from "./shell.module.css";

export function Sidebar({ analysisId }: { analysisId: string }) {
  const pathname = usePathname();
  const collapsed = useWorkspace((s) => s.sidebarCollapsed);
  const toggle = useWorkspace((s) => s.toggleSidebar);
  const project = useWorkspace((s) => s.project);
  const result = useWorkspace((s) => s.result);
  const active = activeNav(pathname);

  const renderItem = (item: NavItem) => {
    const isActive = active?.id === item.id;
    const Icon = item.icon;
    return (
      <li key={item.id}>
        <Link href={navHref(analysisId, item)} className={styles.navItem} data-active={isActive || undefined} aria-current={isActive ? "page" : undefined} data-tooltip={collapsed ? item.label : undefined}>
          <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.navLabel}>{item.label}</span>
          {item.shortcut && !collapsed ? <span className={styles.navShortcut}>{item.shortcut}</span> : null}
        </Link>
      </li>
    );
  };

  return (
    <nav className={styles.sidebar} data-collapsed={collapsed || undefined} aria-label="Workspace navigation">
      <div className={styles.brand}>
        <Link href="/" className={styles.brandLink} aria-label="Interface Archaeology home">
          <Logo />
          <span className={styles.brandName}>Interface Archaeology</span>
        </Link>
      </div>

      <div className={styles.projectCard} title={project?.root}>
        <span className={styles.projectInitial} aria-hidden="true">
          {(project?.name ?? "?").replace(/^@[^/]+\//, "").charAt(0).toUpperCase()}
        </span>
        <span className={styles.projectText}>
          <span className={styles.projectName}>{project?.name ?? "Project"}</span>
          <span className={styles.projectMeta}>{result ? `${result.framework.label} · ${result.stats.filesAnalyzed} files` : "Loading"}</span>
        </span>
      </div>

      <div className={styles.navGroup}>
        <p className={styles.navHeading}>Workspace</p>
        <ul className={styles.navList}>{WORKSPACE_NAV.map(renderItem)}</ul>
      </div>
      <div className={styles.navGroup}>
        <p className={styles.navHeading}>Project</p>
        <ul className={styles.navList}>{PROJECT_NAV.map(renderItem)}</ul>
      </div>

      <div className={styles.sidebarFooter}>
        <button type="button" className={`btn btn-ghost btn-icon ${styles.collapseBtn}`} onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} data-tooltip={collapsed ? "Expand sidebar" : undefined}>
          {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.75} /> : <PanelLeftClose size={15} strokeWidth={1.75} />}
        </button>
      </div>
    </nav>
  );
}
