import assert from "node:assert/strict";
import test from "node:test";
import { WeixinTypingSession } from "./typing.js";

test("Weixin typing starts with a ticket and cancel never throws", async () => {
  const calls: Array<{ status: 1 | 2; ticket: string }> = [];
  const session = new WeixinTypingSession(
    {
      async getTypingTicket() {
        return "ticket-1";
      },
      async sendTyping(_token, _to, ticket, status) {
        calls.push({ status, ticket });
        return true;
      },
    },
    "token",
    "user-1",
  );
  await session.start();
  await session.stop();
  assert.equal(calls[0]?.status, 1);
  assert.equal(calls.at(-1)?.status, 2);
  assert.equal(calls.every((row) => row.ticket === "ticket-1"), true);
});

test("Weixin typing failure is swallowed", async () => {
  const session = new WeixinTypingSession(
    {
      async getTypingTicket() {
        throw new Error("no-config");
      },
      async sendTyping() {
        throw new Error("rejected");
      },
    },
    "token",
    "user-1",
  );
  await session.start();
  await session.stop();
});
