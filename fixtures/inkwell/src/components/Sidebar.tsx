import Link from "next/link";
import { DocumentService } from "@/server/document-service";

export async function Sidebar() {
  const documents = await DocumentService.list();
  return (
    <nav className="sidebar">
      {documents.map((doc) => (
        <Link key={doc.id} href={`/documents/${doc.id}`}>
          {doc.title}
        </Link>
      ))}
    </nav>
  );
}
