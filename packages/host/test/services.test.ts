/**
 * Background services tests (M4).
 *
 * Validates the SchedulerService (add/remove/list/start/stop, due-task firing,
 * disabled-task skipping, idempotent start) and the AutonomousService idle
 * detection, using fake timers for deterministic timing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SchedulerService,
  AutonomousService,
  type ScheduledTask,
} from "../src/services.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A minimal due-task input (cron = interval in seconds). */
function taskInput(cron = "1"): Omit<ScheduledTask, "id" | "lastRun"> {
  return {
    cron,
    prompt: "run the nightly check",
    workspacePath: "/tmp/proj",
    enabled: true,
  };
}

describe("scheduler: add / remove / list", () => {
  it("addTask returns a task id and the task appears in listTasks", () => {
    const s = new SchedulerService();
    const id = s.addTask(taskInput("120"));
    expect(id).toMatch(/^task_/);
    const list = s.listTasks();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].cron).toBe("120");
    expect(list[0].lastRun).toBeNull();
    expect(list[0].enabled).toBe(true);
  });

  it("removeTask returns true for an existing id and false otherwise", () => {
    const s = new SchedulerService();
    const id = s.addTask(taskInput());
    expect(s.removeTask(id)).toBe(true);
    expect(s.listTasks()).toHaveLength(0);
    expect(s.removeTask("task_does_not_exist")).toBe(false);
  });

  it("listTasks returns a fresh array; mutating it does not affect the service", () => {
    const s = new SchedulerService();
    s.addTask(taskInput());
    const list = s.listTasks();
    list.pop();
    list.push({ ...taskInput(), id: "task_injected", lastRun: null });
    expect(s.listTasks()).toHaveLength(1);
    expect(s.listTasks()[0].id).not.toBe("task_injected");
  });

  it("setEnabled toggles a task without removing it", () => {
    const s = new SchedulerService();
    const id = s.addTask(taskInput());
    expect(s.setEnabled(id, false)).toBe(true);
    expect(s.listTasks()[0].enabled).toBe(false);
    expect(s.setEnabled("task_missing", true)).toBe(false);
  });
});

describe("scheduler: start / stop (due-task firing)", () => {
  it("fires checkFn when a task becomes due, and stamps lastRun", () => {
    const s = new SchedulerService(); // tickMs 1000
    const id = s.addTask(taskInput("1")); // every 1s
    const fired: ScheduledTask[] = [];
    s.start((t) => fired.push(t));

    // At t=1000ms the first tick runs; lastRun was null -> fires once.
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe(id);
    // lastRun is now stamped, so the next tick at t=2000 fires again.
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(2);
  });

  it("does not fire a disabled task", () => {
    const s = new SchedulerService();
    s.addTask({ ...taskInput("1"), enabled: false });
    const fired: ScheduledTask[] = [];
    s.start((t) => fired.push(t));
    vi.advanceTimersByTime(3000);
    expect(fired).toHaveLength(0);
  });

  it("respects the interval: a 5s task does not fire at 1-4s", () => {
    const s = new SchedulerService();
    s.addTask(taskInput("5"));
    const fired: ScheduledTask[] = [];
    s.start((t) => fired.push(t));
    vi.advanceTimersByTime(4000);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(1000); // total 5000ms
    expect(fired).toHaveLength(1);
  });

  it("start is idempotent: calling twice does not double the ticker", () => {
    const s = new SchedulerService();
    s.addTask(taskInput("1"));
    const fired: ScheduledTask[] = [];
    const fn = (t: ScheduledTask): void => {
      fired.push(t);
    };
    s.start(fn);
    s.start(fn); // no-op
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
  });

  it("stop prevents further firings", () => {
    const s = new SchedulerService();
    s.addTask(taskInput("1"));
    const fired: ScheduledTask[] = [];
    s.start((t) => fired.push(t));
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveLength(1);
    s.stop();
    vi.advanceTimersByTime(5000);
    expect(fired).toHaveLength(1);
  });

  it("a thrown checkFn does not stop the scheduler", () => {
    const s = new SchedulerService();
    s.addTask(taskInput("1"));
    let good = 0;
    let first = true;
    s.start(() => {
      if (first) {
        first = false;
        throw new Error("boom");
      }
      good += 1;
    });
    // First tick throws; the scheduler must survive and fire again next tick.
    vi.advanceTimersByTime(1000);
    expect(good).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(good).toBe(1);
    s.stop();
  });
});

describe("autonomous: idle detection", () => {
  it("fires onIdle only after the idle threshold elapses", () => {
    const a = new AutonomousService(); // tick 1000
    let calls = 0;
    a.start(2000, () => (calls += 1));
    vi.advanceTimersByTime(1000); // 1s elapsed, threshold 2s -> no fire
    expect(calls).toBe(0);
    vi.advanceTimersByTime(1000); // 2s elapsed -> fire
    expect(calls).toBe(1);
  });

  it("touchActivity resets the idle clock", () => {
    const a = new AutonomousService();
    let calls = 0;
    a.start(2000, () => (calls += 1));
    vi.advanceTimersByTime(1500); // 1.5s, not yet idle
    a.touchActivity(); // reset
    vi.advanceTimersByTime(1500); // only 1.5s since touch -> still not idle
    expect(calls).toBe(0);
    vi.advanceTimersByTime(1000); // 2.5s since touch -> fire
    expect(calls).toBe(1);
  });

  it("stop prevents further onIdle calls", () => {
    const a = new AutonomousService();
    let calls = 0;
    a.start(1000, () => (calls += 1));
    vi.advanceTimersByTime(1000);
    expect(calls).toBe(1);
    a.stop();
    vi.advanceTimersByTime(5000);
    expect(calls).toBe(1);
  });
});
