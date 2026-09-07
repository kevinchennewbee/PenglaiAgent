# Penglai 0.5.11 implementation and verification plan

Status: in development. This document does not assert release or test completion.

## Objective and authority

Deliver Penglai 0.5.11 by combining a fresh upstream assessment, the September
0.5.11 research proposals, and the source/history audit. Repair the identified
defects, implement the selected first-party improvements, redesign the public
README and bilingual website, and complete the normal verification and release
workflow. The Owner excludes the two-hour installed soak. Deterministic
`test:soak` and all other applicable normal checks remain required.

The implementation starts from public `main` at
`10ef5df4fc0fbccd2d119dfeecbc8436ccccff01`. The existing Owner modifications to
`AGENTS.md` and the historical 0.5.7 runbook are preserved and are not included in
implementation commits by default. Published releases, tags and assets through
0.5.10 remain immutable. Historical reference documents are evidence, not new
operating instructions or automatic approval grants.

`TODO.md` is the completion ledger. An item is complete only when its stated
behavior and corresponding evidence exist. A passing unrelated test, a version
string, an empty check collection, or a source-only check cannot close a native
or account-based requirement.

## Product outcome

DSH remains the only Agent, model, Workspace, Session, Turn, tool, approval and
conversation system. Penglai owns installation, private runtime lifecycle,
reviewed plugins and product presentation. Office and Memory remain required;
Messaging, ASR, TTS and Companion remain optional and initially disabled.

The release combines these outcomes:

1. Correct identities and authorization before any read, write, delivery or
   destructive operation; cancellation and logout revoke pending authority.
2. Transactions that survive interruption without losing the latest successful
   state, reviving stopped connections, or damaging another app instance.
3. A conversation Memory library backed by the existing first-party engine:
   search, pagination, provenance, time and scope, source management and existing
   owner-approved correction/forgetting actions.
4. A mobile task loop, starting with Weixin and Feishu: official questions and
   approvals, scoped replies, cancellation, visible terminal states and bounded
   recovery. Other channel capabilities are described individually.
5. Reliable text-PDF reading and actual PDF page previews bound to the reviewed
   artifact digest; correct DOCX edits and Office job transitions. Scanned PDF
   is identified as requiring OCR, not silently treated as an empty text file.
6. A read-only conversation context/usage view using official accounting, with
   distinct context size, cumulative usage, cache and estimated-cost meanings.
7. Plugin Center status, updates and redacted diagnostics that describe actual
   installed/loaded/healthy state and useful recovery actions.
8. A complete, professional, accessible English-first/Chinese-second README and
   website describing the verified product, with real downloads and limitations.

The light workbench is a conditional candidate: only official extension points,
no replacement chat UI, extra task engine or hidden core patches. UOS/LoongArch is
an independent feasibility line, not a fourth supported release target. Its
source/runtime/sandbox/asset and available-device evidence must be recorded even
when native execution is unavailable.

## Upstream selection

Refresh official npm metadata, GitHub releases, source changes and actual package
contents before freezing candidates. Assess DSH, standalone Node, Electron,
Mnemon native, Feishu/DingTalk SDKs, sherpa-onnx, ONNX Runtime and Office/PDF
dependencies. Distinguish a reference plugin from a production dependency.

A DSH generation changes only with a complete consumable official npm cohort,
exact registry integrities, compatible native assets, license closure and an
explicit migration design. A GitHub tag alone is insufficient. Retaining the
existing rc.1 cohort is valid when no suitable complete successor is available;
do not delay first-party work indefinitely or assemble mixed-generation packages.
All selected upgrades need source/package mapping and behavior tests. Do not
assume identical `gitHead` values prove SDK tarballs contain the same fixes.

Record accept/retain/reject decisions in `UPSTREAM_DECISIONS.md`, including exact
versions, URLs, integrity/source evidence, reasons and required checks. Recheck
the chosen cohort at release freeze; changing it restarts affected validation.

## Implementation order

### 1. Security and identity

Bind authorization to channel/account/peer, Workspace/Session, object/revision,
action and connection generation as applicable. Reject before effects. Preserve
product Owner confirmation rather than treating generic chat consent as a write
grant. Make all Office job operations enforce the job's own scope. Resolve
destructive paths through their ancestors and revalidate before deletion.

