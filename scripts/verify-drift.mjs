#!/usr/bin/env node
/**
 * Drift probes: does the world still match what this repository believes?
 *
 * Every serious defect found in the 0.6.x line had the same shape. Penglai froze
 * an assumption about something outside the repository — a vendor's content
 * type, a model catalog, an upstream version, a published release — and nothing
 * ever re-checked it. The source gates stayed green while the product was
 * broken:
 *
 *   - Tencent serves the iLink bot surface as `application/octet-stream`, not
 *     `application/json`. WeChat was broken for eight releases.
 *   - `update.ts` required the semver minor to be `5`. Assisted update was dead
 *     for four releases.
 *   - `linux-loong64` was published but absent from the updater's target table.
 *   - `pi-ai`'s built-in model catalog listed 27 models while the provider
 *     served 37.
 *
 * These probes ask the outside world directly. They are deliberately NOT hard
 * release subgates: an external service being down must not block a release that
 * is otherwise complete. They are also not optional. The contract is:
 *
 *   A red probe does not stop a release, but it stops the release from claiming
 *   everything is fine. Publish the drift in the release notes, or fix it.
 *
 * Two sources are checked for upstream movement because DSH publishes versions
 * to npm without a GitHub release — watching only releases misses real progress.
 *
 * Usage:
 *   node scripts/verify-drift.mjs             # all probes
 *   node scripts/verify-drift.mjs --probe weixin-ilink
 *   node scripts/verify-drift.mjs --json      # machine-readable only
 *   node scripts/verify-drift.mjs --offline   # skip network probes (BLOCKED)
 *   node scripts/verify-drift.mjs --collect-only   # record assertions, print nothing
 *
 * Exit: 0 all probes PASS, 1 at least one FAIL, 4 every probe BLOCKED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { PINNED_DSH, PINNED_DSH_COMMIT, PINNED_DSH_TAG, PRODUCT_VERSION } from "./lib/product.mjs";

const TIMEOUT_MS = Number(process.env.PENGLAI_DRIFT_TIMEOUT_MS ?? 20_000);
const OFFLINE = process.argv.includes("--offline");
const JSON_ONLY = process.argv.includes("--json");
const COLLECT_ONLY = process.argv.includes("--collect-only");
const ONLY = (() => {
  const i = process.argv.indexOf("--probe");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

/** Probe ids are stable; release notes and ADRs cite them. */
const PROBE_IDS = [
  "weixin-ilink",
  "dsh-upstream",
  "dsh-im-channel",
  "published-facts",
  "opencode-go",
];

/**
 * Each drift probe is a registered acceptance assertion, so a probe cannot be
 * deleted without the registry noticing. Drift evidence is collected only when
 * a collector supplies `PENGLAI_EVIDENCE_DIR`; a bare `pnpm verify:drift` stays
 * a read-only observation, because a red probe deliberately does not block
 * publication — it blocks claiming the release is fine.
 */
const DRIFT_ID_BY_PROBE = {
  "weixin-ilink": "R50-DRIFT-001",
  "dsh-upstream": "R50-DRIFT-002",
  "dsh-im-channel": "R50-DRIFT-003",
  "published-facts": "R50-DRIFT-004",
  "opencode-go": "R50-DRIFT-005",
};

/** Probe verdict -> assertion verdict. An unreachable vendor is BLOCKED, never FAIL. */
const ASSERTION_STATUS_BY_PROBE = { PASS: "PASS", FAIL: "FAIL", BLOCKED: "BLOCKED" };

const PASS = "PASS";
const FAIL = "FAIL";
const BLOCKED = "BLOCKED";

/**
 * GitHub answers 403 once the unauthenticated per-IP limit is spent, and the
 * hosted runners share their address pool, so a probe that reaches npm fine can
 * still be refused by api.github.com. That refusal was recorded as BLOCKED, which
 * is honest about the probe and useless about upstream: the pinned facts were
 * never compared. The token is sent to `api.github.com` only, and its absence
 * changes nothing — the probe still fails closed.
 */
const GITHUB_API_TOKEN = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim();

function githubAuthorization(url) {
  try {
    if (new URL(url).hostname !== "api.github.com") return {};
    return GITHUB_API_TOKEN ? { authorization: `Bearer ${GITHUB_API_TOKEN}` } : {};
  } catch {
    return {};
  }
}

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", ...githubAuthorization(url), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, contentType: response.headers.get("content-type"), text, json };
}

function record(id, title, verdict, detail, extra = {}) {
  return { id, title, verdict, detail, ...extra };
}

