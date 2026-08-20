import { createRequire } from "node:module";
import { PINNED_DSH, assertDshVersion, claimedFromOfficial, extractPenglaiSource, probePinnedPackages } from "./index.js";

assertDshVersion(PINNED_DSH);
const pinned = probePinnedPackages();
const report = {
  pin: PINNED_DSH,
  probe: "ok",
  pinned,
  claimed: claimedFromOfficial({
    message: {
      id: "mid",
      source: { kind: "penglai-im", schema: 1, routeId: "r", inboundId: "i", adapter: "mock" },
    },
    turn: 3,
    sessionId: "s",
  }),
  extracted: extractPenglaiSource({ kind: "penglai-im", schema: 1, routeId: "r", inboundId: "i", adapter: "mock" }),
};
void createRequire;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
