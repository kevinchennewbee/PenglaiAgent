# Security Policy

## Security model: where the real boundary is

Penglai's deterministic safety rails — dangerous-command redline interception, sensitive-path blocking, memory write threat scanning, file-delivery allowlists, and full tool-call audit JSONL — are **in-process heuristics (a supplementary layer), not an OS-level security boundary**.

The only trustworthy boundary against an adversarial LLM or malicious tool output is **OS-level isolation**: a dedicated user account, a container, or a sandbox. Penglai runs the agent and its tools in the same process as your configuration and credentials by default.

**Recommendation**: for scenarios that process untrusted input, execute high-sensitivity operations, or run autonomously for long periods, run the Penglai runtime under a dedicated non-root user account (or in a container) so that even a bypassed heuristic cannot reach your primary credentials, browser sessions, or SSH keys. Do not treat "the redline blocked it" as equivalent to "it is safe" — the redline reduces risk, it does not eliminate it.

`penglai doctor` will warn if it detects the runtime running as root or under a shared login account.

## Reporting a Vulnerability

Please do not post secrets, API keys, Feishu/WeChat credentials, cookies, private logs, or personal data in public issues.

To report a vulnerability, open a GitHub issue with sensitive values redacted, or contact the maintainer privately if the report requires non-public reproduction details. Include:

- affected PenglaiAgent version or commit
- install path, operating system, and runtime mode
- the smallest redacted reproduction you can provide
- whether the issue can expose `mykey.py`, `.env`, IM credentials, cookies, local files, or generated artifacts

Confirmed security-impacting fixes in upstream GenericAgent are evaluated for PenglaiAgent within 48 hours when they affect this distribution.
