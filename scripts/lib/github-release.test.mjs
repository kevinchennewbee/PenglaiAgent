import assert from "node:assert/strict";
import test from "node:test";
import { githubReleaseEndpoint } from "./github-release.mjs";

test("draft lookup uses a numeric ID even before its tag exists", () => {
  const calls = [];
  const endpoint = githubReleaseEndpoint("owner/repo", { draft: true, tag: "v1.2.3" }, (...args) => {
    calls.push(args);
    return "12345\n";
  });
  assert.equal(endpoint, "repos/owner/repo/releases/12345");
  assert.deepEqual(calls[0][1], ["release", "view", "v1.2.3", "--repo", "owner/repo", "--json", "databaseId", "--jq", ".databaseId"]);
});

test("CI can read an exact draft ID without tag discovery", () => {
  assert.equal(githubReleaseEndpoint("owner/repo", { draft: true, tag: "v1.2.3", releaseId: "12345" }, () => { throw new Error("unexpected discovery"); }), "repos/owner/repo/releases/12345");
  for (const releaseId of ["", "0", "../latest", "1/2", "9007199254740992"]) {
    assert.throws(() => githubReleaseEndpoint("owner/repo", { draft: true, tag: "v1.2.3", releaseId }));
  }
});

test("public readback retains the published tag endpoint", () => {
  assert.equal(githubReleaseEndpoint("owner/repo", { draft: false, tag: "v1.2.3" }, () => { throw new Error("unexpected discovery"); }), "repos/owner/repo/releases/tags/v1.2.3");
});