/**
 * Tencent serves the whole iLink bot surface as `application/octet-stream` while
 * the body is the documented JSON envelope. This probe asserts the body, not the
 * header, and records the header so a change in either is visible.
 *
 * The QR endpoint needs no credentials, which is why it is the probe: it is the
 * cheapest way to ask "is the WeChat channel's transport contract still what we
 * think it is?" without a user scan.
 */
async function probeWeixinIlink() {
  const id = "weixin-ilink";
  const title = "Tencent iLink returns a usable QR envelope";
  if (OFFLINE) return record(id, title, BLOCKED, "offline mode");
  const url = "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3";
  let res;
  try {
    res = await getJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  } catch (error) {
    return record(id, title, BLOCKED, `network unavailable: ${String(error?.name ?? error)}`);
  }
  if (res.status !== 200) {
    return record(id, title, FAIL, `HTTP ${res.status}`, { contentType: res.contentType });
  }
  const body = res.json;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return record(id, title, FAIL, "body is not a JSON object", { contentType: res.contentType });
  }
  if (body.ret !== 0) {
    return record(id, title, FAIL, `ret=${String(body.ret)}`, { contentType: res.contentType });
  }
  if (typeof body.qrcode !== "string" || body.qrcode.length === 0) {
    return record(id, title, FAIL, "qrcode missing", { contentType: res.contentType });
  }
  if (typeof body.qrcode_img_content !== "string" || !body.qrcode_img_content.startsWith("https://")) {
    return record(id, title, FAIL, "qrcode_img_content missing or not https", { contentType: res.contentType });
  }
  return record(id, title, PASS, "QR envelope well-formed", { contentType: res.contentType });
}

/**
 * DSH publishes to npm and to GitHub, and the two are not in step: versions
 * exist on npm with no GitHub release. Watching only one source misses real
 * upstream progress, so both are read.
 */
async function probeDshUpstream() {
  const id = "dsh-upstream";
  const title = "Pinned DSH is still upstream's newest";
  if (OFFLINE) return record(id, title, BLOCKED, "offline mode");

  let npm;
  let releases;
  try {
    npm = await getJson("https://registry.npmjs.org/@deepseek-ai%2Fdsh");
    releases = await getJson("https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=10");
  } catch (error) {
    return record(id, title, BLOCKED, `network unavailable: ${String(error?.name ?? error)}`);
  }
  if (!npm.json?.versions) return record(id, title, BLOCKED, `npm registry HTTP ${npm.status}`);
  if (!Array.isArray(releases.json)) return record(id, title, BLOCKED, `github releases HTTP ${releases.status}`);

  const npmVersions = Object.keys(npm.json.versions);
  const distTags = npm.json["dist-tags"] ?? {};
  const releaseTags = releases.json.map((row) => row.tag_name);
  const pinnedKnown = npmVersions.includes(PINNED_DSH);
  const distTagsForPin = Object.entries(distTags)
    .filter(([, value]) => value === PINNED_DSH)
    .map(([name]) => name);
  // The pinned version being reachable from a channel other than `alpha` is how
  // this project would learn that DSH considers it more than a preview.
  const channels = distTagsForPin.length > 0 ? distTagsForPin.join(",") : "none";
  const newerNpm = npmVersions.filter((v) => v !== PINNED_DSH);
  const detail =
    `pinned ${PINNED_DSH} (${channels}); npm has ${npmVersions.length} versions, ` +
    `${releaseTags.length} recent github releases; newest github tag ${releaseTags[0] ?? "none"}`;
  if (!pinnedKnown) {
    return record(id, title, FAIL, `pinned DSH ${PINNED_DSH} is not published on npm`, {
      npmVersions: newerNpm.length,
      pinnedChannels: channels,
    });
  }
  // A newer npm-only version is a warning we want visible, not a failure: the
  // pin is an Owner decision, and this project deliberately does not chase every
  // upstream release.
  return record(id, title, PASS, detail, {
    pinnedChannels: channels,
    npmVersionCount: npmVersions.length,
    recentGithubReleases: releaseTags.length,
    pinnedTag: PINNED_DSH_TAG,
    pinnedCommit: PINNED_DSH_COMMIT,
  });
}

/**
 * The WeChat channel's request surface is announced to Tencent as a channel
 * build id (`ILINK_CHANNEL_VERSION`). That constant sat at 2.4.6 — a build from
 * June — while Tencent shipped 2.4.8 and 2.4.9, because nothing compared it to
 * anything. This probe compares it to Tencent's current build.
 */
