const api = window.penglai || {};
const click = (sel, name) => {
  const el = document.querySelector(sel);
  if (!el || typeof api[name] !== "function") return;
  el.addEventListener("click", () => {
    Promise.resolve(api[name]()).catch(() => undefined);
  });
};
click("[data-penglai-recovery-retry]", "recoveryRetry");
click("[data-penglai-recovery-copy]", "recoveryCopyDiagnostics");
click("[data-penglai-recovery-logs]", "recoveryOpenLogs");
click("[data-penglai-recovery-data]", "recoveryOpenData");
click("[data-penglai-recovery-quit]", "recoveryQuit");
