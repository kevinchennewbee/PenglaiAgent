import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDirectoryPickerBackend } from "@deepseek-ai/dsh-host-directory-picker-auto";
import {
  OFFICIAL_DIRECTORY_PICKER_HOST,
  OFFICIAL_DIRECTORY_PICKER_SURFACE,
  pinOfficialBrowseDirectoryPicker,
  pinOfficialBrowseDirectoryPickerPatch,
  resolveUserLayout,
} from "./index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SEED_PATCH = join(REPO_ROOT, "profile-seed", "web", "cordis.patch.yml");
const CURRENT_SEED_WITHOUT_PICKER = `- insert:
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

test("product web seed pins official browse host and client, not auto or native", () => {
  const patch = readFileSync(SEED_PATCH, "utf8").replace(/\r\n/g, "\n");
  assert.match(patch, new RegExp(`id: directory-picker\\n\\s+name: "${OFFICIAL_DIRECTORY_PICKER_HOST}"`));
  assert.match(
    patch,
    new RegExp(`id: ui-directory-picker\\n\\s+name: "${OFFICIAL_DIRECTORY_PICKER_SURFACE}"`),
  );
  assert.doesNotMatch(patch, /id: directory-picker\n\s+name: "@deepseek-ai\/dsh-host-directory-picker-auto"/);
  assert.doesNotMatch(patch, /id: directory-picker\n\s+name: "@deepseek-ai\/dsh-host-directory-picker-native"/);
  assert.match(patch, /id: penglai-memory\n\s+name: "@penglai\/memory"/);
  assert.match(patch, /id: penglai-office\n\s+name: "@penglai\/office"/);
  assert.match(patch, /id: penglai-im\n\s+name: "@penglai\/im"\n\s+disabled: true/);
});

test("browse pin is idempotent and preserves current-generation plugin rows", () => {
  const first = pinOfficialBrowseDirectoryPickerPatch(CURRENT_SEED_WITHOUT_PICKER);
  assert.equal(first.changed, true);
  assert.match(first.text, /id: penglai-im\n\s+name: "@penglai\/im"\n\s+disabled: true/);
  assert.match(first.text, /id: penglai-memory\n\s+name: "@penglai\/memory"/);
  assert.match(first.text, /compression: none/);
  assert.match(first.text, new RegExp(`name: "${OFFICIAL_DIRECTORY_PICKER_HOST}"`));
  assert.match(first.text, new RegExp(`name: "${OFFICIAL_DIRECTORY_PICKER_SURFACE}"`));
  const second = pinOfficialBrowseDirectoryPickerPatch(first.text);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test("browse pin rewrites an auto overlay without dropping later insert rows", () => {
  const auto = `- id: directory-picker\n  name: "@deepseek-ai/dsh-host-directory-picker-auto"\n- insert:\n    - id: penglai-office\n      name: "@penglai/office"\n`;
  const next = pinOfficialBrowseDirectoryPickerPatch(auto);
  assert.equal(next.changed, true);
  assert.match(next.text, /id: directory-picker\n\s+name: "@deepseek-ai\/dsh-host-directory-picker-browse"/);
  assert.doesNotMatch(next.text, /dsh-host-directory-picker-auto/);
  assert.match(next.text, /id: penglai-office\n\s+name: "@penglai\/office"/);
  assert.match(next.text, /id: ui-directory-picker/);
});

test("already-onboarded current-generation profiles receive the browse overlay without a reseed", () => {
  const user = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-user-")));
  mkdirSync(user.profileWeb, { recursive: true, mode: 0o700 });
  writeFileSync(join(user.profileWeb, "cordis.patch.yml"), CURRENT_SEED_WITHOUT_PICKER, { mode: 0o600 });
  assert.equal(pinOfficialBrowseDirectoryPicker(user), true);
  const patch = readFileSync(join(user.profileWeb, "cordis.patch.yml"), "utf8");
  assert.match(patch, /id: directory-picker\n\s+name: "@deepseek-ai\/dsh-host-directory-picker-browse"/);
  assert.match(patch, /id: ui-directory-picker\n\s+name: "@deepseek-ai\/dsh-client-ui-directory-picker-browse"/);
  assert.match(patch, /id: penglai-im\n\s+name: "@penglai\/im"\n\s+disabled: true/);
  assert.equal(pinOfficialBrowseDirectoryPicker(user), false);
  const source = readFileSync(join(REPO_ROOT, "packages", "runtime", "src", "index.ts"), "utf8");
  assert.match(source, /pinOfficialBrowseDirectoryPicker\(user\)/);
});

test("wizard folder picker stays pre-DSH-only and does not replace official workspace adoption", () => {
  const main = readFileSync(join(REPO_ROOT, "apps", "desktop", "src", "electron-main.ts"), "utf8");
  assert.match(main, /wizardPickFolder/);
  assert.match(main, /folder picker is only available during the pre-DSH wizard/);
  assert.match(main, /pickContextFolder/);
  assert.match(main, /context folder picker requires completed onboarding/);
  assert.doesNotMatch(main, /directory-picker-native|choose folder/);
});
