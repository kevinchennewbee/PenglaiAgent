export interface QqQrCallbacks {
  onSuccess: (creds: { appId: string; clientSecret: string }) => void;
  onFailure: (err: unknown) => void;
  onQr?: (image: string) => void;
}

/**
 * Official QQ Bot QR via `@tencent-connect/qqbot-connector`. Personal QQ
 * login is not simulated. Tests inject startFn so they never hit the network.
 */
export class QqQrAuth {
  constructor(
    private readonly startFn: (
      callbacks: QqQrCallbacks,
      opts: { displayQrCodeToConsole: false; source: string },
    ) => { cancel(): void } = officialStartQr,
  ) {}

  start(callbacks: QqQrCallbacks): { cancel(): void } {
    return this.startFn(callbacks, { displayQrCodeToConsole: false, source: "penglai-im" });
  }
}

function officialStartQr(
  callbacks: QqQrCallbacks,
  opts: { displayQrCodeToConsole: false; source: string },
): { cancel(): void } {
  let cancelled = false;
  void import("@tencent-connect/qqbot-connector")
    .then((mod) => {
      const start = (mod as { startQrConnect?: Function }).startQrConnect;
      if (typeof start !== "function") throw new Error("QQ_QR_CONNECTOR_MISSING");
      return start({
        displayQrCodeToConsole: opts.displayQrCodeToConsole,
        source: opts.source,
        onQRCode: (qr: unknown) => {
          if (cancelled) return;
          const image = typeof qr === "string" ? qr : String((qr as { url?: string; image?: string })?.image ?? (qr as { url?: string })?.url ?? "");
          if (image) callbacks.onQr?.(image);
        },
        onSuccess: (creds: { appId?: string; appid?: string; clientSecret?: string; secret?: string }) => {
          if (cancelled) return;
          callbacks.onSuccess({
            appId: String(creds.appId ?? creds.appid ?? ""),
            clientSecret: String(creds.clientSecret ?? creds.secret ?? ""),
          });
        },
        onError: (err: unknown) => {
          if (!cancelled) callbacks.onFailure(err);
        },
      });
    })
    .catch((err) => {
      if (!cancelled) callbacks.onFailure(err);
    });
  return {
    cancel() {
      cancelled = true;
    },
  };
}
