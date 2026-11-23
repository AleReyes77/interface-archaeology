import { DocumentService } from "@/server/document-service";
import { DocumentList } from "@/components/DocumentList";
import { NewDocumentButton } from "@/components/NewDocumentButton";

export default async function HomePage() {
  const documents = await DocumentService.list();
  return (
    <section>
      <h1>Documents</h1>
      <NewDocumentButton />
      <DocumentList documents={documents} />
    </section>
  );
}
