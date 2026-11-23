/**
 * Server-side syntax highlighting using the TypeScript scanner — the same
 * tokenizer the analyzer relies on, so no extra highlighting dependency.
 */
import ts from "typescript";
import type { Language } from "@/analyzer/types";

export type TokenClass = "kw" | "str" | "num" | "com" | "fn" | "type" | "punc" | "jsx" | "re" | "id" | "ws";

/** One line of source as [class, text] pairs. */
export type HighlightedLine = [TokenClass, string][];

const VARIANT: Record<Language, ts.LanguageVariant> = { ts: ts.LanguageVariant.Standard, js: ts.LanguageVariant.Standard, tsx: ts.LanguageVariant.JSX, jsx: ts.LanguageVariant.JSX };

function classify(kind: ts.SyntaxKind, text: string, next: () => string): TokenClass {
  if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) return "com";
  if (kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia) return "ws";
  if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || (kind >= ts.SyntaxKind.TemplateHead && kind <= ts.SyntaxKind.TemplateTail)) return "str";
  if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral) return "num";
  if (kind === ts.SyntaxKind.RegularExpressionLiteral) return "re";
  if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) return "kw";
  if (kind === ts.SyntaxKind.Identifier) {
    if (next() === "(") return "fn";
    if (/^[A-Z]/.test(text)) return "type";
    return "id";
  }
  return "punc";
}

export function highlight(source: string, language: Language): HighlightedLine[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, VARIANT[language], source);
  const tokens: { cls: TokenClass; text: string }[] = [];
  const templateDepth: number[] = [];
  let braceDepth = 0;
  let prevSignificant: ts.SyntaxKind = ts.SyntaxKind.Unknown;

  const peekNextNonSpace = (from: number) => {
    let i = from;
    while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
    return source[i] ?? "";
  };

  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    // Regex vs. division: a slash after an operator or at expression start starts a regex.
    if ((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) && !endsExpression(prevSignificant)) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === ts.SyntaxKind.OpenBraceToken) braceDepth++;
    if (kind === ts.SyntaxKind.TemplateHead) templateDepth.push(braceDepth);
    if (kind === ts.SyntaxKind.CloseBraceToken) {
      if (templateDepth.length && templateDepth[templateDepth.length - 1] === braceDepth) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) templateDepth.pop();
      } else braceDepth--;
    }
    const text = scanner.getTokenText();
    const end = scanner.getTokenEnd();
    tokens.push({ cls: classify(kind, text, () => peekNextNonSpace(end)), text });
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia && kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) prevSignificant = kind;
    kind = scanner.scan();
  }

  // Split into lines; multi-line tokens (comments, templates) are split as well.
  const lines: HighlightedLine[] = [[]];
  for (const t of tokens) {
    const parts = t.text.split(/\r?\n/);
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push([t.cls, part]);
    });
  }
  return lines;
}

function endsExpression(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.Identifier ||
    kind === ts.SyntaxKind.NumericLiteral ||
    kind === ts.SyntaxKind.StringLiteral ||
    kind === ts.SyntaxKind.CloseParenToken ||
    kind === ts.SyntaxKind.CloseBracketToken ||
    kind === ts.SyntaxKind.CloseBraceToken ||
    kind === ts.SyntaxKind.ThisKeyword ||
    kind === ts.SyntaxKind.TrueKeyword ||
    kind === ts.SyntaxKind.FalseKeyword ||
    kind === ts.SyntaxKind.NullKeyword
  );
}
