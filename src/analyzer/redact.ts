/**
 * Secret detection and redaction.
 *
 * Analysis output and the source viewer never display values that look like
 * credentials. Detection is pattern-based; it is a safety net, not a scanner
 * that guarantees the absence of secrets.
 */

export interface SecretMatch {
  line: number;
  kind: string;
}

const PATTERNS: { kind: string; regex: RegExp }[] = [
  { kind: "private key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { kind: "AWS access key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "Stripe live key", regex: /\b(?:sk|rk)_live_[0-9a-zA-Z]{10,}\b/g },
  { kind: "GitHub token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b/g },
  { kind: "GitHub fine-grained token", regex: /\bgithub_pat_[0-9A-Za-z_]{30,}\b/g },
  { kind: "Slack token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { kind: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "JSON Web Token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "credentials in URL", regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:[^\s@'"`]{3,}@/gi },
];

/** Assignments such as `apiKey = "..."` / `password: '...'` with a long literal value. */
const ASSIGNMENT = /((?:api[_-]?key|secret|passw(?:or)?d|token|auth[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)(["'`])([^"'`\s]{8,})\2/gi;

export const REDACTED = "[redacted]";

export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { kind, regex } of PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(line)) matches.push({ line: index + 1, kind });
    }
    ASSIGNMENT.lastIndex = 0;
    if (ASSIGNMENT.test(line)) matches.push({ line: index + 1, kind: "credential-like assignment" });
  });
  return matches;
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const { regex } of PATTERNS) {
    regex.lastIndex = 0;
    out = out.replace(regex, REDACTED);
  }
  ASSIGNMENT.lastIndex = 0;
  out = out.replace(ASSIGNMENT, (_m, prefix: string, quote: string) => `${prefix}${quote}${REDACTED}${quote}`);
  return out;
}

const SENSITIVE_QUERY = /([?&](?:token|key|api[_-]?key|secret|password|auth|access_token|signature|sig)=)[^&#\s]+/gi;

/** Redacts sensitive query parameter values in a URL-like string. */
export function redactUrl(url: string): string {
  return redactSecrets(url.replace(SENSITIVE_QUERY, `$1${REDACTED}`));
}
