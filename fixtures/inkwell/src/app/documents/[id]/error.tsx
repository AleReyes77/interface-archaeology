"use client";

export default function DocumentError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert">
      <p>Something went wrong.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
