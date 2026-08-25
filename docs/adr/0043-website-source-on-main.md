# ADR 0043 — Website source on main; gh-pages is deploy output

- Status: Accepted
- Date: 2026-08-25

## Context

The public repository has two branches: `main` (product) and `gh-pages`
(website). Website copy previously drifted from product truth because it lived
only on `gh-pages`. 0.5.7 needs the nine-platform messaging story reviewed with
the product PR.

## Decision

1. Author website sources on `main` under `website/` (`index.html`,
   `en/index.html`, `styles/`, `assets/`, `shots/`).
2. `gh-pages` stores only reviewed deploy output. Do not develop product code
   on the `gh-pages` checkout.
3. Production deploy is a manual workflow. It requires tag `v0.5.7`, a passing
   public Release readback, the three installers, metadata assets, a build
   comparison, deploy, then a live re-fetch of Chinese/English homepages and
   download links.
4. Grok Build may add the workflow and `website/` sources. It must not deploy
   production `gh-pages` before Codex merge and public readback.

## Consequences

- Screenshots come from the final installed 0.5.7 product, never 0.5.5 images
  presented as 0.5.7. QR, accounts, tokens, paths, and chat privacy stay out.
- Download links switch to `v0.5.7` only after the public assets exist.
