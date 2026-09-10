import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { resolveDirectoryPickerBackend } from "@deepseek-ai/dsh-host-directory-picker-auto";
import {
  OFFICIAL_DIRECTORY_PICKER_AUTO,
  OFFICIAL_DIRECTORY_PICKER_HOST,
  OFFICIAL_DIRECTORY_PICKER_ID,
  OFFICIAL_DIRECTORY_PICKER_NATIVE_CLIENT,
  OFFICIAL_DIRECTORY_PICKER_NATIVE_HOST,
  OFFICIAL_DIRECTORY_PICKER_SURFACE,
  PENGLAI_DIRECTORY_PICKER_HOST_ID,
  PENGLAI_DIRECTORY_PICKER_SURFACE_ID,
  pinOfficialBrowseDirectoryPicker,
  pinOfficialBrowseDirectoryPickerPatch,
  resolveUserLayout,
} from "./index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SEED_PATCH = join(REPO_ROOT, "profile-seed", "web", "cordis.patch.yml");
const BASE_PATCH = join(REPO_ROOT, "node_modules/@deepseek-ai/dsh-base/cordis.patch.yml");
const WEB_PATCH = join(REPO_ROOT, "node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml");

const PRE_DCE_OVERLAY = `- insert:
    - id: penglai-plugin-center
      name: "@penglai/plugin-center"
    - id: penglai-im
      name: "@penglai/im"
      disabled: true
    - id: penglai-memory
      name: "@penglai/memory"
    - id: penglai-office
      name: "@penglai/office"
- id: session-persistence-jsonl
  name: "@deepseek-ai/dsh-session-persistence-jsonl"
  config:
    root: !!js dshHomePath('sessions')
    compression: none
`;

const DCE_INEFFECTIVE_OVERLAY = `${PRE_DCE_OVERLAY}- id: directory-picker
  name: "@deepseek-ai/dsh-host-directory-picker-browse"
- insert:
    - id: ui-directory-picker
      name: "@deepseek-ai/dsh-client-ui-directory-picker-browse"
`;

const MALFORMED_OWNED_OVERLAY = `- insert:
    - id: penglai-office
      name: "@penglai/office"
    - id: ui-directory-picker
      name: "@deepseek-ai/dsh-client-ui-directory-picker-browse"
    - id: ui-directory-picker
      name: "@deepseek-ai/dsh-client-ui-directory-picker-browse"
    - id: leftover-native
      name: "@deepseek-ai/dsh-host-directory-picker-native"
    - id: penglai-directory-picker
      name: "@deepseek-ai/dsh-host-directory-picker-browse"
      disabled: true
- id: directory-picker
  name: "@deepseek-ai/dsh-host-directory-picker-browse"
- id: extra-browse-host
  name: "@deepseek-ai/dsh-host-directory-picker-browse"
- id: session-persistence-jsonl
  name: "@deepseek-ai/dsh-session-persistence-jsonl"
  config:
    root: !!js dshHomePath('sessions')
    compression: none
- id: custom-scopes
  config:
    scopes:
      - workspace
`;

type Entry = {
  id?: string;
  name?: string;
  disabled?: boolean | null;
  group?: boolean | null;
  config?: unknown;
};

function loadPatch(text: string): Entry[] {
  const parsed = yaml.load(text, { schema: entryListSchema });
  assert.ok(Array.isArray(parsed), "overlay must be a YAML list");
  return parsed as Entry[];
}

function flattenEntries(entries: Entry[], acc: Entry[] = []): Entry[] {
  for (const entry of entries) {
    acc.push(entry);
    if (entry.group && Array.isArray(entry.config)) flattenEntries(entry.config as Entry[], acc);
  }
  return acc;
}

function applyOfficialThenOverlay(overlayText: string): { entries: Entry[]; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (message: string, ...args: unknown[]): void => {
    let index = 0;
    warnings.push(message.replace(/%C/g, () => String(args[index++])));
  };
  let data: Entry[] = [];
  data = applyEntryPatches(data, loadPatch(readFileSync(BASE_PATCH, "utf8")), warn);
  data = applyEntryPatches(data, loadPatch(readFileSync(WEB_PATCH, "utf8")), warn);
  data = applyEntryPatches(data, loadPatch(overlayText), warn);
  return { entries: flattenEntries(data), warnings };
}

function enabledNamed(entries: Entry[], name: string): Entry[] {
  return entries.filter((entry) => entry.name === name && entry.disabled !== true);
}