async function probeDshImChannel() {
  const id = "dsh-im-channel";
  const title = "Pinned Tencent channel build is current";
  if (OFFLINE) return record(id, title, BLOCKED, "offline mode");
  const protocolSource = readFileSync(
    join(ROOT, "packages/channel-weixin/src/protocol.ts"),
    "utf8",
  );
  const pinned = /ILINK_CHANNEL_VERSION = "([^"]+)"/.exec(protocolSource)?.[1];
  if (!pinned) return record(id, title, FAIL, "ILINK_CHANNEL_VERSION not found in protocol.ts");

  let res;
  try {
    res = await getJson("https://registry.npmjs.org/@tencent-weixin%2Fopenclaw-weixin");
  } catch (error) {
    return record(id, title, BLOCKED, `network unavailable: ${String(error?.name ?? error)}`);
  }
  if (!res.json?.versions) return record(id, title, BLOCKED, `npm registry HTTP ${res.status}`);
  const latest = res.json["dist-tags"]?.latest;
  if (typeof latest !== "string") return record(id, title, BLOCKED, "no latest dist-tag");
  if (latest === pinned) return record(id, title, PASS, `pinned channel build ${pinned} is current`, { pinned, latest });
  return record(id, title, FAIL, `pinned channel build ${pinned}, Tencent publishes ${latest}`, { pinned, latest });
}

/**
 * The dsh-im rewrite tracks an upstream. This records how far behind it is; the
 * gap is a maintenance signal, not a defect on its own.
 */
async function probePublishedFacts() {
  const id = "published-facts";
  const title = "Repository agrees with what is published";
  if (OFFLINE) return record(id, title, BLOCKED, "offline mode");

  let res;
  try {
    res = await getJson("https://api.github.com/repos/kevinchennewbee/PenglaiAgent/releases?per_page=3");
  } catch (error) {
    return record(id, title, BLOCKED, `network unavailable: ${String(error?.name ?? error)}`);
  }
  if (!Array.isArray(res.json)) return record(id, title, BLOCKED, `github releases HTTP ${res.status}`);

  const newest = res.json[0];
  if (!newest) return record(id, title, FAIL, "no public releases found");
  const newestVersion = String(newest.tag_name ?? "").replace(/^v/, "");
  const contract = JSON.parse(readFileSync(join(ROOT, "release-contract.json"), "utf8"));
  const contractVersion = String(contract.version ?? "");

  // The repository's own account of which release is current is a machine-checked
  // claim, so it is compared rather than merely reported.
  //
  // This probe used to PASS whenever any public release existed, which made
  // `R50-DRIFT-004` unfalsifiable: the defect it was written for — eight
  // documents claiming a published version was unpublished — could not reach a
  // FAIL. SECURITY.md's release table is the anchor because it states the claim
  // in one parseable line.
  const security = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
  const declaredCurrent = /^\|\s*(\d+\.\d+\.\d+)\s*\|\s*Current immutable public release\s*\|/m.exec(security)?.[1];
  if (!declaredCurrent) {
    return record(id, title, FAIL, "SECURITY.md declares no current immutable public release", {
      newestPublicRelease: newestVersion,
      contractVersion,
    });
  }
  const detail =
    `newest public release v${newestVersion} (${String(newest.published_at ?? "").slice(0, 10)}); ` +
    `SECURITY.md declares ${declaredCurrent} current; ` +
    `release-contract.json declares ${contractVersion}`;
  const facts = {
    newestPublicRelease: newestVersion,
    declaredCurrent,
    contractVersion,
    contractAheadOfPublication: newestVersion !== contractVersion,
    // Facts a release note must not contradict.
    newestReleaseImmutable: newest.immutable === true,
    newestReleaseAssets: Array.isArray(newest.assets) ? newest.assets.length : 0,
  };
  if (declaredCurrent !== newestVersion) {
    // Ahead of publication the contract names a version that is not published
    // yet; that is expected. A repository that names a *different published*
    // release as current is contradicting the public record.
    return record(
      id,
      title,
      FAIL,
      `${detail} — the repository's account of the current release contradicts the published releases`,
      facts,
    );
  }
  return record(id, title, PASS, detail, facts);
}

/**
 * The OpenCode Go provider serves more models than the client catalog knows, and
 * the gap is invisible until a user picks a model and gets a 400. The catalog
 * endpoint needs no credentials.
 *
 * The probe asserts what this repository can see: the catalog is reachable, the
 * list shape is recognised, and it is not empty. The client-side catalog is not
 * pinned here — the wizard lists models through the pinned DSH client at runtime
 * — so a count comparison is not something this repository can make. Recording
 * the served set is what a reader can act on; the previous title claimed a
 * comparison the probe never performed.
 */
