# dsh-im post-v3.0.0 audit (not v3.0.0)

This record is **not** the v3.0.0 baseline. It audits peeled v3.0.0
`40b5a46516b44e30fa90e084400a8c3d578214e9` through
`ea5176be93cf0a5959397bd15d3ef614811a2a67` (7 commits, unsigned moving HEAD).

Do not call this range "v3.0.0 content".

## Commits

1. `9d3700b1cd89a811bceeb69bedfac2715c9a1df1` — `fix(qq): deliver C2C replies as markdown`
2. `f79375a0b0e0200ba4bb30eb48dacfbe764e1bb9` — `fix: polish English settings UI`
3. `c62032f2c382ae9ece0f4a0f5fac15101e54f322` — `fix: contain Telegram card layout`
4. `e8ef0725764bfb7a8182a8f5f8505c20a5cdabe8` — `docs: add English interface preview`
5. `8f03c66775c8cfe28b35238a633e2fcae396574c` — merge PR #60 QQ C2C markdown
6. `f4deb4ac2094ee804cd35e85b892f4f59cafacca` — `fix: show version tooltip below brand`
7. `ea5176be93cf0a5959397bd15d3ef614811a2a67` — `fix(qq): harden markdown reply delivery`

## QQ Markdown hardening adopted as rewrite

Exact source: `ea5176be93cf0a5959397bd15d3ef614811a2a67`
Files read (not vendored):

| Upstream | Penglai rewrite |
|---|---|
| `src/channels/qq/markdown-reply.mjs` | `packages/channel-qq/src/markdown-reply.ts` |
| `src/channels/qq/qq-runtime.mjs` (`markdownSupport: false`) | `packages/channel-qq/src/bot-client.ts` send path |
| `test/channels/qq/markdown-reply.test.mjs` | `packages/channel-qq/src/markdown-reply.test.ts` |

Security ideas rewritten, not copied from `lib/index.js`:

- Keep fenced code blocks independently renderable across chunks
- Keep GFM table line boundaries
- Unique `msg_seq` per outbound message
- Platform markdown rejection code `40034090` falls back to plain text
- Do not emit a second final message after a successful markdown send
- `sendText` stays for notices; markdown uses an explicit markdown msg type

Harness client, session coordinator, and generated `lib/` stay forbidden.