function assertEffectiveBrowsePair(entries: Entry[], warnings: string[]): void {
  const auto = entries.find((entry) => entry.id === OFFICIAL_DIRECTORY_PICKER_ID);
  assert.equal(auto?.name, OFFICIAL_DIRECTORY_PICKER_AUTO);
  assert.equal(auto?.disabled, true);
  const hosts = enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_HOST);
  const clients = enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_SURFACE);
  assert.equal(hosts.length, 1, "exactly one enabled browse host");
  assert.equal(clients.length, 1, "exactly one enabled browse client");
  assert.equal(hosts[0]?.id, PENGLAI_DIRECTORY_PICKER_HOST_ID);
  assert.equal(clients[0]?.id, PENGLAI_DIRECTORY_PICKER_SURFACE_ID);
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_NATIVE_HOST).length, 0);
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_NATIVE_CLIENT).length, 0);
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_AUTO).length, 0);
  const ids = entries.map((entry) => entry.id).filter((id): id is string => Boolean(id));
  assert.equal(ids.length, new Set(ids).size, "no duplicate entry ids");
  assert.equal(
    warnings.some((row) => row.includes("name mismatch")),
    false,
    warnings.join("\n"),
  );
  assert.ok(entries.some((entry) => entry.id === "plugin-inventory"));
  assert.ok(entries.some((entry) => entry.id === "workspace"));
}

test("official auto picker selects native on Darwin loopback desktop hosts", () => {
  assert.equal(
    resolveDirectoryPickerBackend({
      bindHost: "127.0.0.1",
      platform: "darwin",
      ssh: false,
      env: {},
      linuxChooser: false,
    }),
    "native",
  );
});

test("dce name-swap overlay does not disable auto and inserts only a browse client", () => {
  const { entries, warnings } = applyOfficialThenOverlay(DCE_INEFFECTIVE_OVERLAY);
  const auto = entries.find((entry) => entry.id === OFFICIAL_DIRECTORY_PICKER_ID);
  assert.equal(auto?.name, OFFICIAL_DIRECTORY_PICKER_AUTO);
  assert.notEqual(auto?.disabled, true);
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_HOST).length, 0);
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_SURFACE).length, 1);
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_SURFACE)[0]?.id, "ui-directory-picker");
  assert.equal(
    warnings.some((row) => row.includes("name mismatch") && row.includes(OFFICIAL_DIRECTORY_PICKER_ID)),
    true,
    warnings.join("\n"),
  );
});

test("product seed overlay disables auto and mounts exactly one browse host/client pair", () => {
  const overlay = readFileSync(SEED_PATCH, "utf8");
  const { entries, warnings } = applyOfficialThenOverlay(overlay);
  assertEffectiveBrowsePair(entries, warnings);
  const memory = entries.find((entry) => entry.id === "penglai-memory");
  const office = entries.find((entry) => entry.id === "penglai-office");
  const im = entries.find((entry) => entry.id === "penglai-im");
  const persistence = entries.find((entry) => entry.id === "session-persistence-jsonl");
  assert.equal(memory?.name, "@penglai/memory");
  assert.notEqual(memory?.disabled, true);
  assert.equal(office?.name, "@penglai/office");
  assert.notEqual(office?.disabled, true);
  assert.equal(im?.disabled, true);
  assert.equal((persistence?.config as { compression?: string } | undefined)?.compression, "none");
  assert.equal(
    (persistence?.config as { root?: { __jsExpr?: string } } | undefined)?.root?.__jsExpr,
    "dshHomePath('sessions')",
  );
});

