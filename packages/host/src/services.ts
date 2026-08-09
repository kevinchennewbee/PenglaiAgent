/**
 * Background Services (M4 + N: completion)
 *
 * Upgrades the 0.3 `reflect` subsystem (scheduler / autonomous / companion)
 * into Host-internal TS services. See docs/0.4/13-BACKGROUND-SERVICES.md.
 *
 * Key principle (constitution §3 Single Loop Axiom, §2.1 no second loop):
 *   Background services do NOT call the model, run tools, or mutate files.
 *   They only EMIT task suggestions / events and hand them to the same Core
 *   via the Host API (conversation.prompt). The caller wires `checkFn` / `onIdle`
 *   / `onTrigger` to submit an InboundEvent; the Core decides whether to
 *   advance a turn.
 *
 * N scope additions over M4:
 *   - SchedulerService: persists tasks to ~/.penglai/scheduler/tasks.json
 *     (load on construction, save on change) so tasks survive a restart; adds
 *     updateTask(id, updates). When a task fires it calls the Host API
 *     (conversation.prompt) via the checkFn the server wires.
 *   - AutonomousService: idle detection with a synchronous isIdle() check;
 *     on idle, reads memory/autonomous_operation_sop.md and submits it as a
 *     prompt; logs actions to ~/.penglai/logs/autonomous.jsonl.
 *   - CompanionService (NEW): opt-in (disabled by default), 600s heartbeat;
 *     simplified trigger sources weather/morning/evening/emotion/free; logs
 *     to ~/.penglai/logs/companion.jsonl; enable/disable via API.
 *
 * Persistence is opt-in per instance (`persist: true`). When off (the default,
 * used by the unit tests in services.test.ts) the services are pure in-memory
 * and touch no disk, preserving the original M4 behavior.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { penglaiHome } from "./conversation-store.js";
import {
  appendPrivateLine,
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  hardenPrivateFile,
} from "./security/private-file.js";
import { redactSensitiveText } from "./security/redaction.js";

const MAX_SERVICE_STATE_BYTES = 16 * 1024 * 1024;

// ── public types ───────────────────────────────────────────────

/**
 * A cron-like scheduled task. In M4 `cron` is simplified to a plain
 * integer-of-seconds string (e.g. "120" => every 2 minutes). Real cron
 * expression parsing is deferred to 0.5+.
 */
export interface ScheduledTask {
  id: string;
  /** Interval in seconds (M4 simplification; not a cron expression). */
  cron: string;
  prompt: string;
  workspacePath: string;
  /** Epoch ms of the last firing, or null if it has never fired. */
  lastRun: number | null;
  enabled: boolean;
}

/**
 * The unified event a background service submits to the Core. Scheduler,
 * Autonomous, and Companion all produce these; the Host wiring turns them into
 * a `conversation.prompt` call (the single entry to the Agent Core).
 */
export interface InboundEvent {
  source: "scheduler" | "autonomous" | "companion";
  prompt: string;
  workspacePath?: string;
  conversationId?: string;
  createdAt: number;
}

/** Options shared by all services. */
export interface ServiceOptions {
  /** Ticker granularity in ms. Default 1000. Smaller = more responsive. */
  tickMs?: number;
  /** Opt into disk persistence (tasks.json / logs). Default false (in-memory). */
  persist?: boolean;
  /** Override the SOP path for AutonomousService.readSop. */
  sopPath?: string;
}

/** Simplified companion trigger sources (docs/0.4/13-BACKGROUND-SERVICES.md §4). */
export type CompanionSource = "weather" | "morning" | "evening" | "emotion" | "free";

/** Options for CompanionService. */
export interface CompanionOptions extends ServiceOptions {
  /** Heartbeat interval in ms. Default 600_000 (10 min). */
  intervalMs?: number;
  /** Durable config location; defaults to ~/.penglai/companion.json. */
  statePath?: string;
  /** Injectable wall clock for deterministic local-time policy tests. */
  clock?: () => Date;
}

