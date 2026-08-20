/* SPDX-License-Identifier: Apache-2.0 */
const PRODUCT_TITLE = "蓬莱 Penglai";
const UPSTREAM_TITLE = "DeepSeek Harness";

function brandedTitle(value) {
  const upstreamSuffix = ` — ${UPSTREAM_TITLE}`;
  if (value.endsWith(upstreamSuffix)) {
    return `${value.slice(0, -upstreamSuffix.length)} — ${PRODUCT_TITLE}`;
  }
  return PRODUCT_TITLE;
}

function syncTitle() {
  const next = brandedTitle(document.title);
  if (document.title !== next) document.title = next;
}

syncTitle();
new MutationObserver(syncTitle).observe(document.head, {
  childList: true,
  characterData: true,
  subtree: true,
});
