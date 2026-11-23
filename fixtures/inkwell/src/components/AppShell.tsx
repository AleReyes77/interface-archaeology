import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Navbar />
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}
