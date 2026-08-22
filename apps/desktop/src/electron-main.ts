import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { startDshProxy, type LocalProxy } from "@penglai/local-control";
import {
  AssistedUpdateCoordinator,
  DeletionAuthorizer,
  PINNED_DSH,
  activatePrivateProfile,
  buildDeletionPlan,
  createSchemaBackup,
  doctor,
  ensurePrivateHome,
  evaluateInventory,
  inspectStorageInventory,
  issuePluginOwnerGrant,
  macOsUninstallGuide,
  migrateRc8UserData,
  pluginPermissionDigest,
  quarantineRevokedPlugins,
  runtimePluginTarget,
  selectCatalogArtifact,
  readInventorySnapshot,
  recoverProfile,
  resolveUserLayout,
  deletionInspectionOptionsForPlatform,
  writeWindowsDeletionCapability,
  clearWindowsDeletionCapability,
  type DeletionPreview,
  type PluginOwnerAction,
} from "@penglai/runtime";
import { DshSupervisor, findResourcesRoot, isOwnedRuntimePath, layoutFromResources } from "./supervisor.js";
import { assertIpcName, navigationDecision, officialVendorConsoleDecision, PRELOAD_API } from "./preload.js";
import { UNSIGNED_NOTICE } from "./main.js";
import {
  configureGenerationPaths,
  installedApplicationPath,
  loadUpdaterReleaseContract,
  consumeOwnerCapability,
  issueOwnerCapability,
  parseConfirmedRequest,
  parseDeletionPrepareRequest,
  parseOperationRequest,
  readWorkspaceProtection,
  releaseTarget,
} from "./lifecycle.js";
import { productionDebuggerForbidden } from "./production-flags.js";
import { onboardingLedgerComplete, sanitizeStartupReason, wizardUrlForOrigin } from "./wizard-gate.js";
import { createContextGrantReceipt } from "./context-grant.js";
import {
  issuePluginRuntimeRestart,
  verifyPluginRuntimeRestart,
  type PendingPluginRuntimeRestart,
  type PluginUpdateJournalEvidence,
} from "./plugin-runtime-restart.js";

const here = dirname(fileURLToPath(import.meta.url));

function describePluginForOwner(userRoot: string, id: string): {
  id: string;
  version: string;
  publisher: string;
  sha256: string;
  permissions: string[];
  networkOrigins: string[];
  dataPaths: string[];
  nativeCode: boolean;
} {
  const bundledDir = process.env.PENGLAI_PLUGINS_DIR;
  if (bundledDir && existsSync(join(bundledDir, "catalog.json"))) {
    const doc = JSON.parse(readFileSync(join(bundledDir, "catalog.json"), "utf8")) as {
      entries?: Array<{
        id?: string;
        version?: string;
        sha256?: string;
        permissions?: string[];
        publisher?: string;
        networkOrigins?: string[];
        dataPaths?: string[];
        nativeCode?: boolean;
      }>;
    };
    const entry = doc.entries?.find((row) => row.id === id);
    if (entry?.id && entry.version && typeof entry.sha256 === "string") {
      return {
        id: entry.id,
        version: entry.version,
        publisher: entry.publisher ?? "Penglai",
        sha256: entry.sha256,
        permissions: entry.permissions ?? [],
        networkOrigins: entry.networkOrigins ?? [],
        dataPaths: entry.dataPaths ?? [],
        nativeCode: entry.nativeCode === true,
      };
    }
  }
  const lastGood = join(userRoot, "plugins", "last-good-catalog.json");
  if (existsSync(lastGood)) {
    const snap = JSON.parse(readFileSync(lastGood, "utf8")) as {
      catalog?: {
        entries?: Array<{
          id?: string;
          version?: string;
          publisher?: string;
          permissions?: string[];
          networkOrigins?: string[];
          dataPaths?: string[];
          nativeCode?: boolean;
          artifacts?: Array<{ target?: string; sha256?: string }>;
        }>;
      };
    };
    const entry = snap.catalog?.entries?.find((row) => row.id === id);
    const artifacts = (entry?.artifacts ?? []).filter(
      (row): row is { target: string; sha256: string } =>
        typeof row.target === "string" && typeof row.sha256 === "string",
    );
    const sha256 = artifacts.length
      ? selectCatalogArtifact(artifacts, runtimePluginTarget()).sha256
      : undefined;
    if (entry?.id && entry.version && sha256) {
      return {
        id: entry.id,
        version: entry.version,
        publisher: entry.publisher ?? "Penglai",
        sha256,
        permissions: entry.permissions ?? [],
        networkOrigins: entry.networkOrigins ?? [],
        dataPaths: entry.dataPaths ?? [],
        nativeCode: entry.nativeCode === true,
      };
    }
  }
  throw new PenglaiError("INVALID_INPUT", "unlisted package");
}

