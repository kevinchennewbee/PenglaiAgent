import assert from "node:assert/strict";
import test from "node:test";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { snapshotOfficialSession } from "@penglai/contracts";

test("rc.1 replay reads the official immutable snapshot and sees later appends", () => {
  const session = Session.create(SessionId("penglai-replay-contract"));
  const before = snapshotOfficialSession(session);
  session.append("turn/start", { turn: 1 });
  session.append("turn/end", { turn: 1, reason: "completed" });
  const after = snapshotOfficialSession(session);
  assert.equal("events" in session, false);
  assert.equal(after.length, before.length + 2);
  assert.equal(Object.isFrozen(before), true);
  assert.equal(Object.isFrozen(after), true);
  assert.deepEqual(after.slice(-2).map((event) => event.type), ["turn/start", "turn/end"]);
  assert.notEqual(before, after);
});

test("replay rejects missing or invalid snapshot capability instead of empty history", () => {
  assert.throws(() => snapshotOfficialSession(undefined), /snapshotEvents is unavailable/);
  assert.throws(() => snapshotOfficialSession({}), /snapshotEvents is unavailable/);
  assert.throws(
    () => snapshotOfficialSession({ snapshotEvents: () => null as never }),
    /invalid log/,
  );
});