### 2. Recovery and lifecycle

Use a shared validated transaction journal contract at both writer and boot
reader. Preserve the latest successful snapshot across repeated transactions;
record rollback failure as unresolved. Normalize successful updates on launch.
Serialize approval processing. Stop late async continuations from obtaining new
authority after cancellation, logout, disposal or generation changes. Scope
process cleanup to owned instances. Stage Windows upgrade payloads with a
recoverable activation boundary. Unify bundled and remote plugin version policy.

### 3. Content and plugin correctness

Fix Office acceptance/save transitions and paragraph/run addressing. Replace
legacy PDF extraction with bounded text extraction and digest-bound page preview.
Correct policy-before-persistence in Memory. Bound decompression and network
media intake. Recover safe TTS temporary artifacts and bound persistent ledgers.
Correct multilingual voice parameters and audio capture limits.

### 4. First-party user workflows

Implement R511-02 through R511-06 through existing official services and slots.
Queries have explicit scope, pagination and errors. IM interactions have durable
request correlation, expiry and single-use decisions; stale cards and replies
from another account cannot answer a request. Preserve Office's separate action
confirmation. Usage browsing must not enable the Budget enforcement plugin.
Unknown metrics remain unknown. Diagnostics never contain credentials, chat
bodies, QR codes or private absolute paths.

### 5. Verification, documentation and release

First write meaningful reproductions for repaired failures. Fix evidence readers
and assertions before relying on their output. Run incremental relevant tests,
then the normal full suite and supply-chain/profile/runtime gates. Build native
artifacts on the matching targets from one clean main SHA. Test fresh install,
restart, Back/retry, invalid paths, credential failure handling, plugin modes,
upgrade and uninstall. Preserve genuine account/live observations separately;
missing credentials do not turn fixtures into live evidence or introduce a new
release blocker beyond the current product contract.

Redesign the existing static website in its current repository and publication
architecture. Preserve established public URLs, bilingual navigation and real
download identity. Use readable typography, responsive composition, real product
workflows and grounded copy. Do not introduce a new hosting account or migrate
the official site merely to use a template. Validate links, layout, keyboard
access, language switching, mobile widths and release/source distinction.

Review and merge through the normal repository workflow when gates pass. Assemble
only the current contract's exact asset set. Verify draft bytes, signatures and
source identity before immutable publication; read back public bytes afterward.
Public copy must not announce a release before publication evidence exists.

## Verification layers

| Layer | Required proof |
| --- | --- |
| Source | Formatting, typecheck, unit/contract/integration/E2E/security/chaos and deterministic load tests; meaningful new negative cases |
| Dependencies | Frozen install if needed, exact pins/cohort, registry integrity, source mapping, licenses/notices/SBOM, secret scan |
| Runtime | Real fixed DSH loader/profile, required and optional plugin modes, reconnection/disposal, Office-real and Memory-real |
| Artifacts | Target architecture and complete runtime closure, clean clone, exact manifest/signatures, source identity and native helpers |
| Native | Matching Apple Silicon, Intel Mac and Windows x64 installation/lifecycle/upgrade/uninstall evidence |
| Accounts | Only actually observed model/IM workflows count as live; record unrun supplemental cases explicitly |
| Public | Immutable exact assets, digest/signature readback, download links and bilingual README/site matching the released product |

## 中文

0.5.11 同时完成已发现问题的修复和参考方案中的核心增强：记忆库、手机任务
闭环、PDF 正文与预览、只读上下文/用量、插件诊断，以及 README 和官网重设计。
按权限与数据安全、事务与生命周期、内容正确性、用户功能、完整验收和发布推进。

官方 DSH 保持唯一核心；依赖更新先核实精确制品与兼容性。工作台按官方扩展点
可行性决定，UOS/龙芯独立记录可行性，不冒充第四个正式平台。所有已发布历史
保持不可变，用户原有修改保留。两小时安装等待测试排除；正常确定性测试、原生
验证及当前契约要求均保留。每个任务的完成证据在 TODO 中登记，不能用扫描、
空断言、假服务或其他检查的成功代替要求本身。