function resourcesRoot(): string {
  const packaged = app.isPackaged;
  return findResourcesRoot({
    ...(!packaged && process.env.PENGLAI_RESOURCES ? { envRoot: process.env.PENGLAI_RESOURCES } : {}),
    ...(typeof process.resourcesPath === "string" && process.resourcesPath ? { resourcesPath: process.resourcesPath } : {}),
    moduleDir: here,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

interface OfficialDom {
  title: string;
  href: string;
  protocol: string;
  readyState: string;
  hasRoot: boolean;
  hasDshBoot: boolean;
  recovery: boolean;
}

async function observeOfficialDom(win: BrowserWindow, timeoutMs: number): Promise<OfficialDom> {
  const start = Date.now();
  let last: OfficialDom = {
    title: "",
    href: "",
    protocol: "",
    readyState: "",
    hasRoot: false,
    hasDshBoot: false,
    recovery: false,
  };
  while (Date.now() - start < timeoutMs) {
    try {
      last = (await win.webContents.executeJavaScript(`({
        title: document.title,
        href: location.href,
        protocol: location.protocol,
        readyState: document.readyState,
        hasRoot: Boolean(document.getElementById("root")),
        hasDshBoot: typeof window.__DSH_BOOT__ !== "undefined",
        recovery: Boolean(document.querySelector("[data-penglai-recovery]")),
      })`)) as OfficialDom;
      if (
        last.hasDshBoot &&
        last.hasRoot &&
        last.protocol === "http:" &&
        !last.recovery &&
        !String(last.href).startsWith("file:")
      ) {
        return last;
      }
    } catch {
      /* renderer not ready */
    }
    await delay(200);
  }
  return last;
}

async function observeOfficialWebsocket(win: BrowserWindow): Promise<{ opened: boolean; url: string; readyState: number }> {
  return (await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const url = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/api/events.host";
    let settled = false;
    const done = (opened, readyState) => {
      if (settled) return;
      settled = true;
      resolve({ opened, url, readyState });
    };
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        done(false, ws.readyState);
      }, 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        const readyState = ws.readyState;
        try { ws.close(); } catch {}
        done(true, readyState);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        done(false, ws.readyState);
      };
    } catch {
      done(false, 3);
    }
  })`)) as { opened: boolean; url: string; readyState: number };
}

async function main(): Promise<void> {
  if (productionDebuggerForbidden(process.argv, app.isPackaged)) {
    process.stderr.write("Penglai production build refuses debugger switches\n");
    app.exit(2);
    return;
  }
  const platform = process.platform === "darwin" || process.platform === "win32"
    ? process.platform
    : undefined;
  if (!platform) throw new PenglaiError("SECURITY_POLICY", `unsupported desktop platform ${process.platform}`);
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("in-process-gpu");
  const desktopData = configureGenerationPaths({
    app,
    platform,
    ...(process.env.PENGLAI_USER_DATA ? { envUserData: process.env.PENGLAI_USER_DATA } : {}),
    ...(platform === "win32" && process.env.LOCALAPPDATA
      ? { localAppData: process.env.LOCALAPPDATA }
      : {}),
  });
  // Electron keys the single-instance lock by userData. Set the generation or
  // isolated runner root first so an already-running owner profile cannot
  // suppress a fresh/test profile before any BrowserWindow is created.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const token = randomBytes(32).toString("hex");
  const soakMode = Boolean(process.env.PENGLAI_SOAK);
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    title: "蓬莱 Penglai",
    webPreferences: {
      preload: join(here, "preload-bridge.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const allowed = new Set<number>([win.webContents.id]);
  const openOfficialConsole = (url: string): boolean => {
    if (officialVendorConsoleDecision(url) !== "allow") return false;
    void shell.openExternal(url);
    return true;
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOfficialConsole(url);
    return { action: "deny" };
  });
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.on("will-download", (event) => event.preventDefault());
  const user = { ...resolveUserLayout(desktopData.userData), logs: desktopData.logs };
  const live = new DshSupervisor();
  let proxy: LocalProxy | undefined;
  let allowedOrigin = "http://127.0.0.1:1/";
  const recoveryPage = join(here, "static", "index.html");
  const recoveryUrl = pathToFileURL(recoveryPage).href;
  let stopping = false;
  let lifecycleBusy = false;
  let pendingDeletion: {
    authorizer: DeletionAuthorizer;
    preview: DeletionPreview;
  } | undefined;
  let pendingPluginRuntimeRestart: PendingPluginRuntimeRestart | undefined;

  const workspaceProtectionPath = join(user.root, "plugins", "workspace-protection.json");

  win.webContents.on("will-navigate", (event, next) => {
    if (openOfficialConsole(next)) {
      event.preventDefault();
      return;
    }
    if (navigationDecision(next, allowedOrigin, recoveryUrl, { wizardComplete: onboardingLedgerComplete(user.root) }) === "deny") {
      event.preventDefault();
    }
  });
  win.webContents.on("will-redirect", (event, next) => {
    if (openOfficialConsole(next)) {
      event.preventDefault();
      return;
    }
    if (navigationDecision(next, allowedOrigin, recoveryUrl, { wizardComplete: onboardingLedgerComplete(user.root) }) === "deny") {
      event.preventDefault();
    }
  });

  process.on("uncaughtException", (err) => {
    if (stopping && /socket has been ended/i.test(err instanceof Error ? err.message : String(err))) return;
    throw err;
  });

  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      await live.stop();
    } catch {
      /* best effort */
    }
    try {
      await Promise.race([proxy?.close() ?? Promise.resolve(), delay(400)]);
    } catch {
      /* best effort */
    }
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* already gone */
    }
  };

  const closeProxy = async (): Promise<void> => {
    const current = proxy;
    proxy = undefined;
    if (!current) return;
    await current.close();
  };

  const stopOwnedServices = async (): Promise<{
    dshRunning: false;
    asrBusy: false;
    ttsBusy: false;
    indexerBusy: false;
    companionArmed: false;
  }> => {
    await closeProxy();
    await live.stop();
    return {
      dshRunning: false,
      asrBusy: false,
      ttsBusy: false,
      indexerBusy: false,
      companionArmed: false,
    };
  };

  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    if (lifecycleBusy) throw new PenglaiError("INVALID_INPUT", "another lifecycle operation is active");
    lifecycleBusy = true;
    try {
      return await run();
    } finally {
      lifecycleBusy = false;
    }
  };

  app.on("before-quit", (event) => {
    if (stopping) return;
    event.preventDefault();
    void shutdown().finally(() => app.quit());
  });
  app.on("window-all-closed", () => {
    void shutdown().finally(() => app.quit());
  });

  const revealWindow = (): void => {
    if (soakMode || win.isDestroyed() || win.isVisible()) return;
    win.show();
  };

  const failProbe = async (reason: string, extra: Record<string, unknown> = {}): Promise<void> => {
    const safe = sanitizeStartupReason(reason);
    try {
      await stopOwnedServices();
    } catch {
      /* recovery UI must still render after best-effort ownership teardown */
    }
    const recovery = recoveryPage;
    if (existsSync(recovery)) {
      await win.loadFile(recovery);
      try {
        await win.webContents.executeJavaScript(
          `(() => { const p = document.createElement("pre"); p.dataset.penglaiError = "1"; p.textContent = ${JSON.stringify(safe)}; document.body.appendChild(p); document.title = "Penglai · DeepSeek Harness failed to start"; })()`,
        );
      } catch {
        /* page still useful without the extra line */
      }
    }
    revealWindow();
    try {
      mkdirSync(user.logs, { recursive: true, mode: 0o700 });
      writeFileSync(join(user.logs, "startup.error.log"), `${new Date().toISOString()}\n${safe}\n`, { mode: 0o600 });
    } catch {
      /* diagnostics are best-effort */
    }
    void extra;
  };

  try {
    const resources = resourcesRoot();
    const layout = layoutFromResources(resources);
    ensurePrivateHome(user, layout.appRoot);
    migrateRc8UserData(user.root);
    quarantineRevokedPlugins({ userDataRoot: user.root, profileDir: user.profileWeb });
    recoverProfile(user);
    live.attach(layout);
    process.env.PENGLAI_PLUGINS_DIR = join(layout.appRoot, "plugins");
    activatePrivateProfile(layout, user);
    const report = doctor(layout, user);
    const releaseContract = loadUpdaterReleaseContract(resources);
    if (app.getVersion() !== releaseContract.version) {
      throw new PenglaiError("STORE_CORRUPT", "app and embedded release contract versions differ");
    }
    const updater = new AssistedUpdateCoordinator({
      currentVersion: releaseContract.version,
      target: releaseTarget(process.platform, process.arch),
      canonicalManifestUrl: releaseContract.updaterManifestUrl,
      canonicalManifestSignatureUrl: releaseContract.updaterManifestSignatureUrl,
      publicKeyHex: releaseContract.updaterPublicKeyHex,
      signatureKeyId: releaseContract.updaterPublicKeyId,
      discoverUpdates: true,
      trustPath: join(user.root, "update", "trust-state.json"),
      updatesRoot: desktopData.updates,
      journalDir: join(user.root, "update", "journal"),
      ledgerPath: join(user.root, "update", "ledger.json"),
      backupRoot: desktopData.updateBackups,
      manifestPolicy: {
        allowedAssetHosts: releaseContract.updaterAllowedAssetHosts,
        currentOsVersion: process.getSystemVersion(),
      },
    });
    updater.recoverOnLaunch();

    const connectGateway = async (loadRenderer: boolean): Promise<string> => {
      if (live.state !== "healthy") {
        await live.start(user);
      }
      if (live.state !== "healthy" || !live.health) {
        throw new PenglaiError("DSH_UNAVAILABLE", "embedded DSH not healthy");
      }
      await closeProxy();
      const wizardRoot = join(here, "static", "wizard");
      proxy = await startDshProxy({
        token,
        innerPort: live.port,
        wizard: { root: wizardRoot, disabled: onboardingLedgerComplete(user.root) },
      });
      const url = `http://127.0.0.1:${proxy.port}/`;
      allowedOrigin = url;
      await session.defaultSession.cookies.set({
        url,
        name: "penglai_proxy",
        value: token,
        httpOnly: true,
        sameSite: "strict",
      });
      writeFileSync(join(user.root, "gateway.port"), String(proxy.port), { mode: 0o600 });
      if (loadRenderer && !win.isDestroyed()) {
        const target = onboardingLedgerComplete(user.root) ? url : wizardUrlForOrigin(url);
        await Promise.race([
          win.loadURL(target),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("loadURL timeout")), 20_000);
          }),
        ]);
      }
      return url;
    };

    const restartOwnedServices = async (): Promise<void> => {
      if (stopping || win.isDestroyed()) return;
      await connectGateway(true);
    };

    const requireNoArguments = (args: unknown[]): void => {
      if (args.length !== 0) throw new PenglaiError("INVALID_INPUT", "IPC method accepts no arguments");
    };

    const verifyOfficialSurfaces = async (officialUrl: string) => {
      const dom = await observeOfficialDom(win, 20_000);
      if (dom.recovery || dom.protocol === "file:" || !dom.hasDshBoot || !dom.hasRoot) {
        throw new Error("official DSH Web DOM not observed");
      }
      const websocket = await observeOfficialWebsocket(win);
      if (!websocket.opened) throw new Error("official DSH WebSocket did not open");
      const res = await fetch(officialUrl, { headers: { cookie: `penglai_proxy=${token}` } });
      const body = await res.text();
      const http = {
        status: res.status,
        ok: res.ok,
        official: body.includes('id="root"') && !body.includes("data-penglai-recovery"),
      };
      if (http.status !== 200 || !http.official) throw new Error("official DSH HTTP is not 200");
      return { dom, websocket, http };
    };

    for (const name of PRELOAD_API) {
      ipcMain.handle(name, async (event, ...args: unknown[]) => {
        if (!assertIpcName(name) || !allowed.has(event.sender.id)) throw new Error("ipc");
        if (name === "getHealth") {
          requireNoArguments(args);
          return { notice: UNSIGNED_NOTICE, doctor: report, dsh: live.state, pin: PINNED_DSH };
        }
        if (name === "exportPreview") {
          requireNoArguments(args);
          return { files: ["doctor.json"], redacted: true };
        }
        if (name === "createPairing" || name === "startWeixinQr" || name === "listDiagnostics") {
          requireNoArguments(args);
          return { deferred: "use DSH Web Penglai Center / IM settings" };
        }
        if (name === "getUpdateStatus") {
          requireNoArguments(args);
          return updater.status();
        }
        if (name === "checkForUpdate") {
          requireNoArguments(args);
          if (pendingDeletion) throw new PenglaiError("INVALID_INPUT", "data deletion confirmation is active");
          return exclusive(() => updater.check());
        }
        if (name === "downloadUpdate") {
          requireNoArguments(args);
          if (pendingDeletion) throw new PenglaiError("INVALID_INPUT", "data deletion confirmation is active");
          return exclusive(() => updater.download());
        }
        if (name === "cancelUpdate") {
          requireNoArguments(args);
          return updater.cancel();
        }
        if (name === "confirmUpdate") {
          requireNoArguments(args);
          if (pendingDeletion) throw new PenglaiError("INVALID_INPUT", "data deletion confirmation is active");
          const version = updater.status().version ?? "unknown";
          const summary = `Install Penglai ${version} from the verified signed installer. This is not a silent update.`;
          const picked = await dialog.showMessageBox(win, {
            type: "warning",
            buttons: ["Cancel", "Install"],
            defaultId: 1,
            cancelId: 0,
            message: summary,
          });
          if (picked.response !== 1) throw new PenglaiError("SECURITY_POLICY", "owner cancelled update");
          const cap = issueOwnerCapability({ action: "update", summary });
          consumeOwnerCapability({ capabilityId: cap.capabilityId, action: "update", summary });
          return exclusive(async () => {
            let drained = false;
            try {
              const status = await updater.confirmAndHandoff({ confirmed: true }, {
                stopAndDrain: async () => {
                  drained = true;
                  return stopOwnedServices();
                },
                backup: async ({ operationId, fromVersion, toVersion }) =>
                  createSchemaBackup({
                    userData: user.root,
                    backupRoot: desktopData.updateBackups,
                    operationId,
                    fromVersion,
                    toVersion,
                  }),
              });
              const timer = setTimeout(() => app.quit(), 250);
              timer.unref?.();
              return status;
            } catch (error) {
              if (drained) await restartOwnedServices();
              throw error;
            }
          });
        }
        if (name === "getStorageInventory") {
          requireNoArguments(args);
          const protection = readWorkspaceProtection(workspaceProtectionPath);
          return inspectStorageInventory(
            desktopData.managedData,
            protection.roots,
            desktopData.legacyCandidates,
            deletionInspectionOptionsForPlatform(platform, { appRoot: layout.appRoot }),
          );
        }
        if (name === "prepareDataDeletion") {
          if (args.length !== 1) throw new PenglaiError("INVALID_INPUT", "one deletion payload is required");
          const input = parseDeletionPrepareRequest(args[0]);
          return exclusive(async () => {
            if (pendingDeletion) throw new PenglaiError("INVALID_INPUT", "a deletion capability is already active");
            const protection = readWorkspaceProtection(workspaceProtectionPath);
            if (input.categories.includes("cache")) {
              await win.webContents.session.flushStorageData();
            }
            await stopOwnedServices();
            try {
              const authorizer = new DeletionAuthorizer(
                user.root,
                protection.roots,
                desktopData.legacyCandidates,
                desktopData.uninstall,
                {
                  dataLayout: desktopData.managedData,
                  ...deletionInspectionOptionsForPlatform(platform, { appRoot: layout.appRoot }),
                },
              );
              const plan = buildDeletionPlan({
                operationId: `del_${randomBytes(16).toString("hex")}`,
                categories: input.categories,
                userData: user.root,
                confirmCredentials: input.confirmCredentials,
                confirmSensitive: input.confirmSensitive,
                dataLayout: desktopData.managedData,
              });
              const preview = authorizer.prepare(plan);
              pendingDeletion = { authorizer, preview };
              if (platform === "win32") {
                writeWindowsDeletionCapability({
                  journalDir: desktopData.uninstall,
                  operationId: preview.operationId,
                  root: user.root,
                  paths: preview.targets.map((target) => target.path),
                });
              }
              return {
                preview,
                ...(platform === "darwin"
                  ? {
                      guide: macOsUninstallGuide({
                        appPath: installedApplicationPath(process.execPath, process.platform),
                        userData: user.root,
                        selected: preview,
                      }),
                    }
                  : {}),
              };
            } catch (error) {
              await restartOwnedServices();
              throw error;
            }
          });
        }
        if (name === "cancelDataDeletion") {
          if (args.length !== 1) throw new PenglaiError("INVALID_INPUT", "one operation payload is required");
          const input = parseOperationRequest(args[0]);
          return exclusive(async () => {
            if (!pendingDeletion || pendingDeletion.preview.operationId !== input.operationId) {
              throw new PenglaiError("SECURITY_POLICY", "unknown deletion capability");
            }
            pendingDeletion.authorizer.cancel(input.operationId);
            pendingDeletion = undefined;
            if (platform === "win32") clearWindowsDeletionCapability(desktopData.uninstall);
            await restartOwnedServices();
            return { cancelled: true, operationId: input.operationId };
          });
        }
        if (name === "executeDataDeletion") {
          if (args.length !== 1) throw new PenglaiError("INVALID_INPUT", "one operation payload is required");
          const input = parseOperationRequest(args[0], true);
          return exclusive(async () => {
            if (!pendingDeletion || pendingDeletion.preview.operationId !== input.operationId) {
              throw new PenglaiError("SECURITY_POLICY", "unknown deletion capability");
            }
            const current = pendingDeletion;
            const native = await dialog.showMessageBox(win, {
              type: "warning",
              buttons: ["Cancel", "Delete"],
              defaultId: 0,
              cancelId: 0,
              message: "Delete the selected Penglai data now?",
              detail: current.preview.targets
                .map((target) => `${target.path} (${target.entryCount} / ${target.totalBytes})`)
                .slice(0, 20)
                .join("\n"),
            });
            if (native.response !== 1) {
              throw new PenglaiError("SECURITY_POLICY", "native owner confirmation is required for deletion");
            }
            pendingDeletion = undefined;
            try {
              const result = current.authorizer.execute(input.operationId);
              if (platform === "win32") clearWindowsDeletionCapability(desktopData.uninstall);
              const timer = setTimeout(() => app.quit(), 250);
              timer.unref?.();
              return { ...result, operationId: input.operationId, appWillQuit: true };
            } catch (error) {
              await restartOwnedServices();
              throw error;
            }
          });
        }
        if (name === "confirmPluginAction") {
          if (args.length !== 1) throw new PenglaiError("INVALID_INPUT", "one plugin action payload is required");
          const rec = args[0] as { id?: unknown; action?: unknown };
          if (!rec || typeof rec.id !== "string" || !rec.id) {
            throw new PenglaiError("INVALID_INPUT", "plugin id required");
          }
          const mapped: Record<string, PluginOwnerAction> = {
            enable: "plugin-enable",
            installEnable: "plugin-enable",
            update: "plugin-update",
            installDisabled: "plugin-install",
          };
          const ownerAction = typeof rec.action === "string" ? mapped[rec.action] : undefined;
          if (!ownerAction) throw new PenglaiError("INVALID_INPUT", "plugin action required");
          const described = describePluginForOwner(user.root, rec.id);
          const summary = [
            `${ownerAction} ${described.id} ${described.version}`,
            `Publisher: ${described.publisher}`,
            `SHA-256: ${described.sha256}`,
            `Permissions: ${described.permissions.join(", ") || "(none)"}`,
            `Network origins: ${described.networkOrigins.join(", ") || "(none)"}`,
            `Data paths: ${described.dataPaths.join(", ") || "(none)"}`,
            `Native code: ${described.nativeCode ? "yes" : "no"}`,
          ].join("\n");
          const picked = await dialog.showMessageBox(win, {
            type: "warning",
            buttons: ["Cancel", "Allow once"],
            defaultId: 1,
            cancelId: 0,
            message: "Penglai plugin permission",
            detail: summary,
          });
          if (picked.response !== 1) throw new PenglaiError("SECURITY_POLICY", "owner cancelled plugin action");
          const grant = issuePluginOwnerGrant({
            userDataRoot: user.root,
            action: ownerAction,
            pluginId: described.id,
            version: described.version,
            sha256: described.sha256,
            permissionDigest: pluginPermissionDigest({
              permissions: described.permissions,
              networkOrigins: described.networkOrigins,
              dataPaths: described.dataPaths,
              nativeCode: described.nativeCode,
            }),
          });
          if (ownerAction === "plugin-update") {
            pendingPluginRuntimeRestart = issuePluginRuntimeRestart({
              id: described.id,
              version: described.version,
              sha256: described.sha256,
            });
          }
          return { capabilityId: grant.capabilityId };
        }
        if (name === "restartPluginRuntime") {
          if (args.length !== 1) throw new PenglaiError("INVALID_INPUT", "one plugin restart payload is required");
          const rec = args[0] as { id?: unknown };
          if (!rec || typeof rec.id !== "string" || !rec.id) {
            throw new PenglaiError("INVALID_INPUT", "plugin id required");
          }
          const journalPath = join(user.root, "profiles", "center-tx", "journal.json");
          if (!existsSync(journalPath)) {
            throw new PenglaiError("SECURITY_POLICY", "plugin update journal is missing");
          }
          const evidence = JSON.parse(readFileSync(journalPath, "utf8")) as PluginUpdateJournalEvidence;
          const authorized = verifyPluginRuntimeRestart({
            pending: pendingPluginRuntimeRestart,
            requestedId: rec.id,
            journal: evidence,
          });
          pendingPluginRuntimeRestart = undefined;
          const timer = setTimeout(() => {
            void exclusive(async () => {
              await stopOwnedServices();
              await restartOwnedServices();
            }).catch((error) => failProbe(error instanceof Error ? error.message : String(error)));
          }, 100);
          timer.unref?.();
          return {
            scheduled: true,
            id: authorized.id,
            version: authorized.version,
          };
        }
        if (name === "wizardPickFolder") {
          requireNoArguments(args);
          if (onboardingLedgerComplete(user.root)) {
            throw new PenglaiError("SECURITY_POLICY", "folder picker is only available during the pre-DSH wizard");
          }
          const picked = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
          if (picked.canceled || !picked.filePaths[0]) return "";
          return picked.filePaths[0];
        }
        if (name === "pickContextFolder") {
          requireNoArguments(args);
          if (!onboardingLedgerComplete(user.root)) {
            throw new PenglaiError("SECURITY_POLICY", "context folder picker requires completed onboarding");
          }
          const picked = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
          if (picked.canceled || !picked.filePaths[0]) return null;
          return createContextGrantReceipt(user.root, picked.filePaths[0]);
        }
        if (name === "wizardFinished") {
          requireNoArguments(args);
          if (!onboardingLedgerComplete(user.root)) {
            throw new PenglaiError("INVALID_INPUT", "onboarding ledger is not COMPLETE");
          }
          if (!proxy) throw new PenglaiError("DSH_UNAVAILABLE", "authenticated proxy missing");
          const officialUrl = `http://127.0.0.1:${proxy.port}/`;
          // Disable the wizard only after the official surface actually loads;
          // if the switch fails we must restore the wizard so the user is not
          // stranded on a dead /wizard while the official DSH Web is unreachable.
          try {
            await Promise.race([
              win.loadURL(officialUrl),
              new Promise((_, reject) => {
                setTimeout(() => reject(new Error("loadURL timeout")), 20_000);
              }),
            ]);
            const switched = await verifyOfficialSurfaces(officialUrl);
            proxy.setWizardDisabled(true);
            return { switched: true, ...switched };
          } catch (error) {
            proxy.setWizardDisabled(false);
            throw error;
          }
        }
        if (name === "getUninstallGuide") {
          requireNoArguments(args);
          if (platform === "darwin") {
            return macOsUninstallGuide({
              appPath: installedApplicationPath(process.execPath, process.platform),
              userData: user.root,
              ...(pendingDeletion ? { selected: pendingDeletion.preview } : {}),
            });
          }
          return {
            platform: "win32",
            steps: [
              "Close Penglai and use the current-user Penglai uninstaller.",
              "Keep app data by default; delete only a separately confirmed capability plan.",
            ],
            preservesWorkspace: true,
          };
        }
        throw new Error("ipc");
      });
    }
    const url = await connectGateway(true);
    const wizardPending = !onboardingLedgerComplete(user.root);
    let http: { status: number; ok: boolean; official: boolean } = { status: 0, ok: false, official: false };
    let websocket: { opened: boolean; url: string; readyState: number } = { opened: false, url: "", readyState: 3 };
    if (!wizardPending) {
      const official = await verifyOfficialSurfaces(url);
      http = official.http;
      websocket = official.websocket;
    }
    const snapFile = join(user.root, "plugins", "inventory-snapshot.json");
    const inventory =
      live.health?.inventory ??
      readInventorySnapshot(user) ??
      (existsSync(snapFile) ? evaluateInventory(JSON.parse(readFileSync(snapFile, "utf8"))) : { ok: false, credentials: false, pluginCenter: false, im: false, smokeDisabled: false, entries: [] });
    if (!inventory.ok) throw new Error("first-party inventory not loaded");
    const processTree = {
      electronPid: process.pid,
      dshPid: live.childPid ?? 0,
      nodeBin: layout.nodeBin,
      dshEntry: layout.dshEntry,
      nodeExists: existsSync(layout.nodeBin),
      ownedAbsolute: isOwnedRuntimePath(layout.appRoot, layout.nodeBin),
    };
    if (!processTree.dshPid || !processTree.nodeExists || !processTree.ownedAbsolute) {
      throw new Error("owned embedded DSH process tree not observed");
    }
    const pendingUpdate = updater.status();
    if (pendingUpdate.state === "RESTART_PENDING" || pendingUpdate.state === "POST_UPDATE_VERIFY") {
      updater.postVerify({
        version: releaseContract.version,
        runtimeIntegrity: report.runtimeManifest === "pass",
        profileReady: report.profile.exists,
        pluginsReady: inventory.ok,
        dshHealthy: live.state === "healthy",
        installerCancelled: pendingUpdate.version !== releaseContract.version,
      });
    }
    revealWindow();
    if (soakMode) {
      const healthFile = join(user.root, "soak-health.json");
      const writeHealth = (): void => {
        writeFileSync(
          healthFile,
          JSON.stringify({
            at: new Date().toISOString(),
            pid: process.pid,
            dshPid: live.childPid ?? 0,
            url: allowedOrigin,
            http,
            websocket,
            inventoryOk: inventory.ok,
          }),
          { mode: 0o600 },
        );
      };
      writeHealth();
      const timer = setInterval(writeHealth, 15_000);
      timer.unref?.();
    }
  } catch (err) {
    await failProbe(err instanceof Error ? err.message : String(err));
  }
}

void main();
export { main };
