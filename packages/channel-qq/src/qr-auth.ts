export interface QqQrCallbacks {
  onSuccess: (creds: { appId: string; clientSecret: string }) => void;
  onFailure: (err: unknown) => void;
  onQr?: (image: string) => void;
}

/**
 * Official QQ Bot QR via Penglai's audited MIT selective rewrite. Personal QQ
 * login is not simulated. Tests inject startFn so they never hit the network.
 */
export class QqQrAuth {
  constructor(
    private readonly startFn: (
      callbacks: QqQrCallbacks,
      opts: { displayQrCodeToConsole: false; source: string },
    ) => { cancel(): void } = penglaiStartQr,
  ) {}

  start(callbacks: QqQrCallbacks): { cancel(): void } {
    return this.startFn(callbacks, { displayQrCodeToConsole: false, source: "penglai-im" });
  }
}

function penglaiStartQr(
  callbacks: QqQrCallbacks,
  opts: { displayQrCodeToConsole: false; source: string },
): { cancel(): void } {
  void opts.displayQrCodeToConsole;
  let cancelled = false;
  let stop: () => void = () => undefined;
  void import("./qq-onboard.js").then(({ startQqOnboard }) => {
    if (cancelled) return;
    stop = startQqOnboard(
      {
        onQrReady: (url) => {
          if (!cancelled) callbacks.onQr?.(url);
        },
        onSuccess: (creds) => {
          if (!cancelled) callbacks.onSuccess({ appId: creds.appId, clientSecret: creds.clientSecret });
        },
        onFailure: (error) => {
          if (!cancelled) callbacks.onFailure(error);
        },
      },
      { source: opts.source },
    );
  }).catch((error) => {
    if (!cancelled) callbacks.onFailure(error);
  });
  return {
    cancel() {
      cancelled = true;
      stop();
    },
  };
}
