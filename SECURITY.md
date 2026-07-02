# Security Policy

## Security model: where the real boundary is

Penglai's deterministic safety rails — dangerous-command redline interception, sensitive-path blocking, memory write threat scanning, file-delivery allowlists, and full tool-call audit JSONL — are **in-process heuristics (a supplementary layer), not an OS-level security boundary**.

The only trustworthy boundary against an adversarial LLM or malicious tool output is **OS-level isolation**: a dedicated user account, a container, or a sandbox. Penglai runs the agent and its tools in the same process as your configuration and credentials by default.

**Recommendation**: for scenarios that process untrusted input, execute high-sensitivity operations, or run autonomously for long periods, run the Penglai runtime under a dedicated non-root user account (or in a container) so that even a bypassed heuristic cannot reach your primary credentials, browser sessions, or SSH keys. Do not treat "the redline blocked it" as equivalent to "it is safe" — the redline reduces risk, it does not eliminate it.

`penglai doctor` will warn if it detects the runtime running as root or under a shared login account.

## Conductor token threat model (0.3.5)

The Conductor web console (`frontends/conductor.py`) binds to `127.0.0.1:8900` and authenticates each request with a local `X-Penglai-Bridge-Token` header. As of 0.3.5 the token is **no longer accepted via URL query** (`?token=...`) to prevent leakage through browser history, `Referer` headers, server logs, and screen-sharing. The token is injected into the root page as `window.__PENGLAI_CONDUCTOR_TOKEN__` and read from there by the client; WebSocket connections pass it via the `sec-websocket-protocol` subprotocol (`penglai.<token>`) instead of the query string.

**What this prevents:** passive leakage of the token into URLs that may be logged, shared, or captured by browser extensions with history access.

**What this does NOT prevent:** the token still lives in the page's JavaScript memory and in `~/.penglai/conductor_token`. Any process running as the **same local user** can read the token file, inspect the page DOM, or read process memory. This is the same-user local trust boundary and is intentional: the Conductor is a single-user local tool. If you need to defend against same-user local read (for example, a malicious browser extension or another local process), you must run the Conductor under a separate user account or container, or implement a one-time bootstrap / session cookie flow — none of which is in 0.3.5 scope. Do not describe query-token removal as "Conductor is now secure against local attackers"; it is only a URL-leakage hardening step.

## Reporting a Vulnerability

Please do not post secrets, API keys, Feishu/WeChat credentials, cookies, private logs, or personal data in public issues.

To report a vulnerability, open a GitHub issue with sensitive values redacted, or contact the maintainer privately if the report requires non-public reproduction details. Include:

- affected PenglaiAgent version or commit
- install path, operating system, and runtime mode
- the smallest redacted reproduction you can provide
- whether the issue can expose `mykey.py`, `.env`, IM credentials, cookies, local files, or generated artifacts

Confirmed security-impacting fixes in upstream GenericAgent are evaluated for PenglaiAgent within 48 hours when they affect this distribution.
