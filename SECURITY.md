# Security Policy

This document describes the current 0.4 security model. The archived 0.3.x
Python line has different components and should be evaluated from the
`v0.3.6` tag.

## Supported versions

| Version | Status |
| --- | --- |
| 0.4.x | Security fixes accepted |
| 0.3.x | Frozen; critical fixes only |
| older | Unsupported |

## Trust boundary

Penglai is a single-user, local-first desktop application. The Tauri renderer
talks to a TypeScript Host bound to loopback. HTTP and WebSocket requests need
a random Host credential. That credential is generated atomically, stored as
a current-user regular file at `~/.penglai/host.token`, hardened to mode 0600,
and is never accepted in a URL query string. The native bridge and development
proxy inject it outside renderer JavaScript; browser-compatible WebSockets use
an authenticated subprotocol.

This protects against accidental URL/history/log leakage and unauthenticated
loopback callers. It does **not** protect against another malicious process
running as the same OS user. Such a process can read application files or
inspect process memory. Use a separate OS account or container when that is in
your threat model.

Penglai's policy levels, approvals, realpath workspace jail, sensitive-path
denials and command checks are deterministic defence-in-depth, not an OS
sandbox. `bash`, an installed MCP server and other child processes run with the
rights of the current user. Do not treat an approval dialog or a blocked command
as proof that arbitrary hostile code is safe.

## Credentials and network use

- Model keys stay in the Host and are not returned by RPC or exposed to the
  renderer. `profiles.json` and `host.token` are local private files.
- Public model endpoints must use HTTPS. Plain HTTP is accepted only for exact
  loopback hosts (`localhost`, `127.0.0.1`, `::1`). URLs containing credentials
  or fragments are rejected.
- Public web fetching revalidates DNS and every redirect against private,
  loopback, link-local and metadata ranges. Web and MCP calls require Owner L3
  approval.
- Third-party Skill and MCP content is not trusted code merely because it was
  installed. Declarative Skills are hash-verified and cannot run package
  installers or TypeScript hooks. MCP servers are Owner-started executables and
  retain the privileges of the current user.

## Prompt-injection boundary

Text extracted from documents, search results, fetched pages and MCP tools is
wrapped as untrusted data before it reaches the model. The system prompt says
that instructions, fake authority claims and tool requests inside those blocks
must not be followed. This reduces indirect prompt-injection risk but cannot
mathematically guarantee model behaviour. Sensitive operations still pass
through deterministic policy and Owner approval; never grant an untrusted MCP
or page broader OS access than necessary.

## Audit data and redaction

Task lifecycle, steps, approvals and Evidence are persisted in local SQLite;
conversation transcripts and goal history use local JSONL/JSON files. Evidence
comes from tool-observed diffs, disk re-reads, command output and exit state,
not from the model's claim of success.

Before Evidence and approval audit fields are written, credential-shaped text
is redacted recursively (Bearer/basic credentials, common key/token/password
assignments, URL secrets, CLI secret flags, well-known token formats and PEM
private keys). Diagnostic exports apply the same redactor and exclude product
state, credentials, profiles, conversations, databases, memory, Skills and MCP
configuration. Redaction is best-effort: users should still avoid pasting
secrets into prompts, file contents or commands. Full data locations and
deletion behaviour are documented in
[`docs/PRIVACY_AND_DATA.md`](docs/PRIVACY_AND_DATA.md).

## Release and dependency integrity

The npm lock is restricted to the official npm registry and includes integrity
hashes. GitHub Actions are pinned to commit SHAs, Dependabot security alerts and
security updates are enabled, and CI runs npm vulnerability auditing. The
public release gate also rejects secrets, private paths, internal artifacts and
legacy runtime source.

Local macOS packages are ad-hoc signed unless the maintainer configures Apple
Developer ID and notarization. Ad-hoc signing checks bundle integrity but does
not establish an Apple-verified publisher identity. Tauri updater minisign is
also not a substitute for Developer ID, notarization or Windows Authenticode.

## Reporting a vulnerability

Do not put secrets, credentials, private logs or personal data in a public
issue. Prefer GitHub's private vulnerability reporting when enabled. If that is
unavailable, open a minimal public issue requesting a private contact channel,
without reproduction secrets.

Include the affected version/commit, OS and architecture, the smallest redacted
reproduction, expected impact, and whether local credentials, files, channels,
updates or generated artifacts may be affected.
