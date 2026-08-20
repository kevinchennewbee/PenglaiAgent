# ADR 0020 — IM host/client uses Typert Remote

- 状态：ACCEPTED
- 日期：2026-08-16

## Decision

`@penglai/im` host service 继承 `TypertRemoteService`，以 `@Remote` 暴露 closed DTO methods；client 使用 generated `TYPERT_REMOTE` mount。移除 generic/ad-hoc management HTTP endpoints。

Remote 没有 secret/body/QR/identity readback、generic execute 或 filesystem methods。mutation 使用 operation id、revision、schema、timeout、rate limit。QR 优先 client local render；确需 binary endpoint 时另写 ADR 并用 one-shot capability/same-origin/no-store。
