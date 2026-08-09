# TMWD CDP Bridge

This directory contains a Chrome Manifest V3 helper extension for local browser automation.

It is distributed under the repository MIT license, but it is intentionally high privilege:

- `debugger` lets the extension send Chrome DevTools Protocol commands to tabs.
- `cookies` lets it inspect cookies for requested pages.
- `<all_urls>` and content scripts let it coordinate automation across ordinary web pages.
- It pairs to the loopback bridge with a random local token from the gitignored
  `config.js`; unauthenticated local processes cannot submit commands.
- It does not remove site CSP, replace page dialogs, inject all-page content
  scripts, manage other extensions, or change global content settings.

Use it only in a browser profile you trust for development or automation. It is not required for the normal Penglai Feishu, WeChat, desktop, or CLI runtime.

Run Penglai once before loading the unpacked extension so `config.js` is
created with mode 0600. If an older config has no pairing token,
`TMWebDriver.py` upgrades it automatically; reload the extension afterward.