export type CompanionMode = "quiet" | "present" | "active";

export interface CompanionStatus {
  enabled: boolean;
  mode: CompanionMode;
  conversationId: string | null;
  lastFire: number | null;
  lastSource: CompanionSource | null;
}

/** Default tick: check due tasks / idle once per second. */
const DEFAULT_TICK_MS = 1000;

/** Default companion heartbeat: 10 minutes. */
const DEFAULT_COMPANION_INTERVAL_MS = 600_000;

/** Fallback interval (seconds) when `task.cron` is not a positive integer. */
const FALLBACK_INTERVAL_SECONDS = 60;

/**
 * Parse `task.cron` as an interval in seconds (M4 simplification: the field
 * holds a plain integer-of-seconds string, e.g. "120"). Returns a positive
 * number, falling back to FALLBACK_INTERVAL_SECONDS for garbage input.
 */
function parseIntervalSeconds(cron: string): number {
  const n = Number(cron);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_INTERVAL_SECONDS;
}

/** Generate a task id matching the `task_<timestamp>_<random>` convention. */
function newTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Best-effort append of one JSON line to a log file (creates dirs as needed). */
function appendJsonl(file: string, entry: Record<string, unknown>): void {
  try {
    appendPrivateLine(file, JSON.stringify({ ts: Date.now(), ...entry }));
  } catch {
    // Logging must never break the service.
  }
}

// ── SchedulerService ───────────────────────────────────────────

/**
 * Interval-based scheduler. Add tasks with an interval (seconds); when a task
 * is due, `start(checkFn)` invokes `checkFn(task)`. The caller turns the task
 * into an InboundEvent and submits it to the Core (conversation.prompt).
 *
 * With `persist: true`, tasks are loaded from
 * `~/.penglai/scheduler/tasks.json` on construction and saved on every change,
 * so they survive a restart. State is per-instance (not a module singleton),
 * so tests are isolated.
 */
export class SchedulerService {
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly tickMs: number;
  private readonly persist: boolean;
  private interval: NodeJS.Timeout | null = null;

  constructor(options: ServiceOptions = {}) {
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.persist = options.persist ?? false;
    if (this.persist) this.loadTasks();
  }

  /** Path to the persisted task list, or null when persistence is off. */
  private tasksFile(): string | null {
    return this.persist ? path.join(penglaiHome(), "scheduler", "tasks.json") : null;
  }

