import { http } from "./api-client";
import type { Comment } from "@/types";

export async function fetchComments(documentId: string): Promise<Comment[]> {
  const { data } = await http.get<Comment[]>(`/documents/${documentId}/comments`);
  return data;
}

export async function postComment(documentId: string, text: string): Promise<void> {
  await http.post(`/documents/${documentId}/comments`, { text });
}
