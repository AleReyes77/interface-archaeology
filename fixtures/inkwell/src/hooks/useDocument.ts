"use client";
import { useEffect, useState } from "react";
import { documentsApi } from "@/lib/documents-api";
import type { Document } from "@/types";

export function useDocument(id: string) {
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    documentsApi
      .get(id)
      .then((doc) => {
        if (!cancelled) setDocument(doc);
      })
      .catch(setError);
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { document, error, setDocument };
}