  /** Load tasks from disk into the in-memory map (constructor only). */
  private loadTasks(): void {
    const file = this.tasksFile();
    if (!file || !fs.existsSync(file)) return;
    try {
      hardenPrivateFile(file, MAX_SERVICE_STATE_BYTES);
      const arr = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(arr)) {
        for (const t of arr as ScheduledTask[]) {
          if (t && typeof t.id === "string") this.tasks.set(t.id, t);
        }
      }
    } catch {
      // Corrupt tasks.json must not crash the scheduler; start empty.
    }
  }

  /** Persist the current task list to disk (no-op when persistence is off). */
  saveTasks(): void {
    const file = this.tasksFile();
    if (!file) return;
    try {
      atomicWritePrivateJson(file, Array.from(this.tasks.values()), MAX_SERVICE_STATE_BYTES);
    } catch {
      // Best-effort: in-memory state stays correct even if the write fails.
    }
  }

  /** Persist on change (internal). */
  private save(): void {
    if (this.persist) this.saveTasks();
  }

  /** Add a scheduled task. Returns the generated task id. */
  addTask(task: Omit<ScheduledTask, "id" | "lastRun">): string {
    const id = newTaskId();
    const full: ScheduledTask = { ...task, id, lastRun: null };
    this.tasks.set(id, full);
    this.save();
    return id;
  }

  /** Remove a task by id. Returns true if it existed. */
  removeTask(id: string): boolean {
    const existed = this.tasks.delete(id);
    if (existed) this.save();
    return existed;
  }

  /** Enable/disable a task in place without removing it. */
  setEnabled(id: string, enabled: boolean): boolean {
    const t = this.tasks.get(id);
    if (!t) return false;
    t.enabled = enabled;
    this.save();
    return true;
  }

  /**
   * Update a task's mutable fields (cron/prompt/workspacePath/enabled/lastRun).
   * The id is immutable. Returns the updated task, or null if the id is unknown.
   */
  updateTask(
    id: string,
    updates: Partial<Omit<ScheduledTask, "id">>,
  ): ScheduledTask | null {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (updates.cron !== undefined) t.cron = updates.cron;
    if (updates.prompt !== undefined) t.prompt = updates.prompt;
    if (updates.workspacePath !== undefined) t.workspacePath = updates.workspacePath;
    if (updates.enabled !== undefined) t.enabled = updates.enabled;
    if (updates.lastRun !== undefined) t.lastRun = updates.lastRun;
    this.save();
    return t;
  }

  /** List all tasks (a shallow copy of the array; task objects are live refs). */
  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Start the ticker. A task fires when `now - lastRun >= intervalSeconds`;
   * tasks present at start are baselined to the start time so each fires after
   * one full interval (not immediately). A task added after start is baselined
   * on its first observed tick. A task with `enabled === false` is skipped.
   *
   * Calling start() while already running is a no-op (no double ticker).
   * `checkFn` errors are swallowed so a bad handler can't kill the service.
   */
  start(checkFn: (task: ScheduledTask) => void): void {
    if (this.interval !== null) return;
    const startTime = Date.now();
    // Baseline existing tasks to the start time so each fires after one full
    // interval rather than immediately on the first tick.
    for (const t of this.tasks.values()) {
      if (t.lastRun === null) t.lastRun = startTime;
    }
    this.interval = setInterval(() => {
      const now = Date.now();
      for (const task of this.tasks.values()) {
        if (!task.enabled) continue;
        // A task added after start(): baseline it now, skip firing this tick.
        if (task.lastRun === null) {
          task.lastRun = now;
          continue;
        }
        const intervalMs = parseIntervalSeconds(task.cron) * 1000;
        if (now - task.lastRun >= intervalMs) {
          task.lastRun = now;
          this.save();
          try {
            checkFn(task);
          } catch {
            // A handler failure must not stop the scheduler.
          }
        }
      }
    }, this.tickMs);
    // unref so the timer doesn't keep a headless process alive on its own.
    this.interval.unref?.();
  }

  /** Stop the ticker. Safe to call when not running. */
  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

// ── AutonomousService ──────────────────────────────────────────

/**
 * Idle-detection service. Call `touchActivity()` whenever the user (or any
 * foreground event) is active. After `idleThresholdMs` of inactivity, the
 * service fires `onIdle(sop)` so the caller can submit an InboundEvent to the
 * Core. On idle it reads the configured SOP file (default
 * memory/autonomous_operation_sop.md) and passes its contents to onIdle.
 *
 * With `persist: true`, idle firings are logged to
 * `~/.penglai/logs/autonomous.jsonl`.
 */
export class AutonomousService {
  private readonly tickMs: number;
  private readonly persist: boolean;
  private readonly sopPath: string | undefined;
  private lastActivity: number;
  private idleThresholdMs: number | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(options: ServiceOptions = {}) {
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.persist = options.persist ?? false;
    this.sopPath = options.sopPath;
    this.lastActivity = Date.now();
  }

  /** Record that activity happened, resetting the idle clock. */
  touchActivity(): void {
    this.lastActivity = Date.now();
  }

  /** Epoch ms of the last activity (for status reporting). */
  getLastActivity(): number {
    return this.lastActivity;
  }

  /** The idle threshold configured via start(), or null if never started. */
  getIdleThresholdMs(): number | null {
    return this.idleThresholdMs;
  }

