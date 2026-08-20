import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { createUsableLlmServer } from "./lib/usable-llm.mjs";
import {
  EmbeddedDshSupervisor,
  activatePrivateProfile,
  ensurePrivateHome,
  leftoverDsh,
  resolveRuntimeLayout,
  resolveUserLayout,
} from "../packages/runtime/src/index.ts";

const fixture = createUsableLlmServer();
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const faddr = fixture.address();
const fport = typeof faddr === "object" && faddr ? faddr.port : 0;
process.env.PENGLAI_FIXTURE_URL = `http://127.0.0.1:${fport}/v1`;

const layout = resolveRuntimeLayout(join(ROOT, "dist/runtime-staging"));
const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-usable-host-")));
ensurePrivateHome(user);
activatePrivateProfile(layout, user);
process.env.PENGLAI_USER_DATA = user.root;
process.env.PENGLAI_PLUGINS_DIR = layout.pluginsDir;
const credDir = join(user.root, "fixture-credentials");
mkdirSync(credDir, { recursive: true, mode: 0o700 });
process.env.PENGLAI_TEST_CREDENTIAL_DIR = credDir;
const sup = new EmbeddedDshSupervisor(layout);
try {
  const { port } = await sup.start(user, {
    PENGLAI_FIXTURE_URL: process.env.PENGLAI_FIXTURE_URL,
    PENGLAI_PLUGINS_DIR: layout.pluginsDir,
    PENGLAI_TEST_CREDENTIAL_DIR: credDir,
  });
  const res = await fetch(`http://127.0.0.1:${port}/penglai/usable-fixture`);
  const text = await res.text();
  console.log("usable-host", res.status, text.slice(0, 800));
  if (!res.ok || !text.includes("penglai-usable-ok")) {
    writeFileSync(join(user.logs, "usable-host.fail.log"), `${sup.logs}\n---\n${text}`, { mode: 0o600 });
    throw new Error(`usable host fixture failed ${res.status} ${text.slice(0, 800)}\nlogs=${sup.logs.slice(-1200)}`);
  }
  const body = JSON.parse(text);
  await sup.stop();
  const left = leftoverDsh(layout);
  if (left.length) throw new Error(`leftovers ${JSON.stringify(left)}`);
  mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
  writeFileSync(
    join(ROOT, "evidence/generated/usable-host.json"),
    JSON.stringify({ command: "verify:usable-host", verdict: "PASS", leftovers: 0, usable: body }, null, 2),
  );
} finally {
  await new Promise((r) => fixture.close(r));
  try {
    await sup.stop();
  } catch {
    /* done */
  }
  rmSync(user.root, { recursive: true, force: true });
}
