"use client";
import { useState, type FormEvent } from "react";
import { useComments } from "@/hooks/useComments";
import { CommentItem } from "./CommentItem";

export default function CommentsPanel({ documentId }: { documentId: string }) {
  const { comments, addComment } = useComments(documentId);
  const [text, setText] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await addComment(text);
    setText("");
  }

  return (
    <aside className="comments">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
      <form onSubmit={handleSubmit}>
        <input value={text} placeholder="Add a comment" onChange={(e) => setText(e.target.value)} />
        <button type="submit">Post</button>
      </form>
    </aside>
  );
}
