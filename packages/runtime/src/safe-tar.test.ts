import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTarGz, inspectTarGz } from "./safe-tar.js";

function putOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function tarEntry(path: string, type: "0" | "2", data = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  putOctal(header, 100, 8, type === "0" ? 0o644 : 0o777);
  putOctal(header, 108, 8, 0);
  putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, data.length);
  putOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function archive(...entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

test("safe tar extracts a bounded regular file", () => {
  const bytes = archive(tarEntry("./dist/index.js", "0", Buffer.from("export {};\n")));
  const destination = mkdtempSync(join(tmpdir(), "penglai-safe-tar-"));
  const entries = extractTarGz(bytes, destination);
  assert.deepEqual(entries.map((entry) => entry.path), ["dist/index.js"]);
  assert.equal(readFileSync(join(destination, "dist", "index.js"), "utf8"), "export {};\n");
});

test("safe tar rejects traversal, links, and duplicate paths before extraction", () => {
  assert.throws(
    () => inspectTarGz(archive(tarEntry("../../escaped", "0", Buffer.from("x")))),
    /escaped|unsafe archive path/,
  );
  assert.throws(
    () => inspectTarGz(archive(tarEntry("linked", "2"))),
    /entry type/,
  );
  assert.throws(
    () =>
      inspectTarGz(
        archive(
          tarEntry("same", "0", Buffer.from("a")),
          tarEntry("same", "0", Buffer.from("b")),
        ),
      ),
    /duplicate archive path/,
  );
});
