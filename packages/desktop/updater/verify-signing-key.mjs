#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { readUpdaterPublicKey, verifyUpdaterSignature } from "./release-contract.mjs";

function parseArgs() {
  const args = { file: null };
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === "--file") args.file = path.resolve(process.argv[++index]);
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.file) throw new Error("--file is required");
  return args;
}

const { file } = parseArgs();
const signatureFile = `${file}.sig`;
for (const candidate of [file, signatureFile]) {
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
    throw new Error(`signing preflight input must be a non-empty regular file: ${candidate}`);
  }
}

const publicKey = readUpdaterPublicKey();
verifyUpdaterSignature(
  fs.readFileSync(file),
  fs.readFileSync(signatureFile, "utf8").trim(),
  publicKey,
);

const publicText = Buffer.from(publicKey, "base64").toString("utf8");
const keyId = publicText.match(/minisign public key: ([0-9A-F]{16})/)?.[1];
if (!keyId) throw new Error("embedded updater public key id is missing");
console.log(`updater signing key preflight passed (${keyId})`);
