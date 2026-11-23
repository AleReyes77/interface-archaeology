"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import states from "@/components/states.module.css";

/** Entry point for "Explore the demo": analyzes the bundled sample with the real engine. */
export default function DemoPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .openDemo()
      .then(({ analysis }) => router.replace(`/workspace/${analysis.id}/map`))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <div className={states.center}>
      {error ? (
        <div className={states.messageCard}>
          <h1 className={states.title}>The sample project could not be opened</h1>
          <p className={states.code}>{error}</p>
          <Link className="btn" href="/workspace">
            Back to projects
          </Link>
        </div>
      ) : (
        <p className="muted">Opening the sample project…</p>
      )}
    </div>
  );
}
