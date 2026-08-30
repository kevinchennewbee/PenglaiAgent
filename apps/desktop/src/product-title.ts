export const PENGLAI_DESKTOP_TITLE = "蓬莱 Penglai";

export function penglaiDocumentTitle(current: string): string {
  if (!current.trim()) return PENGLAI_DESKTOP_TITLE;
  return current.replace(/DeepSeek Harness/gi, PENGLAI_DESKTOP_TITLE);
}

interface ProductTitleDocument {
  title: string;
  readyState: string;
  head: Node | null;
  documentElement: Node;
  addEventListener(
    type: "DOMContentLoaded",
    listener: () => void,
    options: { once: true },
  ): void;
}

interface ProductTitleObserver {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
}

type ProductTitleObserverConstructor = new (
  callback: () => void,
) => ProductTitleObserver;

/** Keep the distribution-owned document title branded without changing DSH package bytes. */
export function installPenglaiDocumentTitle(
  documentPort: ProductTitleDocument,
  Observer: ProductTitleObserverConstructor,
): () => void {
  let observer: ProductTitleObserver | undefined;
  const sync = (): void => {
    const next = penglaiDocumentTitle(documentPort.title);
    if (next !== documentPort.title) documentPort.title = next;
  };
  const attach = (): void => {
    sync();
    observer = new Observer(sync);
    observer.observe(documentPort.head ?? documentPort.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };
  if (documentPort.readyState === "loading") {
    documentPort.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
  return () => observer?.disconnect();
}
