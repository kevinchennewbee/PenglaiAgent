/**
 * Background services completion tests (N).
 *
 * Validates the Scheduler persistence (load/save/updateTask) + firing, the
 * AutonomousService synchronous idle check + SOP reading, and the new
 * CompanionService (opt-in, enable/disable, trigger firing).
 *
 * Isolation: the Penglai home dir is overridden to a temp dir per test, so
 * persisted tasks/logs land in a throwaway location. Fake timers are used only
 * in the describes that exercise tickers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  SchedulerService,
  AutonomousService,
  CompanionService,
  type ScheduledTask,
  type CompanionSource,
} from "../src/services.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-svc-"));
  _setPenglaiHomeForTest(tmp);
});

afterEach(() => {
  _setPenglaiHomeForTest(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function taskInput(cron = "60") {
  return { cron, prompt: "run the nightly check", workspacePath: "/tmp/proj", enabled: true };
}

function expectPrivateMode(target: string, expected: number): void {
  if (process.platform === "win32") return;
  expect(fs.statSync(target).mode & 0o777).toBe(expected);
}

// ── scheduler: persistence ─────────────────────────────────────

describe("scheduler: persistence (save -> reload -> same tasks)", () => {
  it("tasks added to one instance are visible to a fresh instance (restart)", () => {
    const s1 = new SchedulerService({ persist: true });
    const id = s1.addTask(taskInput("120"));

    // New instance simulates a restart: it loads tasks.json on construction.
    const s2 = new SchedulerService({ persist: true });
    const list = s2.listTasks();
    expect(list.map((t) => t.id)).toContain(id);

    const reloaded = list.find((t) => t.id === id)!;
    expect(reloaded.cron).toBe("120");
    expect(reloaded.prompt).toBe("run the nightly check");
    expect(reloaded.workspacePath).toBe("/tmp/proj");
    expect(reloaded.enabled).toBe(true);
    expect(reloaded.lastRun).toBeNull();
    expectPrivateMode(path.join(tmp, "scheduler"), 0o700);
    expectPrivateMode(path.join(tmp, "scheduler", "tasks.json"), 0o600);
  });

  it("updateTask mutates and persists fields (id is immutable)", () => {
    const s = new SchedulerService({ persist: true });
    const id = s.addTask(taskInput("60"));
    const updated = s.updateTask(id, { cron: "300", enabled: false })!;
    expect(updated.cron).toBe("300");
    expect(updated.enabled).toBe(false);
    expect(updated.id).toBe(id);

    const s2 = new SchedulerService({ persist: true });
    const reloaded = s2.listTasks().find((t) => t.id === id)!;
    expect(reloaded.cron).toBe("300");
    expect(reloaded.enabled).toBe(false);
  });

  it("updateTask returns null for an unknown id", () => {
    const s = new SchedulerService({ persist: true });
    expect(s.updateTask("task_missing", { cron: "10" })).toBeNull();
  });
});

// ── scheduler: remove ──────────────────────────────────────────

describe("scheduler: remove task -> not in list", () => {
  it("removeTask drops a task in-memory and on disk", () => {
    const s = new SchedulerService({ persist: true });
    const id = s.addTask(taskInput());
    expect(s.removeTask(id)).toBe(true);
    expect(s.listTasks().find((t) => t.id === id)).toBeUndefined();

    // A fresh instance must not see the removed task either.
    const s2 = new SchedulerService({ persist: true });
    expect(s2.listTasks().find((t) => t.id === id)).toBeUndefined();
  });

  it("removeTask returns false for an unknown id", () => {
    const s = new SchedulerService({ persist: true });
    expect(s.removeTask("task_missing")).toBe(false);
  });
});

// ── scheduler: firing (fake timers) ────────────────────────────

describe("scheduler: add task -> fire -> callback called", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires checkFn when a task becomes due", () => {
    const s = new SchedulerService({ persist: true, tickMs: 1000 });
    const id = s.addTask(taskInput("1")); // every 1s
    const fired: ScheduledTask[] = [];
    s.start((t) => fired.push(t));

    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe(id);
    s.stop();
  });

  it("does not fire a disabled task", () => {
    const s = new SchedulerService({ persist: true, tickMs: 1000 });
    s.addTask({ ...taskInput("1"), enabled: false });
    const fired: ScheduledTask[] = [];
    s.start((t) => fired.push(t));
    vi.advanceTimersByTime(3000);
    expect(fired).toHaveLength(0);
    s.stop();
  });
});

// ── autonomous: idle check (fake timers) ───────────────────────

describe("autonomous: idle check", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("touch activity -> idle check returns false", () => {
    const a = new AutonomousService();
    a.touchActivity();
    expect(a.isIdle(1000)).toBe(false);
  });

  it("do not touch -> idle check returns true after the threshold", () => {
    const a = new AutonomousService(); // lastActivity = now (fake epoch 0)
    vi.advanceTimersByTime(2000); // 2s elapsed, threshold 1s
    expect(a.isIdle(1000)).toBe(true);
  });

  it("touchActivity resets the idle window", () => {
    const a = new AutonomousService();
    vi.advanceTimersByTime(800); // not yet idle (threshold 1000)
    a.touchActivity();
    vi.advanceTimersByTime(800); // only 0.8s since touch
    expect(a.isIdle(1000)).toBe(false);
    vi.advanceTimersByTime(300); // 1.1s since touch -> idle
    expect(a.isIdle(1000)).toBe(true);
  });

  it("isIdle returns false before start() configures a threshold", () => {
    const a = new AutonomousService();
    vi.advanceTimersByTime(10_000);
    // No threshold passed and start() never called -> never idle.
    expect(a.isIdle()).toBe(false);
  });

  it("readSop returns null when no sopPath is configured", () => {
    const a = new AutonomousService();
    expect(a.readSop()).toBeNull();
  });

  it("readSop returns file contents when sopPath is set", () => {
    const sopFile = path.join(tmp, "sop.md");
    fs.writeFileSync(sopFile, "# SOP\nrun the autonomous task\n");
    const a = new AutonomousService({ sopPath: sopFile });
    expect(a.readSop()).toBe("# SOP\nrun the autonomous task\n");
  });
});

// ── companion ──────────────────────────────────────────────────

describe("companion: default state + enable/disable", () => {
  it("is disabled by default", () => {
    expect(new CompanionService().isEnabled()).toBe(false);
  });

  it("enable -> status is enabled", () => {
    const c = new CompanionService();
    c.enable();
    expect(c.isEnabled()).toBe(true);
  });

  it("disable -> status is disabled", () => {
    const c = new CompanionService();
    c.enable();
    expect(c.isEnabled()).toBe(true);
    c.disable();
    expect(c.isEnabled()).toBe(false);
  });
});

describe("companion: trigger firing (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T04:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("does not fire while disabled", () => {
    const c = new CompanionService({ intervalMs: 1000, tickMs: 1000, persist: false });
    const fired: CompanionSource[] = [];
    c.start((s) => fired.push(s));
    vi.advanceTimersByTime(3000);
    expect(fired).toHaveLength(0);
    c.stop();
  });

  it("trigger fires -> callback called when enabled and interval elapses", () => {
    const c = new CompanionService({
      intervalMs: 1000,
      tickMs: 1000,
      persist: false,
      clock: () => new Date(2026, 7, 8, 12),
    });
    c.enable();
    const fired: CompanionSource[] = [];
    c.start((s) => fired.push(s));

    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
    expect(typeof fired[0]).toBe("string");
    // Subsequent interval fires again.
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(2);
    c.stop();
  });

  it("automatic heartbeat observes 22:00-08:00 quiet hours", async () => {
    const c = new CompanionService({
      intervalMs: 1000,
      tickMs: 1000,
      persist: false,
      clock: () => new Date(2026, 7, 8, 23),
    });
    c.enable({ mode: "active" });
    const fired: CompanionSource[] = [];
    c.start((s) => fired.push(s));
    vi.advanceTimersByTime(3000);
    expect(fired).toHaveLength(0);

    // A deliberate user/emotion opportunity remains available during DND.
    expect(await c.trigger("emotion")).toBe(true);
    expect(fired).toEqual(["emotion"]);
    c.stop();
  });

  it("persists enable/disable + triggers to companion.jsonl when persist is on", () => {
    const c = new CompanionService({
      intervalMs: 1000,
      tickMs: 1000,
      persist: true,
      clock: () => new Date(2026, 7, 8, 12),
    });
    c.enable();
    const fired: CompanionSource[] = [];
    c.start((s) => fired.push(s));
    vi.advanceTimersByTime(1000);
    c.stop();

    const logFile = path.join(tmp, "logs", "companion.jsonl");
    expect(fs.existsSync(logFile)).toBe(true);
    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    const actions = lines.map((l) => JSON.parse(l).action);
    expect(actions).toContain("enable");
    expect(actions).toContain("trigger");
    expectPrivateMode(path.join(tmp, "companion.json"), 0o600);
    expectPrivateMode(path.join(tmp, "logs"), 0o700);
    expectPrivateMode(logFile, 0o600);
  });

  it("redacts credentials from failed companion callbacks", async () => {
    const c = new CompanionService({ persist: true });
    c.enable();
    c.start(() => {
      throw new Error("Bearer very-secret-token");
    });

    expect(await c.trigger("emotion")).toBe(false);
    c.stop();

    const log = fs.readFileSync(path.join(tmp, "logs", "companion.jsonl"), "utf-8");
    expect(log).toContain("[REDACTED]");
    expect(log).not.toContain("very-secret-token");
  });
});
