import {
  ArrowLeftRight,
  Boxes,
  FolderOpen,
  GitFork,
  History,
  LayoutGrid,
  Network,
  Radar,
  Settings2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  /** Path segment under /workspace/[analysisId]; null for the workspace hub. */
  segment: string | null;
  icon: LucideIcon;
  shortcut?: string;
}

export const WORKSPACE_NAV: NavItem[] = [
  { id: "overview", label: "Overview", segment: "", icon: LayoutGrid, shortcut: "G O" },
  { id: "map", label: "Architecture map", segment: "map", icon: Network, shortcut: "G M" },
  { id: "components", label: "Components", segment: "components", icon: Boxes, shortcut: "G C" },
  { id: "flows", label: "Data flows", segment: "flows", icon: Waypoints, shortcut: "G F" },
  { id: "dependencies", label: "Dependencies", segment: "dependencies", icon: GitFork, shortcut: "G D" },
  { id: "api", label: "API explorer", segment: "api", icon: ArrowLeftRight, shortcut: "G A" },
  { id: "impact", label: "Impact analysis", segment: "impact", icon: Radar, shortcut: "G I" },
];

export const PROJECT_NAV: NavItem[] = [
  { id: "project", label: "Projects", segment: null, icon: FolderOpen },
  { id: "history", label: "Analysis history", segment: "history", icon: History },
  { id: "settings", label: "Settings", segment: "settings", icon: Settings2 },
];

export function navHref(analysisId: string, item: NavItem): string {
  if (item.segment === null) return "/workspace";
  return item.segment ? `/workspace/${analysisId}/${item.segment}` : `/workspace/${analysisId}`;
}

export function activeNav(pathname: string): NavItem | undefined {
  const segment = pathname.split("/")[3] ?? "";
  return [...WORKSPACE_NAV, ...PROJECT_NAV].find((n) => n.segment === segment);
}
