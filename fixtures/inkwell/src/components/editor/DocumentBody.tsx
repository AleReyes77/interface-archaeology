"use client";

export function DocumentBody({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return <textarea className="body" value={value} onChange={(event) => onChange(event.target.value)} />;
}
