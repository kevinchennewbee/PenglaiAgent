import { ROOT } from "./lib/repo.mjs";
import { formatSecretHits, scanRepository } from "./lib/secret-scan.mjs";

const hits = scanRepository(ROOT);
if (hits.length) {
  console.error(formatSecretHits(hits));
  process.exit(1);
}
console.log("audit:secrets ok");
