import { assertVerifiedDraft } from "./lib/publication-seal.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { RELEASE_ID, SOURCE_SHA, VERIFIED_ASSET_SET, GITHUB_SHA } = process.env;
if (!/^[1-9][0-9]*$/.test(RELEASE_ID ?? "") || !/^[a-f0-9]{40}$/.test(SOURCE_SHA ?? "") || SOURCE_SHA !== GITHUB_SHA || !/^[a-f0-9]{64}$/.test(VERIFIED_ASSET_SET ?? "")) {
  throw new Error("verified publication identity is missing");
}
const contract = JSON.parse(readFileSync("release-contract.json", "utf8"));
const repository = contract.publication.repo;
function api(path) {
  return JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${path}`], { encoding: "utf8" }));
}
if (api("git/ref/heads/main").object.sha !== SOURCE_SHA) throw new Error("main moved after draft verification");
const release = api(`releases/${RELEASE_ID}`);
assertVerifiedDraft(release, contract, SOURCE_SHA, VERIFIED_ASSET_SET);
execFileSync("gh", ["api", "--method", "PATCH", `repos/${repository}/releases/${RELEASE_ID}`, "-F", "draft=false", "-f", "make_latest=true", "--silent"], { stdio: "inherit" });
console.log(`Published ${contract.publication.tag} from verified source ${SOURCE_SHA}`);
