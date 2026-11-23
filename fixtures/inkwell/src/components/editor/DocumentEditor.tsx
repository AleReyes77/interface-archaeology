"use client";
import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { useDocument } from "@/hooks/useDocument";
import { useSaveDocument } from "@/hooks/useSaveDocument";
import { EditorToolbar } from "./EditorToolbar";
import { DocumentBody } from "./DocumentBody";
import { SaveButton } from "./SaveButton";
import { ErrorBoundary } from "../ErrorBoundary";

const CommentsPanel = dynamic(() => import("../comments/CommentsPanel"), { ssr: false });

interface DocumentEditorProps {
  documentId: string;
}

export function DocumentEditor({ documentId }: DocumentEditorProps) {
  const { document, error } = useDocument(documentId);
  const { save, status } = useSaveDocument();
  const [draft, setDraft] = useState("");
  const [showComments, setShowComments] = useState(false);

  if (error) return <p role="alert">Could not load the document.</p>;
  if (!document) return <p>Loading…</p>;

  async function handleSave() {
    if (!document) return;
    await save({ ...document, body: draft || document.body });
  }

  function handleFormat(mark: "bold" | "italic") {
    setDraft((current) => (mark === "bold" ? `**${current}**` : `_${current}_`));
  }

  return (
    <ErrorBoundary fallback={<p>The editor crashed.</p>}>
      <EditorToolbar documentId={document.id} onFormat={handleFormat} />
      <DocumentBody value={draft || document.body} onChange={setDraft} />
      <SaveButton onSave={handleSave} saving={status === "saving"} />
      <button type="button" onClick={() => setShowComments((v) => !v)}>
        Comments
      </button>
      {showComments ? (
        <Suspense fallback={<p>Loading comments…</p>}>
          <CommentsPanel documentId={document.id} />
        </Suspense>
      ) : null}
    </ErrorBoundary>
  );
}