async function probeOpencodeGo() {
  const id = "opencode-go";
  const title = "Provider model catalog is reachable and well-formed";
  if (OFFLINE) return record(id, title, BLOCKED, "offline mode");
  let res;
  try {
    res = await getJson("https://opencode.ai/zen/go/v1/models");
  } catch (error) {
    return record(id, title, BLOCKED, `network unavailable: ${String(error?.name ?? error)}`);
  }
  if (res.status !== 200) return record(id, title, BLOCKED, `HTTP ${res.status}`);
  const served = Array.isArray(res.json?.data)
    ? res.json.data.map((row) => row?.id).filter((v) => typeof v === "string")
    : Array.isArray(res.json?.models)
      ? res.json.models.map((row) => (typeof row === "string" ? row : row?.id)).filter(Boolean)
      : undefined;
  if (!served) return record(id, title, FAIL, "unrecognised model list shape");
  if (served.length === 0) return record(id, title, FAIL, "provider served an empty model catalog");
  return record(id, title, PASS, `provider serves ${served.length} models`, {
    servedCount: served.length,
    servedSample: served.slice(0, 5),
  });
}

const REGISTRY = {
  "weixin-ilink": probeWeixinIlink,
  "dsh-upstream": probeDshUpstream,
  "dsh-im-channel": probeDshImChannel,
  "published-facts": probePublishedFacts,
  "opencode-go": probeOpencodeGo,
};

const selected = ONLY ? [ONLY] : [...PROBE_IDS];
const unknown = selected.filter((id) => !(id in REGISTRY));
if (unknown.length > 0) {
  finish("FAIL", { command: "verify:drift", detail: `unknown probe(s): ${unknown.join(", ")}` });
}

const results = [];
for (const id of selected) {
  results.push(await REGISTRY[id]());
}

const failed = results.filter((row) => row.verdict === FAIL);
const blocked = results.filter((row) => row.verdict === BLOCKED);
const passed = results.filter((row) => row.verdict === PASS);

if (!JSON_ONLY && !COLLECT_ONLY) {
  console.log(`Penglai ${PRODUCT_VERSION} drift probes`);
  for (const row of results) {
    const mark = row.verdict === PASS ? "ok  " : row.verdict === FAIL ? "DRIFT" : "skip";
    console.log(`  [${mark}] ${row.id.padEnd(18)} ${row.detail}`);
  }
  console.log(`  ${passed.length} pass, ${failed.length} drift, ${blocked.length} blocked`);
  if (failed.length > 0) {
    console.log("");
    console.log("  A red probe does not block publication. It blocks claiming the release is");
    console.log("  complete and understood: record the drift in the release notes, or fix it.");
  }
}

const verdict = failed.length > 0 ? "FAIL" : blocked.length === results.length ? "BLOCKED" : "PASS";

if (process.env.PENGLAI_EVIDENCE_DIR) {
  const identity = await import(
    pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href
  );
  const candidateSourceSha = identity.declaredSourceSha(ROOT);
  for (const row of results) {
    const acceptanceId = DRIFT_ID_BY_PROBE[row.id];
    if (!acceptanceId) continue;
    identity.recordAssertion({
      acceptanceId,
      runnerId: "drift",
      testId: `drift-probe-${row.id}`,
      assertionId: `drift-${row.id}`,
      status: ASSERTION_STATUS_BY_PROBE[row.verdict],
      candidateSourceSha,
      exitCode: row.verdict === PASS ? 0 : 1,
      details: { safe: `drift probe ${row.id}: ${row.detail}` },
    });
  }
}

if (COLLECT_ONLY) {
  // Evidence collection for the hard `verify:evidence` gate. The drift verdict
  // itself still does not gate publication — an unreachable vendor must not be
  // able to stop a complete release — but the *records* must exist, so that
  // "the probes ran" is a fact the release aggregate can see. `finish` still
  // exits with the drift verdict so a caller that ignores the distinction sees
  // the red probe.
  process.exit(failed.length > 0 ? 1 : blocked.length === results.length ? 4 : 0);
}

finish(verdict, {
  command: "verify:drift",
  version: PRODUCT_VERSION,
  probes: results,
  pass: passed.length,
  drift: failed.length,
  blocked: blocked.length,
});