  /**
   * Synchronous idle check. True when `now - lastActivity >= threshold`. If no
   * threshold is passed and start() was never called, returns false (no
   * threshold configured => never idle).
   */
  isIdle(idleThresholdMs?: number): boolean {
    const threshold = idleThresholdMs ?? this.idleThresholdMs;
    if (threshold === null || threshold === undefined) return false;
    return Date.now() - this.lastActivity >= threshold;
  }

  /**
   * Read the configured SOP file and return its contents, or null if no SOP
   * path is configured / the file is missing / unreadable.
   */
  readSop(): string | null {
    if (!this.sopPath) return null;
    try {
      if (!fs.existsSync(this.sopPath)) return null;
      return fs.readFileSync(this.sopPath, "utf-8");
    } catch {
      return null;
    }
  }

  private log(entry: Record<string, unknown>): void {
    if (!this.persist) return;
    appendJsonl(path.join(penglaiHome(), "logs", "autonomous.jsonl"), entry);
  }

  /**
   * Start watching for idle. When `isIdle(idleThresholdMs)`, `onIdle(sop)`
   * fires (sop = readSop() result) and the idle clock resets (so it doesn't
   * re-fire on every tick). `onIdle` errors are swallowed.
   */
  start(idleThresholdMs: number, onIdle: (sop: string | null) => void): void {
    if (this.interval !== null) return;
    this.idleThresholdMs = idleThresholdMs;
    this.interval = setInterval(() => {
      if (this.isIdle(idleThresholdMs)) {
        this.lastActivity = Date.now();
        const sop = this.readSop();
        this.log({ action: "idle", hasSop: sop !== null });
        try {
          onIdle(sop);
        } catch {
          // A handler failure must not stop the watcher.
        }
      }
    }, this.tickMs);
    this.interval.unref?.();
  }

  /** Stop watching. Safe to call when not running. */
  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

// ── CompanionService ───────────────────────────────────────────

/**
 * Opt-in companion heartbeat (docs/0.4/13-BACKGROUND-SERVICES.md §5.1).
 * Disabled by default; the user must enable it. Every `intervalMs` (default
 * 10 min) while enabled, it fires `onTrigger(source)` with one of the
 * simplified trigger sources (weather/morning/evening/emotion/free), which
 * the caller turns into a companion InboundEvent -> conversation.prompt.
 *
 * With `persist: true`, triggers + enable/disable are logged to
 * `~/.penglai/logs/companion.jsonl`.
 */
export class CompanionService {
  private enabled = false;
  private mode: CompanionMode = "present";
  private conversationId: string | null = null;
  private readonly intervalMs: number;
  private readonly tickMs: number;
  private readonly persist: boolean;
  private readonly statePath: string;
  private readonly clock: () => Date;
  private lastFire: number;
  private lastSource: CompanionSource | null = null;
  private interval: NodeJS.Timeout | null = null;
  private onTrigger: ((source: CompanionSource) => unknown | Promise<unknown>) | null = null;

  constructor(options: CompanionOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_COMPANION_INTERVAL_MS;
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.persist = options.persist ?? false;
    this.statePath = options.statePath ?? path.join(penglaiHome(), "companion.json");
    this.clock = options.clock ?? (() => new Date());
    this.lastFire = Date.now();
    if (this.persist) this.loadState();
  }

  /** Whether the companion heartbeat is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Enable the companion heartbeat. */
  enable(input: { mode?: CompanionMode; conversationId?: string | null } = {}): void {
    this.enabled = true;
    if (input.mode) this.mode = input.mode;
    if (input.conversationId !== undefined) this.conversationId = input.conversationId;
    this.saveState();
    this.log({ action: "enable", mode: this.mode, conversationId: this.conversationId });
  }

  /** Disable the companion heartbeat. */
  disable(): void {
    this.enabled = false;
    this.saveState();
    this.log({ action: "disable" });
  }

