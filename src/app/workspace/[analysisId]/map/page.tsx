"use client";

import { use } from "react";
import { ArchitectureMap } from "@/components/map/ArchitectureMap";

export default function MapPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const { node } = use(searchParams);
  return <ArchitectureMap initialNode={node ?? null} />;
}
