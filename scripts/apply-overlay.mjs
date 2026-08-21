import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function replaceExactlyOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`overlay transform anchor mismatch ${label}`);
  }
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

export function applyInlineTransform(source, transform) {
  if (transform !== "settings-submenu-v1") {
    throw new Error(`unknown overlay transform ${transform}`);
  }
  let text = source.toString("utf8");
  text = replaceExactlyOnce(
    text,
    '.VOzbGW_navLabel{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;overflow:hidden}.VOzbGW_content',
    '.VOzbGW_navLabel{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;overflow:hidden}.VOzbGW_navChildren{flex-direction:column;gap:2px;margin:0 0 2px 20px;padding-left:8px;border-left:1px solid var(--dsw-alias-border-l2);display:flex}.VOzbGW_navCellChild{height:34px;border-radius:10px;padding:6px 10px;font-size:13px}.VOzbGW_content',
    "settings-submenu-css",
  );
  text = replaceExactlyOnce(
    text,
    '\t\t\t"navCell": "VOzbGW_navCell",\n\t\t\t"navIcon": "VOzbGW_navIcon",',
    '\t\t\t"navCell": "VOzbGW_navCell",\n\t\t\t"navCellChild": "VOzbGW_navCellChild",\n\t\t\t"navChildren": "VOzbGW_navChildren",\n\t\t\t"navIcon": "VOzbGW_navIcon",',
    "settings-submenu-css-map",
  );
  text = replaceExactlyOnce(
    text,
    `\t\t\t\t\t\t\tchildren: rows.map((row) => (0, react_jsx_runtime.jsxs)("button", {\n\t\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\t\tclassName: clsx(SettingsRoot_module_css_default.navCell, row.id === active && SettingsRoot_module_css_default.active),\n\t\t\t\t\t\t\t\t"aria-current": row.id === active ? "true" : void 0,\n\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\tonSelect(row.id);\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\tchildren: [navIcon(row.id), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\t\tclassName: SettingsRoot_module_css_default.navLabel,\n\t\t\t\t\t\t\t\t\tchildren: row.label\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}, row.id))`,
    `\t\t\t\t\t\t\tchildren: (() => {\n\t\t\t\t\t\t\t\tconst isPenglaiChild = (entry) => entry.id.startsWith("penglai-") && entry.id !== "penglai-center";\n\t\t\t\t\t\t\t\treturn rows.filter((row) => !isPenglaiChild(row)).map((row) => {\n\t\t\t\t\t\t\t\t\tconst children = row.id === "penglai-center" ? rows.filter(isPenglaiChild) : [];\n\t\t\t\t\t\t\t\t\tconst button = (entry, child = false) => (0, react_jsx_runtime.jsxs)("button", {\n\t\t\t\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\t\t\t\tclassName: clsx(SettingsRoot_module_css_default.navCell, child && SettingsRoot_module_css_default.navCellChild, entry.id === active && SettingsRoot_module_css_default.active),\n\t\t\t\t\t\t\t\t\t\t"aria-current": entry.id === active ? "true" : void 0,\n\t\t\t\t\t\t\t\t\t\tonClick: () => { onSelect(entry.id); },\n\t\t\t\t\t\t\t\t\t\tchildren: [child ? null : navIcon(entry.id), (0, react_jsx_runtime.jsx)("span", { className: SettingsRoot_module_css_default.navLabel, children: entry.label })]\n\t\t\t\t\t\t\t\t\t}, entry.id);\n\t\t\t\t\t\t\t\t\treturn (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [button(row), children.length > 0 && (0, react_jsx_runtime.jsx)("div", { className: SettingsRoot_module_css_default.navChildren, "data-settings-parent": row.id, children: children.map((child) => button(child, true)) })] }, row.id);\n\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t})()`,
    "settings-submenu-nav",
  );
  return Buffer.from(text);
}

export function loadOverlayManifest() {
  const dir = join(ROOT, "overlays/dsh-0.1.1-rc.1");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (manifest.dsh !== "0.1.1-rc.1" || manifest.kind !== "ui-only") {
    throw new Error("overlay manifest identity drift");
  }
  return { dir, manifest };
}

const BRAND_FILES = [
  "logo-64.png",
  "logo-256.png",
  "ink-wash-light.jpg",
  "ink-wash-dark.jpg",
  "title.js",
];

export function applyBrandAssets(
  dshRoot,
  overlayDir = join(ROOT, "overlays/dsh-0.1.1-rc.1"),
) {
  const dest = join(
    dshRoot,
    "node_modules/@deepseek-ai/dsh-web-frontend/dist/penglai-brand",
  );
  mkdirSync(dest, { recursive: true });
  const { manifest } = loadOverlayManifest();
  const expected = new Map(
    (manifest.brand ?? []).map((row) => [row.name, row.sha256]),
  );
  for (const name of BRAND_FILES) {
    const src = join(overlayDir, "brand", name);
    if (!existsSync(src))
      throw new Error(`overlay brand asset missing ${name}`);
    const digest = sha256(readFileSync(src));
    const want = expected.get(name);
    if (!want) throw new Error(`overlay brand hash missing ${name}`);
    if (digest !== want) throw new Error(`overlay brand hash mismatch ${name}`);
    copyFileSync(src, join(dest, name));
  }
  return dest;
}

export function applyOverlayToRoot(dshRoot) {
  const { dir, manifest } = loadOverlayManifest();
  applyBrandAssets(dshRoot, dir);
  const applied = [];
  for (const file of manifest.files) {
    const target = join(dshRoot, file.relative);
    if (!existsSync(target)) {
      throw new Error(`overlay target missing ${file.relative}`);
    }
    const current = sha256(readFileSync(target));
    if (file.transform && current === file.patchedSha256) {
      applied.push({ id: file.id, status: "already-applied" });
      continue;
    }
    const upstream = file.upstream
      ? readFileSync(join(dir, file.upstream))
      : readFileSync(target);
    const patched = file.transform
      ? applyInlineTransform(upstream, file.transform)
      : readFileSync(join(dir, file.patched));
    const patchedSha = sha256(patched);
    if (patchedSha !== file.patchedSha256) {
      throw new Error(`overlay patched blob drift ${file.id}`);
    }
    if (sha256(upstream) !== file.upstreamSha256) {
      throw new Error(`overlay upstream blob drift ${file.id}`);
    }
    if (current === file.patchedSha256) {
      applied.push({ id: file.id, status: "already-applied" });
      continue;
    }
    if (current !== file.upstreamSha256) {
      throw new Error(`overlay target hash mismatch ${file.id} got ${current}`);
    }
    writeFileSync(target, patched);
    applied.push({ id: file.id, status: "applied" });
  }
  return { dsh: manifest.dsh, applied };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: apply-overlay <dsh-root>");
    process.exit(1);
  }
  console.log(JSON.stringify(applyOverlayToRoot(root)));
}
