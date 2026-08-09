/**
 * Penglai Workbench web UI (0.4) - vanilla JS.
 *
 * Talks to the host server via:
 *   POST /api   JSON-RPC 2.0 (token in X-Penglai-Token header)
 *   WS    /ws    streaming events (token + initial session in query string)
 *
 * Flow: (select/create model profile) -> workspace.open -> session.create ->
 * connect WS -> session.prompt. Live events render into Chat / Terminal / Diff
 * tabs. Tool calls are collapsible cards; file changes from edit/write are
 * tracked and shown as line diffs.
 *
 * Built on top of the M3 UI: the JSON-RPC client, websocket connection,
 * session/workspace/usage flows and event mapping are preserved; the workbench
 * surfaces (tabs, terminal, diff, goal panel, model modal, tool cards) are
 * layered on top.
 */
"use strict";

const TOKEN = window.__PENGLAI_TOKEN__ || "";
let rpcId = 0;

// ── element refs ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  // topbar
  profileSelect: $("profileSelect"),
  modelConfigBtn: $("modelConfigBtn"),
  usageBadge: $("usageBadge"),
  connBadge: $("connBadge"),
  // sidebar - sessions
  newSessionBtn: $("newSessionBtn"),
  sessionList: $("sessionList"),
  // sidebar - goal
  goalIdleView: $("goalIdleView"),
  goalActiveView: $("goalActiveView"),
  goalObjectiveInput: $("goalObjectiveInput"),
  startGoalBtn: $("startGoalBtn"),
  goalObjectiveText: $("goalObjectiveText"),
  goalStatusBadge: $("goalStatusBadge"),
  goalIdLabel: $("goalIdLabel"),
  completeGoalBtn: $("completeGoalBtn"),
  cancelGoalBtn: $("cancelGoalBtn"),
  // sidebar - workspace
  workspacePath: $("workspacePath"),
  rootPath: $("rootPath"),
  openWorkspaceBtn: $("openWorkspaceBtn"),
  workspaceStatus: $("workspaceStatus"),
  // main - tabbar
  sessionTitle: $("sessionTitle"),
  sessionStatus: $("sessionStatus"),
  abortBtn: $("abortBtn"),
  diffCount: $("diffCount"),
  // main - panels
  messages: $("messages"),
  terminalOutput: $("terminalOutput"),
  diffList: $("diffList"),
  // composer
  composerInput: $("composerInput"),
  goalMode: $("goalMode"),
  sendBtn: $("sendBtn"),
  turnIndicator: $("turnIndicator"),
  // modal
  modelModal: $("modelModal"),
  closeModalBtn: $("closeModalBtn"),
  modalProfileList: $("modalProfileList"),
  modalLabel: $("modalLabel"),
  modalBaseUrl: $("modalBaseUrl"),
  modalApiKey: $("modalApiKey"),
  modalModel: $("modalModel"),
  envInfo: $("envInfo"),
  saveProfileBtn: $("saveProfileBtn"),
  useProfileBtn: $("useProfileBtn"),
  // misc
  toast: $("toast"),
};

// ── state ──────────────────────────────────────────────────────
const state = {
  workspaceId: null,
  workspaceRoot: null,
  profileId: null,
  profilesCache: [],
  sessionId: null,
  ws: null,
  activeTab: "chat",
  goal: null, // { id, objective, status, ... } | null
  // live streaming anchors (DOM nodes) keyed by toolCallId / current assistant bubble
  currentAssistant: null,
  toolBlocks: new Map(), // live tool cards keyed by toolCallId
  toolCardsByCallId: new Map(), // transcript tool cards keyed by toolCallId (for result attach)
  // diff tracking: per-session list of applied file changes
  fileChanges: [], // { path, type, before, after }
};

// ── JSON-RPC client ────────────────────────────────────────────
async function rpc(method, params = {}) {
  const res = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Penglai-Token": TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}: invalid JSON response`);
  }
  if (res.status === 401) {
    throw new Error("unauthorized: token rejected (restart `serve` or check ~/.penglai/host.token)");
  }
  if (body.error) {
    const err = new Error(body.error.message || "rpc error");
    err.code = body.error.code;
    err.data = body.error.data;
    throw err;
  }
  return body.result;
}

