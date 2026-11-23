import { pool } from "./db";
import type { Comment } from "@/types";

export async function listComments(documentId: string): Promise<Comment[]> {
  const result = await pool.query("SELECT id, author, text FROM comments WHERE document_id = $1", [documentId]);
  return result.rows;
}

export async function insertComment(documentId: string, author: string, text: string) {
  await pool.query("INSERT INTO comments (document_id, author, text) VALUES ($1, $2, $3)", [documentId, author, text]);
}
