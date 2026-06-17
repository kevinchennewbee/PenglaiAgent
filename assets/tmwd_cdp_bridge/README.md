# TMWD CDP Bridge

This directory contains a Chrome Manifest V3 helper extension for local browser automation.

It is distributed under the repository MIT license, but it is intentionally high privilege:

- `debugger` lets the extension send Chrome DevTools Protocol commands to tabs.
- `cookies` lets it inspect cookies for requested pages.
- `<all_urls>` and content scripts let it coordinate automation across ordinary web pages.
- It can temporarily remove CSP headers for automation.

Use it only in a browser profile you trust for development or automation. It is not required for the normal Penglai Feishu, WeChat, Docker, or CLI runtime.
