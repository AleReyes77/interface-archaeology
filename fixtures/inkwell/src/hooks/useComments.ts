"use client";
import { useEffect, useState } from "react";
import { fetchComments, postComment } from "@/lib/comments-api";
import { useSession } from "@/context/SessionContext";
import type { Comment } from "@/types";

export function useComments(documentId: string) {
  const session = useSession();
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    fetchComments(documentId).then(setComments);
  }, [documentId]);

  async function addComment(text: string) {
    if (!session.user) return;
    await postComment(documentId, text);
    setComments(await fetchComments(documentId));
  }

  return { comments, addComment };
}
