# ADR 0030 — Pre-DSH wizard replaces the DSH Web onboarding overlay

- Status: ACCEPTED
- Date: 2026-08-18

## Context

The product previously rendered Penglai onboarding inside the official DSH Web as a full-screen overlay registered on `settings.onboarding` (ADR 0028). That approach made onboarding dependent on the DSH Web booting first, let an overlay own the product identity, and risked a DSH boot problem blocking first-run onboarding.

The Owner decided (2026-08-18): Penglai must not use a full-screen overlay or a second in-DSH onboarding UI. Before onboarding completes, the main window loads a same-origin `/wizard` (plain HTML/JS/CSS) served by the authenticated proxy; only after the ledger reaches `COMPLETE` does it load the official DSH Web.

## Decision

The first-run wizard is a pre-DSH page served at same-origin `/wizard` by the authenticated proxy:

- All onboarding state and steps are hosted by `@penglai/plugin-center` through the `penglaiOnboarding` Typert remote, which only forwards official `llm` / `credentials` / `settings` / `agents` / `workspaceRegistry` seams.
- The wizard advances the onboarding ledger and, once `current === "COMPLETE"`, the BrowserWindow switches to the official DSH Web.
- The DSH Web onboarding overlay and its `settings.onboarding` registrant are removed.

The wizard is a temporary bootstrap surface, not a long-lived product UI. It must not become a second chat surface, model gateway, session store, or settings console.

## Consequences

- Onboarding no longer depends on the DSH Web booting first.
- `wizardFinished` takes the wizard offline only after the official DSH surface loads; a failed switch restores the wizard.
- The onboarding ledger is the single source of truth; it is validated as a non-symlink app-private file before it can gate the official surface.
- The DSH Web keeps its light/dark/system theme, zh/en, Models, Workspace, Session, conversation, tools, approvals, permissions, and settings untouched.