test("fresh 712 overlay migrates to effective browse composition without dropping plugins", () => {
  const first = pinOfficialBrowseDirectoryPickerPatch(PRE_DCE_OVERLAY);
  assert.equal(first.changed, true);
  const { entries, warnings } = applyOfficialThenOverlay(first.text);
  assertEffectiveBrowsePair(entries, warnings);
  assert.equal(entries.find((entry) => entry.id === "penglai-im")?.disabled, true);
  assert.equal(entries.find((entry) => entry.id === "penglai-memory")?.name, "@penglai/memory");
  const second = pinOfficialBrowseDirectoryPickerPatch(first.text);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test("dce ineffective overlay is normalized to one browse pair and disabled auto", () => {
  const first = pinOfficialBrowseDirectoryPickerPatch(DCE_INEFFECTIVE_OVERLAY);
  assert.equal(first.changed, true);
  assert.doesNotMatch(first.text, /id: ui-directory-picker/);
  assert.doesNotMatch(
    first.text,
    /id: directory-picker\n\s+name: "@deepseek-ai\/dsh-host-directory-picker-browse"/,
  );
  const { entries, warnings } = applyOfficialThenOverlay(first.text);
  assertEffectiveBrowsePair(entries, warnings);
  const second = pinOfficialBrowseDirectoryPickerPatch(first.text);
  assert.equal(second.changed, false);
});

test("malformed owned picker rows are collapsed without dropping unrelated plugins or !!js", () => {
  const next = pinOfficialBrowseDirectoryPickerPatch(MALFORMED_OWNED_OVERLAY);
  assert.equal(next.changed, true);
  assert.match(next.text, /id: custom-scopes\n\s+config:\n\s+scopes:\n\s+- workspace/);
  assert.match(next.text, /id: penglai-office\n\s+name: "@penglai\/office"/);
  assert.doesNotMatch(next.text, /id: ui-directory-picker/);
  assert.doesNotMatch(next.text, /id: leftover-native/);
  assert.doesNotMatch(next.text, /id: extra-browse-host/);
  assert.equal([...next.text.matchAll(/id: penglai-directory-picker$/gm)].length, 1);
  const { entries, warnings } = applyOfficialThenOverlay(next.text);
  assertEffectiveBrowsePair(entries, warnings);
  assert.equal(entries.find((entry) => entry.id === "penglai-office")?.name, "@penglai/office");
  assert.equal(
    (entries.find((entry) => entry.id === "session-persistence-jsonl")?.config as { root?: { __jsExpr?: string } })
      ?.root?.__jsExpr,
    "dshHomePath('sessions')",
  );
  assert.equal(enabledNamed(entries, OFFICIAL_DIRECTORY_PICKER_NATIVE_HOST).length, 0);
  const second = pinOfficialBrowseDirectoryPickerPatch(next.text);
  assert.equal(second.changed, false);
});

test("already-onboarded current-generation profiles receive the effective overlay without a reseed", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(user.profileWeb, { recursive: true, mode: 0o700 });
  writeFileSync(join(user.profileWeb, "cordis.patch.yml"), DCE_INEFFECTIVE_OVERLAY, { mode: 0o600 });
  assert.equal(pinOfficialBrowseDirectoryPicker(user), true);
  const patch = readFileSync(join(user.profileWeb, "cordis.patch.yml"), "utf8");
  const { entries, warnings } = applyOfficialThenOverlay(patch);
  assertEffectiveBrowsePair(entries, warnings);
  assert.equal(pinOfficialBrowseDirectoryPicker(user), false);
  const source = readFileSync(join(REPO_ROOT, "packages", "runtime", "src", "index.ts"), "utf8");
  assert.match(source, /pinOfficialBrowseDirectoryPicker\(user\)/);
});

test("current seed pin is already canonical", () => {
  const seed = readFileSync(SEED_PATCH, "utf8");
  const pinned = pinOfficialBrowseDirectoryPickerPatch(seed);
  assert.equal(pinned.changed, false, pinned.text);
});

test("browse pin is a no-op when the overlay file is absent", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(user.profileWeb, { recursive: true, mode: 0o700 });
  assert.equal(pinOfficialBrowseDirectoryPicker(user), false);
});

test("browse pin refuses a symlink overlay and does not follow it", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(user.profileWeb, { recursive: true, mode: 0o700 });
  const outside = join(user.root, "outside.yml");
  writeFileSync(outside, PRE_DCE_OVERLAY, { mode: 0o600 });
  symlinkSync(outside, join(user.profileWeb, "cordis.patch.yml"));
  assert.throws(() => pinOfficialBrowseDirectoryPicker(user), /symlink/);
  assert.equal(readFileSync(outside, "utf8"), PRE_DCE_OVERLAY);
});

test("wizard folder picker stays pre-DSH-only and does not replace official workspace adoption", () => {
  const main = readFileSync(join(REPO_ROOT, "apps", "desktop", "src", "electron-main.ts"), "utf8");
  assert.match(main, /wizardPickFolder/);
  assert.match(main, /folder picker is only available during the pre-DSH wizard/);
  assert.match(main, /pickContextFolder/);
  assert.match(main, /context folder picker requires completed onboarding/);
  assert.doesNotMatch(main, /directory-picker-native|choose folder/);
});
