"use client";
import { useRouter } from "next/navigation";
import { documentsApi } from "@/lib/documents-api";

export function NewDocumentButton() {
  const router = useRouter();

  async function handleCreate() {
    const doc = await documentsApi.create("Untitled");
    router.push(`/documents/${doc.id}`);
  }

  return (
    <button type="button" className="primary" onClick={handleCreate}>
      New document
    </button>
  );
}
