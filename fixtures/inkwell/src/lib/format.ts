export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso));
}

export function excerpt(text: string, length = 120): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
