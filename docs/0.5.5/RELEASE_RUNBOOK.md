# Penglai 0.5.5 local runbook

Local development only. Do not tag, push, or publish.

1. Freeze identity to `0.5.5` / DSH `0.1.1-rc.2`.
2. Pin the rc.2 closure with lock-only install.
3. Required-builtin Office + Memory; optional IM/ASR/TTS/Companion default-off.
4. Productize memory and office on shipped services.
5. IM media envelope + ASR/TTS conversation slots.
6. Run `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration`, `pnpm verify:versions`, `pnpm verify:identity`, `pnpm verify:profile`.
