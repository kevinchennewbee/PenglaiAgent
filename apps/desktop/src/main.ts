import { DshSupervisor } from "./supervisor.js";

export const APP_NAME = "Penglai";
export const UNSIGNED_NOTICE =
  "Penglai 0.5.3 community release. trustTier=community-verified. macOS ad-hoc, not notarized. Windows no Authenticode. Gatekeeper/SmartScreen may warn. Do not disable system security. DSH plugins share the local DSH process. Updates require user confirmation and are never installed silently.";

export function createDesktopRuntime() {
  const supervisor = new DshSupervisor();
  return { supervisor, notice: UNSIGNED_NOTICE };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${APP_NAME} control shell ${UNSIGNED_NOTICE}\n`);
}
