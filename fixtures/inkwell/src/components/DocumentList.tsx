import Link from "next/link";
import { formatDate, excerpt } from "@/lib/format";
import type { Document } from "@/types";

interface DocumentListProps {
  documents: Document[];
  emptyLabel?: string;
}

export function DocumentList({ documents, emptyLabel = "No documents yet" }: DocumentListProps) {
  if (documents.length === 0) return <p>{emptyLabel}</p>;
  return (
    <ul className="document-list">
      {documents.map((doc) => (
        <li key={doc.id}>
          <Link href={`/documents/${doc.id}`}>{doc.title}</Link>
          <time>{formatDate(doc.updatedAt)}</time>
          <p>{excerpt(doc.body)}</p>
        </li>
      ))}
    </ul>
  );
}
