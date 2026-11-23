"use client";
import { archiveDocument } from "@/app/actions";

interface EditorToolbarProps {
  documentId: string;
  onFormat: (mark: "bold" | "italic") => void;
}

export function EditorToolbar({ documentId, onFormat }: EditorToolbarProps) {
  return (
    <div role="toolbar" className="toolbar">
      <button type="button" onClick={() => onFormat("bold")}>
        Bold
      </button>
      <button type="button" onClick={() => onFormat("italic")}>
        Italic
      </button>
      <form action={archiveDocument}>
        <input type="hidden" name="id" value={documentId} />
        <button type="submit">Archive</button>
      </form>
    </div>
  );
}
