document.addEventListener('DOMContentLoaded', () => {
  const out = document.getElementById('out');
  const btn = document.getElementById('refresh');
  const copy = document.getElementById('copy');
  btn.addEventListener('click', fetchCookies);
  copy.addEventListener('click', async () => {
    const value = copy.dataset.cookies || '';
    if (value) await navigator.clipboard.writeText(value);
  });
});

async function fetchCookies() {
  const out = document.getElementById('out');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { out.textContent = 'No active tab'; return; }
    const resp = await chrome.runtime.sendMessage({ cmd: 'cookies', url: tab.url });
    if (!resp?.ok) { out.textContent = 'Error: ' + (resp?.error || 'unknown'); return; }
    if (!resp.data.length) { out.textContent = '(no cookies)'; return; }
    // 展示带标记
    out.textContent = resp.data.map(c =>
      `${c.name}=${c.value}` + (c.httpOnly ? ' [H]' : '') + (c.secure ? ' [S]' : '') + (c.partitionKey ? ' [P]' : '')
    ).join('\n');
    // Cookie values enter the clipboard only after a separate user click.
    const copy = document.getElementById('copy');
    copy.dataset.cookies = resp.data.map(c => `${c.name}=${c.value}`).join('; ');
    copy.disabled = false;
  } catch (e) { out.textContent = 'Error: ' + e.message; }
}
