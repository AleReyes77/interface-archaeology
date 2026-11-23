"use client";
import { useCallback, useState } from "react";
import { documentsApi } from "@/lib/documents-api";
import type { Document } from "@/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSaveDocument() {
  const [status, setStatus] = useState<SaveStatus>("idle");

  const save = useCallback(async (doc: Document) => {
    setStatus("saving");
    try {
      const saved = await documentsApi.save(doc);
      setStatus("saved");
      return saved;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  return { save, status };
}