// ── websocket ──────────────────────────────────────────────────
function connectWs(sessionId) {
  if (state.ws) {
    try { state.ws.close(); } catch { /* ignore */ }
    state.ws = null;
  }
  if (!sessionId) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?session=${encodeURIComponent(sessionId)}`;
  const credential = btoa(unescape(encodeURIComponent(TOKEN)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const ws = new WebSocket(url, `penglai.auth.${credential}`);
  state.ws = ws;
  ws.onopen = () => setConn(true);
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleEvent(msg);
  };
  ws.onclose = () => setConn(false);
  ws.onerror = () => setConn(false);
}

function setConn(on) {
  els.connBadge.textContent = on ? "ws: on" : "ws: off";
  els.connBadge.className = "badge " + (on ? "conn-on" : "conn-off");
}

// ── event rendering ────────────────────────────────────────────
function handleEvent(msg) {
  if (msg.event === "subscribed") return;
  switch (msg.event) {
    case "run.started":
      setSessionStatus("running");
      enableAbort(true);
      break;
    case "run.idle":
      els.turnIndicator.classList.add("hidden");
      setSessionStatus("idle");
      enableAbort(false);
      refreshSessions();
      refreshUsage();
      // Reload full transcript so tool args / diffs / final state render cleanly.
      if (state.sessionId) loadSession(state.sessionId, /*keepTab*/ true);
      break;
    case "run.error":
      els.turnIndicator.classList.add("hidden");
      setSessionStatus("error");
      enableAbort(false);
      appendError(msg.message || "unknown error");
      toast(msg.message || "run error", true);
      break;
    case "turn.started":
      appendTurnMarker(msg.turnIndex);
      els.turnIndicator.textContent = `turn ${(msg.turnIndex ?? 0) + 1}…`;
      els.turnIndicator.classList.remove("hidden");
      state.currentAssistant = null;
      break;
    case "assistant.delta":
      appendAssistantText(msg.text || "");
      break;
    case "tool.started":
      startToolBlock(msg.toolCallId, msg.toolName);
      break;
    case "tool.output":
      appendToolOutput(msg.toolCallId, msg.text || "");
      break;
    case "tool.finished":
      finishToolBlock(msg.toolCallId, msg.ok);
      break;
    case "turn.finished":
      state.currentAssistant = null;
      break;
    case "goal.updated":
      handleGoalUpdated(msg.goalId);
      break;
    default:
      break;
  }
}

function appendTurnMarker(turnIndex) {
  const node = document.createElement("div");
  node.className = "turn-marker";
  node.innerHTML = `<span class="turn-tag">turn ${(turnIndex ?? 0) + 1}</span>`;
  els.messages.appendChild(node);
  scrollDown();
}

function appendAssistantText(text) {
  if (!state.currentAssistant) {
    state.currentAssistant = document.createElement("div");
    state.currentAssistant.className = "msg assistant";
    const head = document.createElement("div");
    head.className = "msg-head";
    head.textContent = "assistant";
    const body = document.createElement("div");
    body.className = "msg-body";
    state.currentAssistant.appendChild(head);
    state.currentAssistant.appendChild(body);
    els.messages.appendChild(state.currentAssistant);
  }
  const body = state.currentAssistant.querySelector(".msg-body");
  body.textContent += text;
  scrollDown();
}

// Live tool card (during a run). Args are NOT available in WS events, so the
// card starts with just a name + streaming output; the transcript reload on
// run.idle replaces it with a full card (args + diff).
function startToolBlock(toolCallId, toolName) {
  const startTime = Date.now();
  const card = buildToolCardShell(toolName, "", "running", "");
  const outPre = document.createElement("pre");
  outPre.className = "tool-output";
  card.body.appendChild(labelEl("Output"));
  card.body.appendChild(outPre);
  els.messages.appendChild(card.el);
  state.toolBlocks.set(toolCallId, {
    el: card.el, body: card.body, outputPre: outPre, statusEl: card.statusEl, startTime, toolName,
  });
  // Live terminal header (no args yet).
  termAppendHeader(toolName, "");
  scrollDown();
}

function appendToolOutput(toolCallId, text) {
  const block = state.toolBlocks.get(toolCallId);
  if (block) {
    const span = document.createElement("span");
    span.innerHTML = ansiToHtml(text);
    block.outputPre.appendChild(span);
  }
  termAppendText(text);
  scrollDown();
}

function finishToolBlock(toolCallId, ok) {
  const block = state.toolBlocks.get(toolCallId);
  if (!block) return;
  block.statusEl.textContent = ok ? "ok" : "fail";
  block.statusEl.className = "tool-status " + (ok ? "ok" : "fail");
  block.el.classList.remove("running", "pending");
  block.el.classList.add(ok ? "ok" : "fail");
  const dur = Date.now() - block.startTime;
  const durEl = block.el.querySelector(".tool-duration");
  if (durEl) durEl.textContent = formatDuration(dur);
  state.toolBlocks.delete(toolCallId);
}

function appendError(message) {
  const node = document.createElement("div");
  node.className = "msg error";
  node.innerHTML = `<div class="msg-head">error</div><div class="msg-body">${escapeHtml(message)}</div>`;
  els.messages.appendChild(node);
  scrollDown();
}

// ── transcript rendering (full session) ────────────────────────
function renderMessages(messages) {
  els.messages.innerHTML = "";
  clearTerminal();
  state.toolBlocks.clear();
  state.toolCardsByCallId.clear();
  state.currentAssistant = null;
  state.fileChanges = [];
  renderDiff();
  if (!messages || messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No messages yet. Send a prompt below.";
    els.messages.appendChild(empty);
    return;
  }
  for (const m of messages) renderMessage(m);
  scrollDown();
}

function renderMessage(m) {
  if (m.role === "user") {
    appendBubble("user", joinText(m.content));
    return;
  }
  if (m.role === "assistant") {
    const text = joinText(m.content);
    if (text) appendBubble("assistant", text);
    for (const c of m.content) {
      if (c.type === "tool_call") {
        renderToolHistory(c.toolCallId, c.name, c.arguments);
      }
    }
    return;
  }
  if (m.role === "tool") {
    const result = m.content.find((c) => c.type === "tool_result");
    renderToolResult(m.toolCallId, m.name, result ? result.text : "", result ? result.ok : m.ok);
    return;
  }
  if (m.role === "system") {
    appendBubble("system", joinText(m.content));
    return;
  }
}

// Build a completed tool card from the transcript (args known). The result text
// arrives in the following `tool` message and is attached by renderToolResult.
function renderToolHistory(toolCallId, name, args) {
  const argLine = summarizeArgs(name, args);
  const card = buildToolCardShell(name, argLine, "pending", "");
  const body = card.body;

  body.appendChild(labelEl("Arguments"));
  const argsPre = document.createElement("pre");
  argsPre.className = "tool-args";
  argsPre.textContent = JSON.stringify(args || {}, null, 2);
  body.appendChild(argsPre);

  body.appendChild(labelEl("Output"));
  const outPre = document.createElement("pre");
  outPre.className = "tool-output";
  body.appendChild(outPre);

  // Diff preview for edit/write, derived from the tool args (the actual change
  // the model requested). Added to the Diff tab only if the tool succeeded.
  let change = null;
  if (name === "edit" || name === "write") {
    change = deriveChange(name, args);
    if (change) {
      body.appendChild(labelEl(name === "edit" ? "Change preview" : "Content (new / overwrite)"));
      const diffWrap = document.createElement("div");
      diffWrap.className = "diff-body";
      diffWrap.appendChild(renderDiffLines(change.before, change.after));
      body.appendChild(diffWrap);
      if (name === "write") {
        const note = document.createElement("div");
        note.className = "diff-note";
        note.textContent = "write replaces the whole file; prior content is not captured (no file-read API).";
        body.appendChild(note);
      }
    }
  }

  els.messages.appendChild(card.el);
  state.toolCardsByCallId.set(toolCallId, {
    el: card.el, body, outPre, statusEl: card.statusEl, change, argLine,
  });
}

function renderToolResult(toolCallId, name, text, ok) {
  const card = state.toolCardsByCallId.get(toolCallId);
  if (card) {
    card.outPre.innerHTML = ansiToHtml(text || "");
    card.statusEl.textContent = ok ? "ok" : "fail";
    card.statusEl.className = "tool-status " + (ok ? "ok" : "fail");
    card.el.classList.remove("pending", "running");
    card.el.classList.add(ok ? "ok" : "fail");
    if (ok && card.change) addFileChange(card.change);
    state.toolCardsByCallId.delete(toolCallId);
    termAppendHeader(name, card.argLine || "");
    termAppendText(text || "");
    return;
  }
  // No matching card: render standalone.
  const c = buildToolCardShell(name || "tool", "", ok ? "ok" : "fail", "");
  const outPre = document.createElement("pre");
  outPre.className = "tool-output";
  outPre.innerHTML = ansiToHtml(text || "");
  c.body.appendChild(labelEl("Output"));
  c.body.appendChild(outPre);
  els.messages.appendChild(c.el);
  termAppendHeader(name || "tool", "");
  termAppendText(text || "");
}

function appendBubble(role, text) {
  const node = document.createElement("div");
  node.className = "msg " + role;
  node.innerHTML = `<div class="msg-head">${role}</div><div class="msg-body">${escapeHtml(text)}</div>`;
  els.messages.appendChild(node);
}

// ── tool card builder ──────────────────────────────────────────
function buildToolCardShell(toolName, argLine, statusText, durationText) {
  const el = document.createElement("div");
  el.className = "tool " + (statusText || "pending");
  el.innerHTML =
    '<div class="tool-head">' +
      '<span class="tool-caret">&#9654;</span>' +
      '<span class="tool-name"></span>' +
      '<span class="tool-argline"></span>' +
      '<span class="tool-duration"></span>' +
      '<span class="tool-status"></span>' +
    "</div>" +
    '<div class="tool-body"></div>';
  el.querySelector(".tool-name").textContent = toolName;
  el.querySelector(".tool-argline").innerHTML = argLine
    ? escapeHtml(argLine)
    : '<span class="dim">…</span>';
  el.querySelector(".tool-duration").textContent = durationText || "";
  const statusEl = el.querySelector(".tool-status");
  statusEl.textContent = statusText || "pending";
  statusEl.className = "tool-status " + (statusText || "pending");
  const body = el.querySelector(".tool-body");
  el.querySelector(".tool-head").addEventListener("click", () => el.classList.toggle("expanded"));
  return { el, body, statusEl };
}

function labelEl(text) {
  const d = document.createElement("div");
  d.className = "tool-section-label";
  d.textContent = text;
  return d;
}

function summarizeArgs(name, args) {
  if (!args || typeof args !== "object") return "";
  if (name === "bash") return "$ " + String(args.command || "");
  if (name === "read" || name === "write" || name === "edit") return String(args.path || "");
  try { return JSON.stringify(args).slice(0, 120); } catch { return ""; }
}

// ── terminal ───────────────────────────────────────────────────
function clearTerminal() {
  els.terminalOutput.innerHTML = "";
}

function termAppendHeader(name, argLine) {
  const div = document.createElement("div");
  div.className = "term-header";
  const safeName = escapeHtml(name || "");
  const safeArgs = argLine ? ` <span class="term-cmd">${escapeHtml(argLine)}</span>` : "";
  div.innerHTML = `&#9656; <span class="term-tool">${safeName}</span>${safeArgs}`;
  els.terminalOutput.appendChild(div);
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

function termAppendText(text) {
  if (!text) return;
  const span = document.createElement("span");
  span.innerHTML = ansiToHtml(text);
  els.terminalOutput.appendChild(span);
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

// ── diff tracking ──────────────────────────────────────────────
function deriveChange(name, args) {
  if (name === "edit") {
    return {
      path: String(args?.path || ""),
      type: "edit",
      before: String(args?.old_text ?? ""),
      after: String(args?.new_text ?? ""),
    };
  }
  if (name === "write") {
    return {
      path: String(args?.path || ""),
      type: "write",
      before: "",
      after: String(args?.content ?? ""),
    };
  }
  return null;
}

function addFileChange(change) {
  state.fileChanges.push({ ...change });
  renderDiff();
}

function renderDiff() {
  els.diffCount.textContent = String(state.fileChanges.length);
  if (state.fileChanges.length === 0) {
    els.diffList.innerHTML = '<div class="empty">No file changes yet. Edits and writes will appear here.</div>';
    return;
  }
  els.diffList.innerHTML = "";
  for (const change of state.fileChanges) {
    els.diffList.appendChild(renderDiffCard(change));
  }
}

function renderDiffCard(change) {
  const card = document.createElement("div");
  card.className = "diff-card";
  const head = document.createElement("div");
  head.className = "diff-card-head";
  const pathSpan = document.createElement("span");
  pathSpan.className = "diff-path";
  pathSpan.textContent = change.path || "(unknown path)";
  const typeSpan = document.createElement("span");
  typeSpan.className = "diff-type " + change.type;
  typeSpan.textContent = change.type;
  head.appendChild(pathSpan);
  head.appendChild(typeSpan);
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "diff-body";
  body.appendChild(renderDiffLines(change.before, change.after));
  card.appendChild(body);

  if (change.type === "write") {
    const note = document.createElement("div");
    note.className = "diff-note";
    note.textContent = "write replaces the whole file; prior content not captured.";
    card.appendChild(note);
  }
  return card;
}

function renderDiffLines(before, after) {
  const diff = computeLineDiff(before, after);
  const frag = document.createDocumentFragment();
  const MAX = 400;
  for (let i = 0; i < diff.length; i++) {
    if (i >= MAX) {
      const note = document.createElement("div");
      note.className = "diff-note";
      note.textContent = `… (${diff.length - MAX} more lines truncated)`;
      frag.appendChild(note);
      break;
    }
    const ln = diff[i];
    const div = document.createElement("div");
    div.className = "diff-line " + ln.type;
    const sign = ln.type === "add" ? "+" : ln.type === "del" ? "-" : " ";
    div.textContent = sign + " " + ln.text;
    frag.appendChild(div);
  }
  return frag;
}

/** Simple LCS-based line diff. Returns [{type:'ctx'|'add'|'del', text}]. */
function computeLineDiff(before, after) {
  const a = String(before ?? "").split("\n");
  const b = String(after ?? "").split("\n");
  // Guard against pathological sizes: fall back to a full replace.
  if (a.length + b.length > 4000) {
    const out = [];
    for (const ln of a) out.push({ type: "del", text: ln });
    for (const ln of b) out.push({ type: "add", text: ln });
    return out;
  }
  const m = a.length, n = b.length;
  // dp[i][j] = LCS length of a[i:] vs b[j:]
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: "ctx", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < m) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < n) { out.push({ type: "add", text: b[j] }); j++; }
  return out;
}

