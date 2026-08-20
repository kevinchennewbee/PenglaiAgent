import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const GENERATION_ID = "penglai-dsh-v0.5";

export type LayoutPlatform = "darwin" | "win32";

export interface GenerationLayout {
  generationId: string;
  userData: string;
  dshHome: string;
  logs: string;
  cache: string;
  updates: string;
  im: string;
  uninstall: string;
  legacyCandidates: string[];
}

export function resolveGenerationLayout(opts: {
  platform: LayoutPlatform;
  home?: string;
  localAppData?: string;
  libraryRoot?: string;
}): GenerationLayout {
  const home = opts.home ?? homedir();
  if (opts.platform === "darwin") {
    const library = opts.libraryRoot ?? join(home, "Library");
    const userData = join(library, "Application Support", "Penglai", "0.5");
    return {
      generationId: GENERATION_ID,
      userData,
      dshHome: join(userData, "dsh-home"),
      logs: join(library, "Logs", "Penglai", "0.5"),
      cache: join(library, "Caches", "Penglai", "0.5"),
      updates: join(library, "Caches", "Penglai", "0.5", "updates"),
      im: join(userData, "im"),
      uninstall: join(userData, "uninstall"),
      legacyCandidates: [
        join(library, "Application Support", "Penglai", "penglai-v0.2.0-alpha.3"),
        join(library, "Application Support", "com.penglai.agent"),
        join(home, ".dsh"),
      ],
    };
  }
  const local = opts.localAppData ?? join(home, "AppData", "Local");
  const userData = join(local, "Penglai", "0.5");
  return {
    generationId: GENERATION_ID,
    userData,
    dshHome: join(userData, "dsh-home"),
    logs: join(userData, "logs"),
    cache: join(userData, "cache"),
    updates: join(userData, "updates"),
    im: join(userData, "im"),
    uninstall: join(userData, "uninstall"),
    legacyCandidates: [join(local, "PenglaiAgent"), join(home, ".dsh")],
  };
}

export function joinUserData(appUserData: string): string {
  return resolve(appUserData, "0.5");
}
