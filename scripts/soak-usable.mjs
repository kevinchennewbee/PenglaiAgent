import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import {
  EmbeddedDshSupervisor,
  activatePrivateProfile,
  ensurePrivateHome,
  leftoverDsh,
  resolveRuntimeLayout,
  resolveUserLayout,
} from "../packages/runtime/src/index.ts";

const ms = Number(process.env.PENGLAI_SOAK_MS ?? 7_200_000);
const staging = join(ROOT, "dist/runtime-staging");
const layout = resolveRuntimeLayout(staging);
const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-soak-")));
ensurePrivateHome(user);
activatePrivateProfile(layout, user);
const sup = new EmbeddedDshSupervisor(layout);
const started = Date.now();
let checks = 0;
try {
  await sup.start(user);
  while (Date.now() - started < ms) {
    const res = await fetch(`http://127.0.0.1:${sup.port}/`);
    if (res.status !== 200) throw new Error(`soak http ${res.status}`);
    if (sup.state !== "healthy") throw new Error(`soak state ${sup.state}`);
    checks += 1;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  await sup.stop();
  const left = leftoverDsh(layout);
  if (left.length) throw new Error(`soak leftovers ${JSON.stringify(left)}`);
  const rec = { command: "test:soak:usable", verdict: "PASS", ms, checks, leftovers: 0 };
  mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
  writeFileSync(join(ROOT, "evidence/generated/soak-usable.json"), JSON.stringify(rec, null, 2));
  console.log(JSON.stringify(rec));
} catch (err) {
  try {
    await sup.stop();
  } catch {
    /* already */
  }
  const rec = { command: "test:soak:usable", verdict: "FAIL", reason: err instanceof Error ? err.message : String(err), checks };
  mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
  writeFileSync(join(ROOT, "evidence/generated/soak-usable.json"), JSON.stringify(rec, null, 2));
  console.error(JSON.stringify(rec));
  process.exit(1);
} finally {
  rmSync(user.root, { recursive: true, force: true });
}