// ── goal panel ─────────────────────────────────────────────────
async function refreshGoal() {
  if (!state.sessionId) { state.goal = null; renderGoalPanel(null); return; }
  try {
    const { session } = await rpc("session.get", { sessionId: state.sessionId });
    if (session.goalId) {
      const goal = await rpc("goal.get", { goalId: session.goalId });
      state.goal = goal;
      renderGoalPanel(goal);
    } else {
      state.goal = null;
      renderGoalPanel(null);
    }
  } catch {
    state.goal = null;
    renderGoalPanel(null);
  }
}

async function handleGoalUpdated(goalId) {
  if (!goalId) { await refreshGoal(); return; }
  try {
    const goal = await rpc("goal.get", { goalId });
    state.goal = goal;
    renderGoalPanel(goal);
    toast(`Goal ${goal.status}: ${goal.objective.slice(0, 60)}`);
  } catch {
    await refreshGoal();
  }
}

function renderGoalPanel(goal) {
  if (!goal) {
    els.goalIdleView.classList.remove("hidden");
    els.goalActiveView.classList.add("hidden");
    refreshActions();
    return;
  }
  els.goalIdleView.classList.add("hidden");
  els.goalActiveView.classList.remove("hidden");
  els.goalObjectiveText.textContent = goal.objective || "(no objective)";
  els.goalStatusBadge.textContent = goal.status;
  els.goalStatusBadge.className = "badge " + goal.status;
  els.goalIdLabel.textContent = goal.id ? goal.id.slice(0, 14) : "";
  const terminal = goal.status === "completed" || goal.status === "cancelled" || goal.status === "failed";
  els.completeGoalBtn.disabled = terminal;
  els.cancelGoalBtn.disabled = terminal;
}

