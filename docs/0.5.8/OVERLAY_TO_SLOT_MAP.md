# 0.5.7 overlay to DSH 0.1.2-alpha.1 source map

> Fixed source: `dsh-v0.1.2-alpha.1` at `cd5ef814…`. This document maps
> source capabilities only. It does not prove that matching npm packages,
> generated declarations, installed clients, or native artifacts exist.

The executable record is `OVERLAY_TO_SLOT_MAP.json`; running
`pnpm verify:058-overlay-map` verifies that every file and brand asset in the
0.5.7 overlay manifest has a disposition and that its recorded legacy anchors
still match the exact rc.2 upstream/patched bytes.

## Result

The old overlay is not one indivisible migration:

| ID | Old behavior | Alpha.1 source result | 0.5.8 decision before npm |
| --- | --- | --- | --- |
| O058-001 | static and changing browser title | official `DSH_CLIENT_TITLE` build input plus `DocumentTitle` | freeze the build route; do not carry the `MutationObserver` design unless published tooling cannot reproduce it |
| O058-002 | self-closing HTML tags | serializer-only | drop |
| O058-003 | Penglai sidebar/hero mark and name | official brand slots | existing Penglai slot occupants are the source-ready route |
| O058-004 | Penglai welcome copy inside the official notice | redundant when the official step is suppressed | drop with O058-005 |
| O058-005 | suppress official testing notice | `settings.onboarding` is a priority-shadowable list slot in source | use a bounded completion occupant or equivalent published composition exclusion |
| O058-006 | suppress duplicate DeepSeek credential onboarding | same official list-slot route | keep Penglai's server-verified wizard authoritative; retain Models settings |
| O058-007 | visible IM voice row and hidden local ASR metadata | only whole Chat-node replacement exists | upstream gap: require a narrow source-aware user-message extension |
| O058-008 | Penglai hero headline/badge copy | mark is slotted, copy is not; official locale namespace has one owner | upstream gap: require replaceable hero/product copy |
| O058-009 | light/dark ink-wash hero background | no source-proven full-hero decoration seat | upstream gap: require a narrow hero decoration/background contract |
| O058-010 | assistant text passed to TTS action | official action carries durable `messageId` only | prefer an official identity-based read; otherwise request a bounded read/wider owner face |
| O058-011 | nested Penglai settings pages | official shell has no parent field, but entries may declare child slots | move Penglai pages under a Penglai-owned composite section; never teach the official shell about `penglai-*` ids |
| O058-012 | generated bundle final newline | serializer-only | drop |

## Review conclusions

1. “Alpha.1 has more slots” is not enough to claim the overlay can be deleted.
   Four product requirements still lack a narrow source-proven route:
   O058-007 through O058-010.
2. The Models page and its two onboarding contributions currently ship from
   one plugin. Omitting the entire plugin would also remove Models settings,
   so the migration must shadow/exclude only the two onboarding list cells.
3. Third-party locale registration cannot overwrite `conversation` copy. The
   locale runtime rejects duplicate namespace/locale owners, so hero text must
   receive a real replaceable seat rather than an override trick.
4. `conversation.chat.node` could replace the complete user renderer, but that
   would duplicate official Chat behavior and create a new maintenance fork.
   It is not accepted as the voice-row solution.
5. TTS should resolve the durable assistant message by `messageId` if the
   published Session surface permits it. Passing raw text through a wider slot
   remains a fallback gap, not the first design.
6. No rc.2 compiled-byte overlay is rebased against alpha source now. Exact
   published bytes and declarations are required before the residual-gap
   decision.

## Package reconciliation

When official npm packages appear, the bounded overlay work is:

- prove the title build route and the three brand occupants;
- compile and exercise the two onboarding shadow/exclusion entries;
- implement the Penglai-owned settings child-slot composite;
- inspect the exact published Chat/Session read surfaces for voice and TTS;
- ask for or implement only the four confirmed narrow gaps; and
- generate a new overlay manifest only for gaps that remain after those tests,
  with a new ADR, source/byte digests, and browser regression evidence.

The map deliberately leaves the active product on DSH `0.1.1-rc.2`; it does
not add source, Git, tarball, or copied-build dependencies.
