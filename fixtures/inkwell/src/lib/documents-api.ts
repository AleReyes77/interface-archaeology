import type { Document } from "@/types";

async function request<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json();
}

export const documentsApi = {
  async get(id: string): Promise<Document> {
    const response = await fetch(`/api/documents/${id}`);
    return request<Document>(response);
  },

  async save(doc: Document): Promise<Document> {
    const response = await fetch(`/api/documents/${doc.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    return request<Document>(response);
  },

  async create(title: string): Promise<Document> {
    const response = await fetch("/api/documents", {
      method: "POST",
      body: JSON.stringify({ title, body: "" }),
    });
    return request<Document>(response);
  },
};
