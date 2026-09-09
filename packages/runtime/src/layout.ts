import { homedir } from "node:os";
import { resolve } from "node:path";

export const GENERATION_ID = "penglai-dsh-v0.5";

export type LayoutPlatform = "darwin" | "win32" | "linux";

/** Join layout segments with the target platform's separators, not the builder's. */
export function joinPlatform(platform: LayoutPlatform, ...parts: string[]): string {
  const posix = parts.map((part) => String(part).replaceAll("\\", "/"));
  let out = posix[0] ?? "";
  for (const part of posix.slice(1)) {
    const seg = part.replace(/^\/+|\/+$/g, "");
    if (!seg) continue;
    out = out.endsWith("/") ? `${out}${seg}` : `${out}/${seg}`;
  }
  return platform === "win32" ? out.replaceAll("/", "\\") : out.replace(/\/{2,}/g, "/");
}

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
  dataHome?: string;
  cacheHome?: string;
  stateHome?: string;
}): GenerationLayout {
  const home = opts.home ?? homedir();
  if (opts.platform === "linux") {
    const dataHome = opts.dataHome ?? joinPlatform("linux", home, ".local", "share");
    const cacheHome = opts.cacheHome ?? joinPlatform("linux", home, ".cache");
    const stateHome = opts.stateHome ?? joinPlatform("linux", home, ".local", "state");
    const userData = joinPlatform("linux", dataHome, "Penglai", "0.5");
    return {
      generationId: GENERATION_ID,
      userData,
      dshHome: joinPlatform("linux", userData, "dsh-home"),
      logs: joinPlatform("linux", stateHome, "Penglai", "0.5", "logs"),
      cache: joinPlatform("linux", cacheHome, "Penglai", "0.5"),
      updates: joinPlatform("linux", cacheHome, "Penglai", "0.5", "updates"),
      im: joinPlatform("linux", userData, "im"),
      uninstall: joinPlatform("linux", userData, "uninstall"),
      legacyCandidates: [joinPlatform("linux", home, ".dsh")],
    };
  }
  if (opts.platform === "darwin") {
    const library = opts.libraryRoot ?? joinPlatform("darwin", home, "Library");
    const userData = joinPlatform("darwin", library, "Application Support", "Penglai", "0.5");
    return {
      generationId: GENERATION_ID,
      userData,
      dshHome: joinPlatform("darwin", userData, "dsh-home"),
      logs: joinPlatform("darwin", library, "Logs", "Penglai", "0.5"),
      cache: joinPlatform("darwin", library, "Caches", "Penglai", "0.5"),
      updates: joinPlatform("darwin", library, "Caches", "Penglai", "0.5", "updates"),
      im: joinPlatform("darwin", userData, "im"),
      uninstall: joinPlatform("darwin", userData, "uninstall"),
      legacyCandidates: [
        joinPlatform("darwin", library, "Application Support", "Penglai", "penglai-v0.2.0-alpha.3"),
        joinPlatform("darwin", library, "Application Support", "com.penglai.agent"),
        joinPlatform("darwin", home, ".dsh"),
      ],
    };
  }
  const local = opts.localAppData ?? joinPlatform("win32", home, "AppData", "Local");
  const userData = joinPlatform("win32", local, "Penglai", "0.5");
  return {
    generationId: GENERATION_ID,
    userData,
    dshHome: joinPlatform("win32", userData, "dsh-home"),
    logs: joinPlatform("win32", userData, "logs"),
    cache: joinPlatform("win32", userData, "cache"),
    updates: joinPlatform("win32", userData, "updates"),
    im: joinPlatform("win32", userData, "im"),
    uninstall: joinPlatform("win32", userData, "uninstall"),
    legacyCandidates: [
      joinPlatform("win32", local, "PenglaiAgent"),
      joinPlatform("win32", home, ".dsh"),
    ],
  };
}

export function joinUserData(appUserData: string): string {
  return resolve(appUserData, "0.5");
}
