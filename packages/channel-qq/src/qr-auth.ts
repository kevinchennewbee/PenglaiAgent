export interface QqQrCallbacks {
  onSuccess: (creds: { appId: string; clientSecret: string }) => void;
  onFailure: (err: unknown) => void;
}

/**
 * Official QQ Bot QR. The connector is injected so tests never talk to the
 * network and personal QQ login is not simulated.
 */
export class QqQrAuth {
  constructor(
    private readonly startFn: (callbacks: QqQrCallbacks, opts: { displayQrCodeToConsole: false; source: string }) => { cancel(): void } = () => {
      throw new Error("QQ QR connector required");
    },
  ) {}

  start(callbacks: QqQrCallbacks): { cancel(): void } {
    return this.startFn(callbacks, { displayQrCodeToConsole: false, source: "penglai-im" });
  }
}
