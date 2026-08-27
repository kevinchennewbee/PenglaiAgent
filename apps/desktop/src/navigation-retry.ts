interface NavigableWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    getURL(): string;
  };
  loadURL(target: string): Promise<unknown>;
}

interface NavigationRetryOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function loadWindowUrl(
  win: NavigableWindow,
  target: string,
  isStopping: () => boolean,
  opts: NavigationRetryOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isStopping() || win.isDestroyed() || win.webContents.isDestroyed()) {
      throw new Error("window closed during navigation");
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        win.loadURL(target),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("loadURL timeout")), timeoutMs);
        }),
      ]);
      return;
    } catch (error) {
      if (isStopping() || win.isDestroyed() || win.webContents.isDestroyed()) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (win.webContents.getURL() === target) return;
      if (attempt > 0 || !/ERR_ABORTED|\(-3\)\s+loading/i.test(message)) throw error;
      await delay(retryDelayMs);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
