# Security policy

Interface Archaeology reads source code from projects you choose and from Git repositories you paste. Its threat model treats that code as untrusted.

## Guarantees the project aims to keep

- Analyzed code is never executed, installed or built.
- Files are read only inside the selected project root; symbolic links are not followed; `.env*` files are never opened.
- Credential-like values are redacted from all output.
- The HTTP API is meant for local use: the server binds to `127.0.0.1`, requests addressed to a non-local `Host` are rejected, and cross-origin writes are refused.

A way to break any of these is a security issue.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the repository's Security tab) with a description, reproduction steps and the affected version. You should receive an acknowledgement within a week.

## Running on a shared host

Running the server on a non-local interface exposes endpoints that list directories and start Git clones. This is unsupported. If you must, set `IA_ALLOW_REMOTE=1` only behind your own authentication layer.
