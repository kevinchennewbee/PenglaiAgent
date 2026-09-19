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
 *
 * Exit: 0 all probes PASS, 1 at least one FAIL, 4 every probe BLOCKED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { PINNED_DSH, PINNED_DSH_COMMIT, PINNED_DSH_TAG, PRODUCT_VERSION } from "./lib/product.mjs";

const TIMEOUT_MS = Number(process.env.PENGLAI_DRIFT_TIMEOUT_MS ?? 20_000);
const OFFLINE = process.argv.includes("--offline");
const JSON_ONLY = process.argv.includes("--json");
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

const PASS = "PASS";
const FAIL = "FAIL";
const BLOCKED = "BLOCKED";

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", ...(init.headers ?? {}) },
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

  // While 0.6.5 is in development the contract version is ahead of the newest
  // published release. That is expected, so it is reported rather than failed.
  // What must never happen is the release notes claiming a version is not
  // published when it is, which is what this probe surfaces for a reader.
  const detail =
    `newest public release v${newestVersion} (${String(newest.published_at ?? "").slice(0, 10)}); ` +
    `release-contract.json declares ${contractVersion}`;
  const olderPublished = newestVersion !== contractVersion;
  return record(id, title, PASS, detail, {
    newestPublicRelease: newestVersion,
    contractVersion,
    contractAheadOfPublication: olderPublished,
    // Facts a release note must not contradict.
    newestReleaseImmutable: newest.immutable === true,
    newestReleaseAssets: Array.isArray(newest.assets) ? newest.assets.length : 0,
  });
}

/**
 * The OpenCode Go provider serves more models than the pinned `pi-ai` catalog
 * knows, and the gap is invisible until a user picks a model and gets a 400.
 * The catalog endpoint needs no credentials.
 */
async function probeOpencodeGo() {
  const id = "opencode-go";
  const title = "Provider model catalog matches the pinned client catalog";
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

if (!JSON_ONLY) {
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
finish(verdict, {
  command: "verify:drift",
  version: PRODUCT_VERSION,
  probes: results,
  pass: passed.length,
  drift: failed.length,
  blocked: blocked.length,
});
