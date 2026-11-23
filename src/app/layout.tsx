import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@xyflow/react/dist/base.css";
import "@/styles/tokens.css";
import "@/styles/base.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Interface Archaeology", template: "%s · Interface Archaeology" },
  description: "Understand the code beneath the interface. Static analysis and interactive architecture maps for React and Next.js codebases.",
};

export const viewport: Viewport = { themeColor: "#141518", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
