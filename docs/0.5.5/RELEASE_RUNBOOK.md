# Penglai 0.5.5 release runbook

This is the executable release order for the public `kevinchennewbee/PenglaiAgent`
repository. Every PASS must be produced from the exact candidate commit. A source
test, mock, generated fixture, or successful package command is not installed or
live evidence.

## 1. Freeze identity and review

1. Confirm the checkout remote is `kevinchennewbee/PenglaiAgent`, the product is
   `0.5.5`, and official DeepSeek Harness `0.1.1-rc.2` is the only core.
2. Review all changes since `origin/main`, generated/vendor closure differences,
   licenses, dependencies, release keys, credential paths, and public export.
3. Search tracked and untracked text for tokens, keys, user paths, local messages,
   account identifiers, and generated logs. A secret scan PASS never permits a
   manually observed secret to ship.
4. Keep Office and Memory required and enabled on a fresh profile. Keep Mobile
   Messaging, ASR, TTS, and Companion optional and disabled until owner action.

## 2. Produce a clean source candidate

Run the repository gates documented in `package.json`, including formatting,
typecheck, unit, contract, integration, desktop E2E, security, chaos, versions,
identity, contracts, dependencies, licenses, secrets, profile, closure, clean
clone, Office real verification, and Memory real verification. Commit first when
a verifier requires `treeDirty=false`; do not edit the candidate after recording
its final PASS evidence.

## 3. Test a fresh installed Apple-Silicon client

1. Build the Apple-Silicon DMG from the clean candidate and install it into an
   isolated app and isolated user-data directory.
2. Walk every onboarding page from language through the first official Session
   turn. Test folder selection, a rejected app/data folder, Back, retry after a
   failed credential, restart/resume, and successful completion.
3. Inject the temporary DeepSeek credential only through a no-echo process input.
   Never put it in argv, repository files, evidence, screenshots, or shell history.
4. Send one real official DeepSeek message, verify the reply and conversation
   persistence, then remove the isolated profile, logs, temporary credential, and
   installed test app.
5. Verify Office, Memory, plugin-center refresh, ASR/TTS UI slots, update UI, and
   uninstall UI from the installed application. Label unavailable external-account
   tests NOT_RUN rather than replacing them with mocks.

## 4. Open the pull request and build all native targets

Push only the candidate branch, open one PR to `main`, and require repository CI.
Dispatch `native-release-candidate.yml` for the exact PR SHA. The workflow must:

- build and install `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64`;
- run the keyless onboarding dead-end walk on all three targets;
- install/enable/disable bundled plugins across restart;
- prove packaged architecture, runtime closure, fuses, and source-SHA binding;
- on Windows, compile the NSIS script as UTF-8 and verify current-user install,
  upgrade, uninstall, preserved user data, bilingual component strings, and no
  garbled visible copy.

A green cross-build on macOS is not Intel or Windows native evidence.

## 5. Merge, sign, and publish exact artifacts

After review and all required checks, merge without changing candidate bytes.
Tag `v0.5.5` at the exact `main` commit. Build or promote only artifacts bound to
that commit. Create the signed updater manifest, plugin catalog/release if changed,
release manifest, SBOM, notices, checksums, and public-export manifest. Upload the
exact asset set declared by `release-contract.json`, make the GitHub Release
immutable, and run `scripts/readback-release.mjs` against public bytes.

## 6. Publish the public narrative and clean branches

Update the repository README, `AGENTS.md`, GitHub Pages site, release notes, and
profile README in English first and Chinese second. Use exact public links and
state the unsigned/not-notarized limits plainly. The profile repository is a
separate commit and must not alter the product release SHA. When public readback
passes, delete the PR branch and every obsolete product branch. Leave only
`main` and `gh-pages` on the PenglaiAgent remote.
