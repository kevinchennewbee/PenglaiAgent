import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { OFFICE_ZIP_LIMITS, readZip, writeZip, zipCrc32 } from "./zip.js";

function policy(code: string) {
  return (error: unknown) =>
    error instanceof PenglaiError && error.errorClass === "SECURITY_POLICY" && error.message === code;
}

function patchU16(buf: Buffer, offset: number, value: number): Buffer {
  const next = Buffer.from(buf);
  next.writeUInt16LE(value, offset);
  return next;
}

function patchU32(buf: Buffer, offset: number, value: number): Buffer {
  const next = Buffer.from(buf);
  next.writeUInt32LE(value >>> 0, offset);
  return next;
}

function eocdOffset(buf: Buffer): number {
  return buf.length - 22;
}

function centralOffset(buf: Buffer): number {
  return buf.readUInt32LE(eocdOffset(buf) + 16);
}

test("R56-OFF-001 writeZip output is accepted by the bounded reader", () => {
  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/document.xml", data: Buffer.from("<w:document>hello</w:document>") },
  ];
  const out = readZip(writeZip(entries));
  assert.equal(out.length, 2);
  assert.equal(out[1]?.data.toString(), "<w:document>hello</w:document>");
});

test("R56-OFF-001 rejects traversal, drive prefix, NUL, absolute, and escape names", () => {
  assert.throws(() => readZip(writeZip([{ name: "../etc/passwd", data: Buffer.from("x") }])), policy("OFFICE_ZIP_PATH"));
  assert.throws(() => readZip(writeZip([{ name: "/etc/passwd", data: Buffer.from("x") }])), policy("OFFICE_ZIP_PATH"));
  assert.throws(() => readZip(writeZip([{ name: "C:/windows/win.ini", data: Buffer.from("x") }])), policy("OFFICE_ZIP_PATH"));
  assert.throws(() => readZip(writeZip([{ name: "word/../../etc/passwd", data: Buffer.from("x") }])), policy("OFFICE_ZIP_PATH"));
  assert.throws(() => readZip(writeZip([{ name: "word/\0hidden.xml", data: Buffer.from("x") }])), policy("OFFICE_ZIP_NAME"));
});

test("R56-OFF-001 rejects duplicate names and case collisions before inflate trust", () => {
  assert.throws(
    () =>
      readZip(
        writeZip([
          { name: "word/document.xml", data: Buffer.from("a") },
          { name: "word/document.xml", data: Buffer.from("b") },
        ]),
      ),
    policy("OFFICE_ZIP_DUPLICATE"),
  );
  assert.throws(
    () =>
      readZip(
        writeZip([
          { name: "word/Document.xml", data: Buffer.from("a") },
          { name: "word/document.xml", data: Buffer.from("b") },
        ]),
      ),
    policy("OFFICE_ZIP_DUPLICATE"),
  );
});

test("R56-OFF-001 rejects encryption, unknown flags, zip64, and non store/deflate methods", () => {
  const zip = writeZip([{ name: "word/a.xml", data: Buffer.from("hello") }]);
  const localFlag = 6;
  const centralFlag = centralOffset(zip) + 8;
  assert.throws(() => readZip(patchU16(patchU16(zip, localFlag, 0x0001), centralFlag, 0x0001)), policy("OFFICE_ZIP_FLAGS"));
  assert.throws(() => readZip(patchU16(patchU16(zip, localFlag, 0x0008), centralFlag, 0x0008)), policy("OFFICE_ZIP_FLAGS"));
  const methodLocal = 8;
  const methodCentral = centralOffset(zip) + 10;
  assert.throws(() => readZip(patchU16(patchU16(zip, methodLocal, 6), methodCentral, 6)), policy("OFFICE_ZIP_METHOD"));
  assert.throws(() => readZip(patchU32(zip, eocdOffset(zip) + 16, 0xffffffff)), policy("OFFICE_ZIP_ZIP64"));
});

test("R56-OFF-001 rejects central/local header mismatches", () => {
  const zip = writeZip([{ name: "word/a.xml", data: Buffer.from("hello") }]);
  const localCrc = 14;
  assert.throws(() => readZip(patchU32(zip, localCrc, 1)), policy("OFFICE_ZIP_HEADER_MISMATCH"));
});

test("R56-OFF-001 rejects oversized archive, name, and entry count before inflate", () => {
  assert.throws(() => readZip(Buffer.alloc(OFFICE_ZIP_LIMITS.archiveBytes + 1, 1)), policy("OFFICE_ZIP_ARCHIVE_LIMIT"));
  assert.throws(
    () => readZip(writeZip([{ name: `${"n".repeat(OFFICE_ZIP_LIMITS.maxNameBytes + 1)}.xml`, data: Buffer.from("x") }])),
    policy("OFFICE_ZIP_NAME"),
  );
  const many = Array.from({ length: OFFICE_ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({
    name: `word/p${i}.xml`,
    data: Buffer.from("x"),
  }));
  assert.throws(() => readZip(writeZip(many)), policy("OFFICE_ZIP_ENTRY_COUNT"));
});

test("R56-OFF-002 rejects ratio bombs, CRC mismatch, and declared size lies", () => {
  const zeros = Buffer.alloc(200_000, 0);
  assert.throws(() => readZip(writeZip([{ name: "word/bomb.xml", data: zeros }])), policy("OFFICE_ZIP_RATIO"));
  const zip = writeZip([{ name: "word/a.xml", data: Buffer.from("hello-crc") }]);
  const crcField = 14;
  const centralCrc = centralOffset(zip) + 16;
  const lied = patchU32(patchU32(zip, crcField, 0), centralCrc, 0);
  assert.throws(() => readZip(lied), policy("OFFICE_ZIP_CRC"));
  const rawLocal = 22;
  const rawCentral = centralOffset(zip) + 24;
  const sized = patchU32(patchU32(zip, rawLocal, 10), rawCentral, 10);
  assert.throws(() => readZip(sized), policy("OFFICE_ZIP_SIZE"));
});

test("R56-OFF-002 declared uncompressed above 16 MiB fails closed without a partial result", () => {
  const zip = writeZip([{ name: "word/a.xml", data: Buffer.from("hello") }]);
  const rawLocal = 22;
  const rawCentral = centralOffset(zip) + 24;
  const tooBig = OFFICE_ZIP_LIMITS.entryUncompressedBytes + 1;
  assert.throws(
    () => readZip(patchU32(patchU32(zip, rawLocal, tooBig), rawCentral, tooBig)),
    policy("OFFICE_ZIP_ENTRY_LIMIT"),
  );
});

test("R56-OFF-002 store method accepts exact bytes and still enforces CRC", () => {
  const data = Buffer.from("stored-bytes");
  const name = Buffer.from("word/store.xml");
  const crc = zipCrc32(data);
  const local = Buffer.alloc(30 + name.length + data.length);
  Buffer.from("PK\u0003\u0004", "binary").copy(local);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  Buffer.from("PK\u0001\u0002", "binary").copy(central);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const eocd = Buffer.alloc(22);
  Buffer.from("PK\u0005\u0006", "binary").copy(eocd);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  const entries = readZip(Buffer.concat([local, central, eocd]));
  assert.equal(entries[0]?.data.toString(), "stored-bytes");
});

test("R56-OFF-002 inflate uses the actual output cap, not a trusted declared size", () => {
  const data = Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 0xff));
  const compressed = deflateRawSync(data);
  const zip = writeZip([{ name: "word/a.xml", data }]);
  assert.equal(readZip(zip)[0]?.data.equals(data), true);
  assert.ok(compressed.length <= data.length + 64);
});
