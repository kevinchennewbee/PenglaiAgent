import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_DSH, PINNED_DSH_COMMIT } from "./pins.js";

export const OFFICIAL_DSH_GITHUB_REPOSITORY = "deepseek-ai/DeepSeek-Harness";

export interface OfficialDshWorkflowCheckout {
  file: string;
  name: string;
  ref: string;
  repository: string;
}

function isWorkflowStepStart(line: string): boolean {
  return /^[ \t]*- (?:name|uses):/.test(line);
}

export function parseOfficialDshWorkflowCheckouts(
  text: string,
  file = "workflow.yml",
): OfficialDshWorkflowCheckout[] {
  const checkouts: OfficialDshWorkflowCheckout[] = [];
  const lines = text.split(/\r?\n/);
  let current: { name: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n");
    if (!/(?:^|\n)[ \t]*repository:\s*deepseek-ai\/DeepSeek-Harness(?:\s|$)/.test(`\n${body}`)) {
      current = null;
      return;
    }
    const ref = /(?:^|\n)[ \t]*ref:\s*['"]?([0-9a-f]{40})['"]?(?:\s|$)/.exec(`\n${body}`)?.[1];
    if (!ref) {
      throw new Error(`${file} official DSH checkout is missing an exact commit ref`);
    }
    const named = /(?:^|\n)[ \t]*- name:\s*(.+)$/m.exec(`\n${body}`);
    checkouts.push({
      file,
      name: named?.[1]?.trim() ?? current.name,
      ref,
      repository: OFFICIAL_DSH_GITHUB_REPOSITORY,
    });
    current = null;
  };

  for (const line of lines) {
    if (isWorkflowStepStart(line)) {
      flush();
      const named = /^[ \t]*- name:\s*(.*)$/.exec(line);
      current = { name: named?.[1]?.trim() ?? "", body: [line] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();
  return checkouts;
}

export function assertOfficialDshWorkflowCheckouts(checkouts: readonly OfficialDshWorkflowCheckout[]): void {
  if (checkouts.length === 0) {
    throw new Error("no official DSH workflow checkouts found");
  }
  for (const checkout of checkouts) {
    if (checkout.repository !== OFFICIAL_DSH_GITHUB_REPOSITORY) {
      throw new Error(`${checkout.file} official DSH checkout repository drifted`);
    }
    if (checkout.ref !== PINNED_DSH_COMMIT) {
      throw new Error(
        `${checkout.file} official DSH checkout ${checkout.ref} does not match current source contract ${PINNED_DSH_COMMIT}`,
      );
    }
    if (!checkout.name.includes(PINNED_DSH)) {
      throw new Error(
        `${checkout.file} official DSH checkout label ${JSON.stringify(checkout.name)} is not pinned to ${PINNED_DSH}`,
      );
    }
  }
}

export function assertSourceCiOfficialDshEntrypoint(text: string): void {
  const file = ".github/workflows/source-ci.yml";
  const checkouts = parseOfficialDshWorkflowCheckouts(text, file);
  assertOfficialDshWorkflowCheckouts(checkouts);
  if (text.includes("PENGLAI_DSH_ALPHA_SOURCE")) {
    throw new Error("source-ci still binds the official DSH checkout to PENGLAI_DSH_ALPHA_SOURCE");
  }
  if (!text.includes("PENGLAI_DSH_UPSTREAM:")) {
    throw new Error("source-ci live cohort is missing PENGLAI_DSH_UPSTREAM");
  }
  if (!text.includes("pnpm verify:dsh-npm-cohort:live")) {
    throw new Error("source-ci dropped live DSH npm cohort verification");
  }
  if (!text.includes("pnpm verify:dsh-alpha-owner-remotes")) {
    throw new Error("source-ci dropped official DSH owner-remotes verification");
  }
  const mnemon = text.indexOf("pnpm fetch:mnemon-assets");
  const unit = text.indexOf("pnpm test:unit");
  if (mnemon < 0 || unit < 0 || mnemon > unit) {
    throw new Error("source-ci must fetch pinned Mnemon before unit gates");
  }
}

export function assertActiveOfficialDshWorkflowCheckouts(root: string): OfficialDshWorkflowCheckout[] {
  const dir = join(root, ".github/workflows");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  if (!files.includes("source-ci.yml")) {
    throw new Error("source-ci workflow missing");
  }
  const checkouts: OfficialDshWorkflowCheckout[] = [];
  for (const name of files) {
    const relative = `.github/workflows/${name}`;
    const text = readFileSync(join(dir, name), "utf8");
    checkouts.push(...parseOfficialDshWorkflowCheckouts(text, relative));
    if (name === "source-ci.yml") assertSourceCiOfficialDshEntrypoint(text);
  }
  assertOfficialDshWorkflowCheckouts(checkouts);
  return checkouts;
}
