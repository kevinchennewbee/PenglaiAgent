import { join } from "node:path";

export interface PluginDistributionStatePaths {
  cacheRoot: string;
  trustPath: string;
  lastGoodPath: string;
}

/**
 * Keep every production and verification caller on the same app-private
 * Plugin Center state layout. A verifier using a different last-good path
 * cannot prove the boot-time revocation behavior used by the desktop app.
 */
export function pluginDistributionStatePaths(
  userDataRoot: string,
): PluginDistributionStatePaths {
  const pluginsRoot = join(userDataRoot, "plugins");
  return {
    cacheRoot: join(pluginsRoot, "cas"),
    trustPath: join(pluginsRoot, "trust-state.json"),
    lastGoodPath: join(pluginsRoot, "last-good-catalog.json"),
  };
}
