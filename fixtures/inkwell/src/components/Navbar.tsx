"use client";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { UserMenu } from "./UserMenu";

export function Navbar() {
  const { theme, toggle } = useTheme();
  return (
    <header className="navbar">
      <Link href="/">Inkwell</Link>
      <button type="button" aria-label="Toggle theme" onClick={toggle}>
        {theme === "light" ? "Dark" : "Light"}
      </button>
      <UserMenu />
    </header>
  );
}
