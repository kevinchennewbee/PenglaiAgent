import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Test-fixture launch boundary: persisted readiness belongs to the old process. */
export async function observeFreshInstalledBoot(userData, launch, timeoutMs = 120_000) {
  const gatewayPath = join(userData, "gateway.port");
  const inventoryPath = join(userData, "plugins", "inventory-snapshot.json");
  for (const path of [gatewayPath, inventoryPath]) rmSync(path, { force: true });
  const launched = launch();
  const deadline = Date.now() + timeoutMs;
  let gateway = false;
  let inventory = false;
  while (Date.now() < deadline) {
    const alive = launched.child.exitCode === null && !launched.child.signalCode;
    if (!alive) break;
    gateway = existsSync(gatewayPath);
    inventory = existsSync(inventoryPath);
    if (gateway && inventory) return { launched, gateway, inventory, freshReadiness: true };
    await delay(100);
  }
  return { launched, gateway, inventory, freshReadiness: false };
}

/** Restart must keep persisted profile identity; only the live gateway marker is cleared. */
export async function observeInstalledRestart(userData, launch, previousIdentity, timeoutMs = 120_000) {
  const gatewayPath = join(userData, "gateway.port");
  rmSync(gatewayPath, { force: true });
  const launched = launch();
  const deadline = Date.now() + timeoutMs;
  let gateway = false;
  while (Date.now() < deadline) {
    const alive = launched.child.exitCode === null && !launched.child.signalCode;
    if (!alive) break;
    gateway = existsSync(gatewayPath);
    if (gateway) {
      return {
        launched,
        gateway,
        inventory: existsSync(join(userData, "plugins", "inventory-snapshot.json")),
        freshReadiness: true,
        previousIdentity,
      };
    }
    await delay(100);
  }
  return {
    launched,
    gateway,
    inventory: existsSync(join(userData, "plugins", "inventory-snapshot.json")),
    freshReadiness: false,
    previousIdentity,
  };
}