async function startGoal(objective, clearInput) {
  if (!state.sessionId) { toast("Open a workspace first"); return; }
  if (!objective) { toast("Enter a goal objective"); return; }
  try {
    // Create the goal, then prompt the session so the agent starts driving
    // toward it (session.prompt with goalObjective binds the goal to the run).
    await rpc("goal.create", { sessionId: state.sessionId, objective });
    await rpc("session.prompt", { sessionId: state.sessionId, text: objective, goalObjective: objective });
    appendBubble("user", objective);
    if (clearInput) clearInput.value = "";
    setSessionStatus("running");
    enableAbort(true);
    await refreshGoal();
    await refreshUsage();
  } catch (e) {
    toast("goal/prompt failed: " + e.message, true);
  }
}

async function cancelGoal() {
  if (!state.goal) return;
  try {
    await rpc("goal.cancel", { goalId: state.goal.id });
    toast("Goal cancelled");
    await refreshGoal();
  } catch (e) {
    toast("cancel failed: " + e.message, true);
  }
}

async function completeGoal() {
  if (!state.goal) return;
  try {
    await rpc("goal.complete", { goalId: state.goal.id });
    toast("Goal marked complete");
    await refreshGoal();
  } catch (e) {
    toast("complete failed: " + e.message, true);
  }
}

