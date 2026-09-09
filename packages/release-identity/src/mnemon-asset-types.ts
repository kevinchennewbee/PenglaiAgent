export type MnemonAssetTarget =
  | "darwin-aarch64"
  | "darwin-x86_64"
  | "win32-x86_64"
  | "linux-loong64";

export interface MnemonAssetPin {
  target: MnemonAssetTarget;
  platform: "darwin" | "win32" | "linux";
  arch: "arm64" | "x64" | "loong64";
  pluginTarget: "darwin-arm64" | "darwin-x64" | "win32-x64" | "linux-loong64";
  archiveFilename: string;
  archiveSha256: string;
  archiveBytes: number;
  binaryFilename: string;
  binarySha256: string;
  binaryBytes: number;
  executable: boolean;
  architectureBuild?: boolean;
  sourceCommit?: string;
}
