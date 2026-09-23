# 0.6.6 native lifecycle — evidence pending

Status: candidate contract. No native installer has passed the 0.6.6 installed acceptance journey yet.

The exact planned targets are Apple Silicon macOS, Windows x64 and UOS 20 loong64. All packages must come from one clean main commit. On macOS and Windows, verify fresh install, restart, onboarding Back/retry, invalid directory rejection, credential failure recovery, first official DSH message, plugin Center and IM default state, and default uninstall. Also verify 0.6.5 → 0.6.6 installed upgrade with original session bytes preserved and a working Session V4 successor. UOS package, ABI and closure checks are required before publication; UOS native install/startup/function must be reported separately. The two-hour installed soak is excluded by Owner instruction.

None of these checks is PASS merely because source tests, a cross-build or a startup profile passed. Record each target's artifact hash, source SHA, host, procedure and result before authorizing immutable publication.
