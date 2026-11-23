import type { Comment } from "@/types";

export function CommentItem({ comment }: { comment: Comment }) {
  return (
    <article className="comment">
      <strong>{comment.author}</strong>
      <p>{comment.text}</p>
    </article>
  );
}
