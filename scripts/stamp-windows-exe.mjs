#!/usr/bin/env node
// Apply Penglai icon and version resources to the unsigned Windows executable.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as ResEdit from "resedit";

const exePath = resolve(process.argv[2] ?? "");
const pngPath = resolve(process.argv[3] ?? "");
const icoPath = process.argv[4] ? resolve(process.argv[4]) : null;
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("usage: stamp-windows-exe <exe> <256x256 png> [output ico]");
}

function pngIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6); // 0 means 256 pixels.
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const png = readFileSync(pngPath);
if (
  png.length < 24 ||
  !png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
  png.readUInt32BE(16) !== 256 ||
  png.readUInt32BE(20) !== 256
) {
  throw new Error("Penglai Windows icon source must be a valid 256x256 PNG");
}
const ico = pngIco(png);
if (icoPath) {
  mkdirSync(dirname(icoPath), { recursive: true });
  writeFileSync(icoPath, ico);
}

const source = readFileSync(exePath);
const executable = ResEdit.NtExecutable.from(source);
const resources = ResEdit.NtExecutableResource.from(executable);
const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
const iconFile = ResEdit.Data.IconFile.from(ico);
const iconId = iconGroups[0]?.id ?? 1;
const iconLang = iconGroups[0]?.lang ?? 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries,
  iconId,
  iconLang,
  iconFile.icons.map((item) => item.data),
);

const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
if (!versions.length) throw new Error("Electron executable has no version resource");
for (const version of versions) {
  const languages = version.getAllLanguagesForStringValues();
  const targets = languages.length ? languages : [{ lang: 1033, codepage: 1200 }];
  version.setFileVersion(0, 5, 1, 0, 1033);
  version.setProductVersion(0, 5, 1, 0, 1033);
  for (const language of targets) {
    version.setStringValues(language, {
      CompanyName: "Penglai",
      FileDescription: "Penglai",
      FileVersion: "0.5.9.0",
      InternalName: "Penglai",
      LegalCopyright: "Penglai contributors",
      OriginalFilename: "Penglai.exe",
      ProductName: "Penglai",
      ProductVersion: "0.5.9.0",
    });
  }
  version.outputToResourceEntries(resources.entries);
}

resources.outputResource(executable);
const temp = join(dirname(exePath), `.Penglai.exe.${process.pid}.tmp`);
rmSync(temp, { force: true });
writeFileSync(temp, Buffer.from(executable.generate()), { mode: 0o700 });
renameSync(temp, exePath);
console.log(JSON.stringify({ verdict: "PASS", command: "stamp-windows-exe", exe: exePath, ico: icoPath }));
