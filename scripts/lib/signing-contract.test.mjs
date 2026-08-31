import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWindowsAuthenticode,
  WINDOWS_AUTHENTICODE_COMMAND,
} from "./signing-contract.mjs";

test("Windows Authenticode probe uses the native command without re-importing core type data", () => {
  assert.match(WINDOWS_AUTHENTICODE_COMMAND, /Get-AuthenticodeSignature/);
  assert.match(WINDOWS_AUTHENTICODE_COMMAND, /-ErrorAction Stop/);
  assert.doesNotMatch(WINDOWS_AUTHENTICODE_COMMAND, /Import-Module/);
});

test("Windows community signing contract accepts exact unsigned app and installer", () => {
  assert.deepEqual(
    evaluateWindowsAuthenticode([
      { path: "Penglai.exe", status: "NotSigned" },
      { path: "Penglai setup.exe", status: "NotSigned" },
    ]),
    { verdict: "PASS" },
  );
});

test("Windows community signing contract rejects signed or invalid signatures", () => {
  assert.deepEqual(
    evaluateWindowsAuthenticode([
      { path: "Penglai.exe", status: "Valid" },
      { path: "Penglai setup.exe", status: "NotSigned" },
    ]),
    {
      verdict: "FAIL",
      reason: "unexpected Authenticode status Valid for Penglai.exe",
    },
  );
  assert.equal(
    evaluateWindowsAuthenticode([
      { path: "Penglai.exe", status: "HashMismatch" },
    ]).verdict,
    "FAIL",
  );
});

test("Windows community signing contract fails closed on absent or malformed evidence", () => {
  assert.equal(evaluateWindowsAuthenticode([]).verdict, "FAIL");
  assert.equal(
    evaluateWindowsAuthenticode([{ path: "Penglai.exe" }]).verdict,
    "FAIL",
  );
});
