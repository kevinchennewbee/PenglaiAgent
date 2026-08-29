import {
  PENGLAI_RESOURCE_JOB_BUDGETS,
  type PenglaiResourceJobBudget,
} from "@penglai/contracts";
import type { ResourceCounts } from "./profile-tx.js";
import type { ResourceProbe } from "./remotes.js";

const PRESSURE_FIELDS = [
  "activeJobs",
  "queuedJobs",
  "remoteRequests",
  "workerThreads",
  "childProcesses",
  "openFiles",
  "timers",
  "sockets",
  "modelSessions",
  "audioHandles",
] as const;

type PressureField = (typeof PRESSURE_FIELDS)[number];
type PressureValues = Record<PressureField, number | null>;

export interface PluginResourcePressure extends PressureValues {
  id: string;
  measured: boolean;
  jobBudget: Readonly<PenglaiResourceJobBudget> | null;
  budgetState:
    | "within-budget"
    | "at-budget"
    | "over-budget"
    | "unbudgeted"
    | "unavailable";
  evidence:
    | "service-resource-snapshot"
    | "runtime-evidence-unavailable"
    | "resource-probe-failed";
}

export interface ResourcePressureSnapshot {
  schema: 2;
  core: {
    evidence: "DSH_ALPHA_RUNTIME_EVIDENCE_REQUIRED";
    trueSubagents: null;
    activeToolCalls: null;
    activeRemoteRequests: null;
    openFiles: null;
  };
  plugins: PluginResourcePressure[];
}

function unavailableValues(): PressureValues {
  return Object.fromEntries(
    PRESSURE_FIELDS.map((field) => [field, null]),
  ) as PressureValues;
}

function safeCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function jobBudget(id: string): Readonly<PenglaiResourceJobBudget> | null {
  return (
    (
      PENGLAI_RESOURCE_JOB_BUDGETS as Readonly<
        Record<string, Readonly<PenglaiResourceJobBudget>>
      >
    )[id] ?? null
  );
}

function measuredRow(
  id: string,
  snapshot: ResourceCounts,
): PluginResourcePressure {
  const values = unavailableValues();
  for (const field of PRESSURE_FIELDS)
    values[field] = safeCount(snapshot[field]);
  const budget = jobBudget(id);
  const activeJobs = values.activeJobs;
  const queuedJobs = values.queuedJobs;
  let budgetState: PluginResourcePressure["budgetState"] = "unbudgeted";
  if (budget) {
    if (activeJobs === null || queuedJobs === null) {
      budgetState = "unavailable";
    } else if (
      activeJobs > budget.activeJobs ||
      queuedJobs > budget.queuedJobs ||
      activeJobs + queuedJobs > budget.totalJobs
    ) {
      budgetState = "over-budget";
    } else if (
      activeJobs === budget.activeJobs ||
      queuedJobs === budget.queuedJobs ||
      activeJobs + queuedJobs === budget.totalJobs
    ) {
      budgetState = "at-budget";
    } else {
      budgetState = "within-budget";
    }
  }
  return {
    id,
    measured: true,
    jobBudget: budget,
    budgetState,
    evidence: "service-resource-snapshot",
    ...values,
  };
}

export function buildResourcePressure(
  ids: readonly string[],
  resourceProbe: (id: string) => ResourceProbe | undefined,
): ResourcePressureSnapshot {
  const plugins = [...new Set(ids)]
    .filter(Boolean)
    .sort()
    .map((id): PluginResourcePressure => {
      let probe: ResourceProbe | undefined;
      try {
        probe = resourceProbe(id);
      } catch {
        return {
          id,
          measured: false,
          jobBudget: jobBudget(id),
          budgetState: "unavailable",
          evidence: "resource-probe-failed",
          ...unavailableValues(),
        };
      }
      if (!probe) {
        return {
          id,
          measured: false,
          jobBudget: jobBudget(id),
          budgetState: "unavailable",
          evidence: "runtime-evidence-unavailable",
          ...unavailableValues(),
        };
      }
      try {
        return measuredRow(id, probe.snapshot());
      } catch {
        return {
          id,
          measured: false,
          jobBudget: jobBudget(id),
          budgetState: "unavailable",
          evidence: "resource-probe-failed",
          ...unavailableValues(),
        };
      }
    });
  return {
    schema: 2,
    core: {
      evidence: "DSH_ALPHA_RUNTIME_EVIDENCE_REQUIRED",
      trueSubagents: null,
      activeToolCalls: null,
      activeRemoteRequests: null,
      openFiles: null,
    },
    plugins,
  };
}
