import { describe, expect, it } from "vitest";
import * as fs from "node:fs";

const railSource = fs.readFileSync(
  new URL("../src/ui/WorkbenchRail.tsx", import.meta.url),
  "utf-8",
);
const chatPanelSource = fs.readFileSync(
  new URL("../src/ui/ChatPanel.tsx", import.meta.url),
  "utf-8",
);
const evidenceSource = fs.readFileSync(
  new URL("../src/ui/EvidenceRail.tsx", import.meta.url),
  "utf-8",
);
const doctorSource = fs.readFileSync(
  new URL("../src/ui/DoctorModal.tsx", import.meta.url),
  "utf-8",
);
const appSource = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf-8",
);
const appCssSource = fs.readFileSync(
  new URL("../src/App.css", import.meta.url),
  "utf-8",
);
const rustSource = fs.readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf-8",
);
const allowlist = rustSource.match(/ALLOWED_HOST_METHODS: &\[&str\] = &\[([\s\S]*?)\];/)?.[1] ?? "";

describe("desktop conversation workbench surface", () => {
  it("exposes TODOs without removed job or subagent methods", () => {
    expect(railSource).toContain('"conversation.workbench.get"');
    expect(railSource).toContain('"conversation.todo.upsert"');
    expect(railSource).toContain('"conversation.todo.remove"');

    for (const method of [
      "conversation.subagent.create",
      "conversation.subagent.abort",
      "conversation.job.start",
      "conversation.job.kill",
    ]) {
      expect(railSource, method).not.toContain(method);
      expect(allowlist, method).not.toContain(method);
    }
    expect(railSource).not.toContain("command:");
    expect(railSource).not.toContain("cwd:");
    expect(chatPanelSource).toContain('title="会话待办"');
    expect(chatPanelSource).not.toMatch(/子代理|后台终端/);
    expect(appCssSource).not.toContain("Todo / 子代理 / 后台任务");
    for (const removedClass of [
      ".workbench-tabs",
      ".workbench-add.column",
      ".sub-row",
      ".job-row",
      ".job-output",
    ]) {
      expect(appCssSource, removedClass).not.toContain(removedClass);
    }
  });

  it("keeps task evidence reachable from the single conversation surface", () => {
    expect(chatPanelSource).toContain('title="当前项目任务的真实执行证据"');
    expect(chatPanelSource).toContain("evidenceAvailable");
    expect(appSource).toContain("stream.state.activeTaskId");
    expect(appSource).toContain("evidenceOpen={showTaskRail}");
    expect(appSource).toMatch(
      /selection\.kind === "task" \|\| selection\.kind === "conversation"/,
    );
  });

  it("keeps artifact preview and redacted diagnostics behind explicit owner actions", () => {
    expect(evidenceSource).toContain('"artifact.preview"');
    expect(evidenceSource).toContain("应用内只读预览");
    expect(doctorSource).toContain('"doctor.export"');
    expect(doctorSource).toContain("导出脱敏诊断包");
    expect(allowlist).toContain('"artifact.preview"');
    expect(allowlist).toContain('"doctor.export"');
  });

  it("keeps distilled abilities out of the always-visible composer chrome", () => {
    expect(chatPanelSource).not.toContain("composer-skill-chips");
    expect(chatPanelSource).not.toContain("skill-chip");
    expect(chatPanelSource).toContain('className="slash-menu-label">可用能力');
    expect(chatPanelSource).toContain("按需调用，不常驻输入区");
    expect(chatPanelSource).toContain('className="composer-context-row"');
    expect(chatPanelSource).not.toContain('className="usage-chip quiet"');
    expect(appCssSource).not.toContain(".composer-skill-chips");
  });
});
