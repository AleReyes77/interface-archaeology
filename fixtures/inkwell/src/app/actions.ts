"use server";
import { DocumentService } from "@/server/document-service";

export async function archiveDocument(formData: FormData) {
  const id = String(formData.get("id"));
  await DocumentService.archive(id);
}
