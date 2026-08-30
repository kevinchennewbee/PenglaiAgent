export const PENGLAI_DESKTOP_TITLE = "蓬莱 Penglai";

export function penglaiDocumentTitle(current: string): string {
  if (!current.trim()) return PENGLAI_DESKTOP_TITLE;
  return current.replace(/DeepSeek Harness/gi, PENGLAI_DESKTOP_TITLE);
}

interface ProductTitleDocument {
  title: string;
  head: Node | null;
  documentElement: Node;
}

interface ProductTitleObserver {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
}

type ProductTitleObserverConstructor = new (
  callback: () => void,
) => ProductTitleObserver;

interface ProductTitleGuard {
  sync(): void;
  dispose(): void;
}

function inheritedTitleDescriptor(
  documentPort: ProductTitleDocument,
): PropertyDescriptor | undefined {
  let current = Object.getPrototypeOf(documentPort) as object | null;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "title");
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function installSynchronousTitleGuard(
  documentPort: ProductTitleDocument,
): ProductTitleGuard {
  const own = Object.getOwnPropertyDescriptor(documentPort, "title");
  const descriptor = own ?? inheritedTitleDescriptor(documentPort);
  let fallback = documentPort.title;
  const readRaw = descriptor?.get
    ? () => String(descriptor.get?.call(documentPort) ?? "")
    : () => fallback;
  const writeRaw = descriptor?.set
    ? (value: string) => descriptor.set?.call(documentPort, value)
    : (value: string) => {
        fallback = value;
      };
  const sync = (): void => writeRaw(penglaiDocumentTitle(readRaw()));
  try {
    Object.defineProperty(documentPort, "title", {
      configurable: true,
      enumerable: own?.enumerable ?? descriptor?.enumerable ?? true,
      get: () => penglaiDocumentTitle(readRaw()),
      set: (value: unknown) => writeRaw(penglaiDocumentTitle(String(value ?? ""))),
    });
  } catch {
    return {
      sync: () => {
        documentPort.title = penglaiDocumentTitle(documentPort.title);
      },
      dispose: () => undefined,
    };
  }
  return {
    sync,
    dispose: () => {
      if (own) Object.defineProperty(documentPort, "title", own);
      else delete (documentPort as Partial<ProductTitleDocument>).title;
    },
  };
}

/** Keep the distribution-owned document title branded without changing DSH package bytes. */
export function installPenglaiDocumentTitle(
  documentPort: ProductTitleDocument,
  Observer: ProductTitleObserverConstructor,
): () => void {
  let observer: ProductTitleObserver | undefined;
  const guard = installSynchronousTitleGuard(documentPort);
  const attach = (): void => {
    guard.sync();
    observer = new Observer(guard.sync);
    observer.observe(documentPort.head ?? documentPort.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };
  attach();
  return () => {
    observer?.disconnect();
    guard.dispose();
  };
}