// ── model profiles / modal ─────────────────────────────────────
async function loadProfiles() {
  try {
    const profiles = await rpc("config.listProfiles", {});
    state.profilesCache = profiles;
    if (!state.profileId && profiles.length > 0) state.profileId = profiles[0].id;
    refreshProfileSelect();
  } catch (e) {
    toast("config.listProfiles failed: " + e.message, true);
  }
}

function refreshProfileSelect() {
  const profiles = state.profilesCache || [];
  els.profileSelect.innerHTML = "";
  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.label} (${p.model})`;
    if (p.id === state.profileId) opt.selected = true;
    els.profileSelect.appendChild(opt);
  }
}

function openModal() {
  renderModalProfileList();
  populateModalFromSelected();
  els.modelModal.classList.remove("hidden");
}

function closeModal() {
  els.modelModal.classList.add("hidden");
}

function renderModalProfileList() {
  const profiles = state.profilesCache || [];
  els.modalProfileList.innerHTML = "";
  for (const p of profiles) {
    const li = document.createElement("li");
    li.className = "modal-profile-item" + (p.id === state.profileId ? " selected" : "");
    const label = document.createElement("span");
    label.className = "modal-profile-label";
    label.textContent = p.label;
    const meta = document.createElement("span");
    meta.className = "modal-profile-meta";
    meta.textContent = `${p.model} · ${p.apiKeyEnv ? "env:" + p.apiKeyEnv : "inline key"}`;
    li.appendChild(label);
    li.appendChild(meta);
    li.addEventListener("click", () => {
      state.profileId = p.id;
      refreshProfileSelect();
      renderModalProfileList();
      populateModalFromSelected();
    });
    els.modalProfileList.appendChild(li);
  }
}

function populateModalFromSelected() {
  const p = (state.profilesCache || []).find((x) => x.id === state.profileId);
  if (!p) {
    els.envInfo.textContent = "No profile selected.";
    return;
  }
  els.modalLabel.value = p.label;
  els.modalBaseUrl.value = p.baseUrl;
  els.modalModel.value = p.model;
  els.modalApiKey.value = "";
  els.modalApiKey.placeholder = p.apiKeyEnv
    ? `env: ${p.apiKeyEnv} (leave blank to use env)`
    : "paste key (no env var configured)";
  els.envInfo.textContent = p.apiKeyEnv
    ? `Expected env var: ${p.apiKeyEnv} — must be set in the server process environment.`
    : "No env var configured; an inline API key is required.";
}

async function saveProfile() {
  const baseUrl = els.modalBaseUrl.value.trim();
  const model = els.modalModel.value.trim();
  if (!baseUrl || !model) { toast("Base URL and model are required"); return; }
  try {
    const profile = await rpc("config.createProfile", {
      baseUrl,
      apiKey: els.modalApiKey.value.trim() || undefined,
      model,
      label: els.modalLabel.value.trim() || `${model} @ ${baseUrl}`,
    });
    state.profileId = profile.id;
    await loadProfiles();
    renderModalProfileList();
    populateModalFromSelected();
    toast("Profile saved & selected");
  } catch (e) {
    toast("save failed: " + e.message, true);
  }
}

// ── actions ────────────────────────────────────────────────────
async function openWorkspace() {
  const rootPath = els.rootPath.value.trim();
  if (!rootPath) { toast("Enter a workspace path"); return; }
  if (!state.profileId) { toast("Select or create a model profile first (⚙)"); return; }
  try {
    els.workspaceStatus.textContent = "opening…";
    const ws = await rpc("workspace.open", { rootPath, name: basename(rootPath) });
    state.workspaceId = ws.id;
    state.workspaceRoot = ws.rootPath;
    els.workspacePath.textContent = ws.rootPath;
    els.workspaceStatus.textContent = `open: ${ws.name}`;
    await refreshSessions();
    await newSession();
    toast("Workspace opened");
  } catch (e) {
    els.workspaceStatus.textContent = "failed";
    toast("workspace.open failed: " + e.message, true);
  }
}

async function newSession() {
  if (!state.workspaceId || !state.profileId) return;
  try {
    const session = await rpc("session.create", {
      workspaceId: state.workspaceId,
      modelProfileId: state.profileId,
      title: "Session " + new Date().toLocaleTimeString(),
    });
    state.sessionId = session.id;
    els.sessionTitle.textContent = session.title;
    setSessionStatus("idle");
    renderMessages([]);
    renderGoalPanel(null);
    state.goal = null;
    connectWs(session.id);
    await refreshSessions();
    await refreshGoal();
    els.composerInput.focus();
  } catch (e) {
    toast("session.create failed: " + e.message, true);
  }
}

async function refreshSessions() {
  try {
    const sessions = await rpc("session.list", {});
    els.sessionList.innerHTML = "";
    for (const s of sessions) {
      const li = document.createElement("li");
      li.className = "session-item" + (s.id === state.sessionId ? " active" : "");
      const title = document.createElement("div");
      title.className = "session-title";
      title.textContent = s.title || s.id;
      const meta = document.createElement("div");
      meta.className = "session-meta";
      const dot = document.createElement("span");
      dot.className = "session-status-dot " + s.status;
      meta.appendChild(dot);
      meta.appendChild(document.createTextNode(` ${s.status} · ${formatTime(s.updatedAt)}`));
      li.appendChild(title);
      li.appendChild(meta);
      li.addEventListener("click", () => loadSession(s.id));
      els.sessionList.appendChild(li);
    }
  } catch (e) {
    toast("session.list failed: " + e.message, true);
  }
}

async function loadSession(sessionId, keepTab = false) {
  try {
    const { session, messages } = await rpc("session.get", { sessionId });
    state.sessionId = sessionId;
    els.sessionTitle.textContent = session.title || sessionId;
    setSessionStatus(session.status);
    renderMessages(messages);
    if (!keepTab) switchTab("chat");
    connectWs(sessionId);
    await refreshSessions();
    await refreshGoal();
  } catch (e) {
    toast("session.get failed: " + e.message, true);
  }
}

async function sendPrompt(text) {
  if (!state.sessionId) { toast("Open a workspace first"); return; }
  if (!text) return;
  try {
    await rpc("session.prompt", { sessionId: state.sessionId, text });
    appendBubble("user", text);
    els.composerInput.value = "";
    setSessionStatus("running");
    enableAbort(true);
    await refreshUsage();
  } catch (e) {
    toast("prompt failed: " + e.message, true);
  }
}

async function abortRun() {
  if (!state.sessionId) return;
  try {
    await rpc("session.abort", { sessionId: state.sessionId });
    toast("Abort requested");
  } catch (e) {
    toast("abort failed: " + e.message, true);
  }
}

async function refreshUsage() {
  try {
    const u = await rpc("usage.get", {});
    els.usageBadge.textContent = `req ${u.totalRequests} · tok ${u.totalTokens}`;
  } catch { /* non-fatal */ }
}

// ── tabs ───────────────────────────────────────────────────────
function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const panel = document.getElementById("panel" + name.charAt(0).toUpperCase() + name.slice(1));
  if (panel) panel.classList.add("active");
  if (name === "terminal") {
    els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
  }
}

// ── ui helpers ─────────────────────────────────────────────────
function setSessionStatus(status) {
  els.sessionStatus.textContent = status;
  els.sessionStatus.className = "badge " + status;
  const canSend = state.sessionId && (status === "idle" || status === "waiting_user" || status === "error");
  els.sendBtn.disabled = !canSend;
  refreshActions();
}

function enableAbort(on) {
  els.abortBtn.disabled = !on;
}

function refreshActions() {
  const ready = !!(state.workspaceId && state.profileId);
  els.newSessionBtn.disabled = !ready;
  els.startGoalBtn.disabled = !(ready && state.sessionId);
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

let toastTimer = null;
function toast(message, isError) {
  els.toast.textContent = message;
  els.toast.className = "toast" + (isError ? " error" : "");
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 4000);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert basic ANSI SGR color escapes to HTML spans; strip other CSI sequences. */
function ansiToHtml(text) {
  if (!text) return "";
  const colors = {
    0: null, 30: "#000", 31: "#f85149", 32: "#3fb950", 33: "#d29922",
    34: "#2f81f7", 35: "#bc8cff", 36: "#39c5cf", 37: "#e6edf3",
    90: "#6e7681", 91: "#ffa198", 92: "#56d364", 93: "#e3b341",
    94: "#79c0ff", 95: "#d2a8ff", 96: "#56d4dd", 97: "#f0f6fc",
  };
  // Drop non-SGR CSI sequences (cursor moves, clears, etc.), keep SGR (m).
  const cleaned = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, (s) =>
    /^\x1b\[[0-9;]*m$/.test(s) ? s : "");
  const parts = cleaned.split(/(\x1b\[[0-9;]*m)/);
  let html = "";
  let color = null;
  for (const part of parts) {
    if (!part) continue;
    const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (sgr) {
      const codes = sgr[1] === "" ? [] : sgr[1].split(";").map(Number);
      if (codes.length === 0) color = null;
      for (const c of codes) {
        if (c === 0) color = null;
        else if (colors[c] !== undefined) color = colors[c];
      }
    } else {
      const esc = escapeHtml(part).replace(/\r/g, "");
      html += color ? `<span style="color:${color}">${esc}</span>` : esc;
    }
  }
  return html;
}

function joinText(content) {
  return (content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function basename(p) {
  const parts = String(p).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "workspace";
}

function formatTime(ms) {
  if (!ms) return "-";
  try { return new Date(ms).toLocaleString(); } catch { return "-"; }
}

function formatDuration(ms) {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s";
}

// ── wiring ─────────────────────────────────────────────────────
els.openWorkspaceBtn.addEventListener("click", openWorkspace);
els.newSessionBtn.addEventListener("click", newSession);
els.sendBtn.addEventListener("click", () => {
  const text = els.composerInput.value.trim();
  if (!text) return;
  if (els.goalMode.checked) {
    startGoal(text, els.composerInput);
  } else {
    sendPrompt(text);
  }
});
els.abortBtn.addEventListener("click", abortRun);
els.startGoalBtn.addEventListener("click", () => {
  const obj = els.goalObjectiveInput.value.trim();
  startGoal(obj, els.goalObjectiveInput);
});
els.completeGoalBtn.addEventListener("click", completeGoal);
els.cancelGoalBtn.addEventListener("click", cancelGoal);

els.profileSelect.addEventListener("change", () => {
  state.profileId = els.profileSelect.value;
  populateModalFromSelected();
});

els.modelConfigBtn.addEventListener("click", openModal);
els.closeModalBtn.addEventListener("click", closeModal);
els.saveProfileBtn.addEventListener("click", saveProfile);
els.useProfileBtn.addEventListener("click", closeModal);
els.modelModal.querySelectorAll("[data-close-modal]").forEach((el) =>
  el.addEventListener("click", closeModal));

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => switchTab(t.dataset.tab)));

els.composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.sendBtn.click();
  }
});

// boot
loadProfiles();
refreshUsage();
setInterval(refreshUsage, 15000);
renderGoalPanel(null);
renderDiff();
