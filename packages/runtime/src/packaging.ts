import { RELEASE } from "@penglai/contracts";

export const PRODUCT_BUNDLE_ID = "com.penglai.dsh";
export const PRODUCT_EXECUTABLE = "Penglai";
export const PRODUCT_VERSION = RELEASE;

export interface AppIdentityFacts {
  executable: string;
  shortVersion: string;
  version: string;
  bundleId: string;
}

export function parseInfoPlistIdentity(plist: string): AppIdentityFacts {
  const pick = (key: string): string => {
    const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
    return re.exec(plist)?.[1] ?? "";
  };
  return {
    executable: pick("CFBundleExecutable"),
    shortVersion: pick("CFBundleShortVersionString"),
    version: pick("CFBundleVersion"),
    bundleId: pick("CFBundleIdentifier"),
  };
}

export function assertPenglaiAppIdentity(facts: AppIdentityFacts): void {
  if (facts.executable !== PRODUCT_EXECUTABLE) {
    throw new Error(`CFBundleExecutable must be ${PRODUCT_EXECUTABLE}, got ${facts.executable || "<empty>"}`);
  }
  if (facts.shortVersion !== PRODUCT_VERSION || facts.version !== PRODUCT_VERSION) {
    throw new Error(`app version must be ${PRODUCT_VERSION}, got ${facts.shortVersion}/${facts.version}`);
  }
  if (facts.bundleId !== PRODUCT_BUNDLE_ID) {
    throw new Error(`bundle id must be ${PRODUCT_BUNDLE_ID}, got ${facts.bundleId || "<empty>"}`);
  }
}

export const MICROPHONE_USAGE_DESCRIPTION =
  "Penglai uses the microphone only when you start voice input. It does not record in the background. 蓬莱仅在你主动开始语音输入时使用麦克风，不会在后台录音。";

export function rewriteElectronPlist(plist: string): string {
  let next = plist
    .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/, "<key>CFBundleDisplayName</key>\n\t<string>Penglai</string>")
    .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/, "<key>CFBundleName</key>\n\t<string>Penglai</string>")
    .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleExecutable</key>\n\t<string>${PRODUCT_EXECUTABLE}</string>`)
    .replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleShortVersionString</key>\n\t<string>${PRODUCT_VERSION}</string>`)
    .replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleVersion</key>\n\t<string>${PRODUCT_VERSION}</string>`)
    .replace(/<string>com\.github\.Electron<\/string>/g, `<string>${PRODUCT_BUNDLE_ID}</string>`)
    .replace(/<key>CFBundleIconFile<\/key>\s*<string>[^<]*<\/string>/, "<key>CFBundleIconFile</key>\n\t<string>penglai.icns</string>")
    .replace(/<key>LSMinimumSystemVersion<\/key>\s*<string>[^<]*<\/string>/, "<key>LSMinimumSystemVersion</key>\n\t<string>13.0</string>")
    .replace(
      /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*<\/string>/,
      `<key>NSMicrophoneUsageDescription</key>\n\t<string>${MICROPHONE_USAGE_DESCRIPTION}</string>`,
    );
  if (!/<key>CFBundleIconFile<\/key>/.test(next)) {
    next = next.replace(
      /<\/dict>\s*<\/plist>\s*$/,
      "\t<key>CFBundleIconFile</key>\n\t<string>penglai.icns</string>\n</dict>\n</plist>\n",
    );
  }
  if (!/<key>LSMinimumSystemVersion<\/key>/.test(next)) {
    next = next.replace(
      /<\/dict>\s*<\/plist>\s*$/,
      "\t<key>LSMinimumSystemVersion</key>\n\t<string>13.0</string>\n</dict>\n</plist>\n",
    );
  }
  if (!/<key>NSMicrophoneUsageDescription<\/key>/.test(next)) {
    const microphone =
      `\t<key>NSMicrophoneUsageDescription</key>\n\t<string>${MICROPHONE_USAGE_DESCRIPTION}</string>\n`;
    if (/<\/dict>\s*<\/plist>\s*$/.test(next)) {
      next = next.replace(/<\/dict>\s*<\/plist>\s*$/, `${microphone}</dict>\n</plist>\n`);
    } else {
      next += microphone;
    }
  }
  return next;
}

export const WINDOWS_NSIS_CONTRACT = {
  installer: `Penglai_${PRODUCT_VERSION}_windows_x64_setup.exe`,
  currentUser: true,
  bilingual: ["zh", "en"] as const,
  refuseDowngrade: true,
  defaultPreserveUserData: true,
  upgradeCode: "8F3C1A62-0B77-4D2E-9C41-6A1F2E7B9D50",
  appId: "Penglai.DSH.0.5",
} as const;

export function assertWindowsNsisContract(input: {
  currentUser?: boolean;
  languages?: string[];
  refuseDowngrade?: boolean;
  preserveUserDataDefault?: boolean;
  upgradeCode?: string;
}): void {
  if (input.currentUser !== true) throw new Error("Windows Setup must be current-user NSIS");
  if (!input.languages?.includes("zh") || !input.languages.includes("en")) {
    throw new Error("Windows Setup must be bilingual zh/en");
  }
  if (input.refuseDowngrade !== true) throw new Error("Windows Setup must refuse downgrade");
  if (input.preserveUserDataDefault !== true) throw new Error("Windows uninstaller must default-preserve user data");
  if (input.upgradeCode !== WINDOWS_NSIS_CONTRACT.upgradeCode) throw new Error("Windows UpgradeCode must stay pinned");
}

export function assertWindowsNsisScript(script: string): void {
  if (!/RequestExecutionLevel\s+user/i.test(script)) {
    throw new Error("NSIS script must request current-user execution");
  }
  if (!/SimpChinese/.test(script) || !/English/.test(script)) {
    throw new Error("NSIS script must be bilingual zh/en");
  }
  if (!script.includes(WINDOWS_NSIS_CONTRACT.upgradeCode)) {
    throw new Error("NSIS script must pin UpgradeCode");
  }
  if (!script.includes(WINDOWS_NSIS_CONTRACT.appId)) {
    throw new Error("NSIS script must pin AppId");
  }
  if (!/Section\s+"Uninstall"|SectionUninstall/i.test(script)) {
    throw new Error("NSIS script must define an uninstaller");
  }
  if (/RMDir\s+\/r\s+"\$LOCALAPPDATA\\Penglai\\0\.5"/i.test(script) || /RMDir\s+\/r\s+"\$PROFILE\\AppData\\Local\\Penglai\\0\.5"/i.test(script)) {
    throw new Error("NSIS uninstaller must not recursively delete userData by default");
  }
  if (!/deletion-capability\.json/.test(script) || !/penglai-windows-host\.exe/.test(script)) {
    throw new Error("NSIS uninstaller must hand off complete-delete to the native capability helper");
  }
  if (!/IfFileExists/.test(script) || !/skip_data/.test(script)) {
    throw new Error("NSIS uninstaller must only delete data when a capability file exists");
  }
}

export const CROSS_BUILD_TARGETS = [
  { packTarget: "darwin-arm64", releaseKey: "darwin-aarch64", installer: `Penglai_${PRODUCT_VERSION}_macos_aarch64.dmg` },
  { packTarget: "darwin-x64", releaseKey: "darwin-x86_64", installer: `Penglai_${PRODUCT_VERSION}_macos_x64.dmg`, translatedOnly: true },
  { packTarget: "win32-x64", releaseKey: "win32-x86_64", installer: `Penglai_${PRODUCT_VERSION}_windows_x64_setup.exe`, nativeEvidence: false },
] as const;
