# QQ Bot scan onboarding provenance

Penglai 0.5.7 implements QQ official-bot scan onboarding as a selective
TypeScript rewrite. It does not ship or execute
`@tencent-connect/qqbot-connector@1.2.0`, whose npm manifest declares
`UNLICENSED`.

## Source pin

- Repository: `https://github.com/tencent-connect/qqbot-agent-sdk`
- Commit: `6163b5dc979a2f12379b1916805009075008c3c3`
- Upstream files reviewed: `src/qqbot_agent_sdk/onboard.py`,
  `src/qqbot_agent_sdk/constants.py`, and `src/qqbot_agent_sdk/utils.py`
- License: MIT, copyright 2025 walli
- Preserved license: `third_party/LICENSE-qqbot-agent-sdk.txt`
- License SHA-256:
  `3e8bf593e605a1fd2ea6ec37acbe1ee7d84ed689d7c5466463e6dbd60e461e65`

## Penglai implementation

- `packages/channel-qq/src/qq-onboard.ts`
- `packages/channel-qq/src/qr-auth.ts`
- `packages/channel-qq/src/qq-onboard.test.ts`

The rewrite keeps the official `create_bind_task` / `poll_bind_result` flow,
the official QR target, and local AES-256-GCM decryption. Penglai adds bounded
response sizes, request and total timeouts, cancellation, no console QR or
credential output, and owner-controlled Vault persistence through
`@penglai/im`. It does not import the upstream Python package or its runtime.