  status(): CompanionStatus {
    return {
      enabled: this.enabled,
      mode: this.mode,
      conversationId: this.conversationId,
      lastFire: this.lastFire || null,
      lastSource: this.lastSource,
    };
  }

  setMode(mode: CompanionMode): void {
    this.mode = mode;
    this.saveState();
    this.log({ action: "mode", mode });
  }

  /** Time-aware ritual source. Weather is never guessed; emotion is emitted
   * only by an observed ASR signal or an explicit manual trigger. */
  private nextSource(): CompanionSource {
    const hour = this.clock().getHours();
    if (hour >= 8 && hour < 11) return "morning";
    if (hour >= 18 && hour < 22) return "evening";
    return "free";
  }

  /** Automatic companionship observes a local 22:00-08:00 quiet window.
   * Explicit manual/emotion triggers still use `trigger()` and are not lost. */
  private inDoNotDisturbWindow(): boolean {
    const hour = this.clock().getHours();
    return hour >= 22 || hour < 8;
  }

  private loadState(): void {
    try {
      if (!fs.existsSync(this.statePath)) return;
      hardenPrivateFile(this.statePath, MAX_SERVICE_STATE_BYTES);
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as Partial<CompanionStatus>;
      this.enabled = parsed.enabled === true;
      if (parsed.mode === "quiet" || parsed.mode === "present" || parsed.mode === "active") {
        this.mode = parsed.mode;
      }
      this.conversationId = typeof parsed.conversationId === "string" ? parsed.conversationId : null;
      this.lastFire = typeof parsed.lastFire === "number" ? parsed.lastFire : Date.now();
      this.lastSource = typeof parsed.lastSource === "string" ? parsed.lastSource as CompanionSource : null;
    } catch {
      // First run / corrupt config: safe opt-in default remains disabled.
    }
  }

  private saveState(): void {
    if (!this.persist) return;
    try {
      atomicWritePrivateJson(this.statePath, this.status(), MAX_SERVICE_STATE_BYTES);
    } catch {
      // Persistence failure must not crash the Host; the event log records
      // subsequent behavior for diagnosis.
    }
  }

  private log(entry: Record<string, unknown>): void {
    if (!this.persist) return;
    appendJsonl(path.join(penglaiHome(), "logs", "companion.jsonl"), entry);
  }

  /**
   * Start the heartbeat ticker. When enabled and `now - lastFire >= intervalMs`,
   * `onTrigger(source)` fires and lastFire resets. Does nothing while disabled.
   * `onTrigger` errors are swallowed. Idempotent: calling twice does not double
   * the ticker.
   */
  start(onTrigger: (source: CompanionSource) => unknown | Promise<unknown>): void {
    if (this.interval !== null) return;
    this.onTrigger = onTrigger;
    this.lastFire = Date.now();
    this.interval = setInterval(() => {
      if (!this.enabled || this.mode === "quiet" || this.inDoNotDisturbWindow()) return;
      const now = Date.now();
      if (now - this.lastFire >= this.intervalMs) {
        const source = this.nextSource();
        void this.trigger(source);
      }
    }, this.tickMs);
    this.interval.unref?.();
  }

  /** Emit one observed/manual opportunity through the already registered Host
   * callback. Manual triggers use this same path and remain fully auditable. */
  async trigger(source: CompanionSource): Promise<boolean> {
    if (!this.enabled || !this.onTrigger) return false;
    if (this.mode === "quiet" && source !== "emotion") return false;
    this.lastFire = Date.now();
    this.lastSource = source;
    this.saveState();
    this.log({ action: "trigger", source, mode: this.mode });
    try {
      await this.onTrigger(source);
      return true;
    } catch (error) {
      this.log({
        action: "failed",
        source,
        error: redactSensitiveText(error instanceof Error ? error.message : String(error)).text,
      });
      return false;
    }
  }

  /** Stop the heartbeat. Safe to call when not running. */
  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.onTrigger = null;
  }
}
