import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

function putOctal(header, offset, length, value) {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function tarEntry(path, data, mode) {
  const pathBytes = Buffer.byteLength(path, "utf8");
  if (pathBytes === 0 || pathBytes > 100) {
    throw new Error(`test tar path must fit the ustar name field: ${path}`);
  }
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  putOctal(header, 100, 8, mode & 0o777);
  putOctal(header, 108, 8, 0);
  putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, data.length);
  putOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function regularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      const stat = lstatSync(absolute);
      if (!stat.isFile()) {
        throw new Error(`test tar fixtures only admit regular files: ${absolute}`);
      }
      const archivePath = relative(root, absolute).split(sep).join("/");
      files.push({ absolute, archivePath, mode: stat.mode });
    }
  };
  visit(root);
  return files.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

export function writeTestTarGz(sourceRoot, destination) {
  const root = resolve(sourceRoot);
  const entries = regularFiles(root).map(({ absolute, archivePath, mode }) =>
    tarEntry(archivePath, readFileSync(absolute), mode),
  );
  writeFileSync(destination, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
}
