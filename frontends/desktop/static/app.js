window.process = window.process || { platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32' };
// Penglai Desktop — Renderer Logic
// Handles UI state, sessions, streaming, slash commands.

'use strict';

// ─── State ────────────────────────────────────────────────────────────────
const state = {
  sessions: new Map(),      // localSessionId -> { id, bridgeSessionId, title, messages: [], cwd, config, diagnostics }
  activeId: null,
  bridgeReady: false,
  defaultConfig: { theme: 'auto', llmNo: 0, penglaiRoot: '' },
  modelProfiles: [],
  restartingBridge: false,
  bridgeNoticeMessage: null,
  mykeyReady: true,
  runtimeBySessionId: new Map(),
  speechAudio: null,
  speechBusy: false,
};

// Helper: get config/diagnostics for the active session (or defaults)
function getActiveConfig() {
  const sess = state.sessions.get(state.activeId);
  return sess ? sess.config : state.defaultConfig;
}
function getActiveDiagnostics() {
  const sess = state.sessions.get(state.activeId);
  return sess ? sess.diagnostics : [];
}

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const inputEl = $('input');
const sendBtn = $('send-btn');
const sessionListEl = $('session-list');
const sessionTitleEl = $('session-title');
const statusBadge = $('status-badge');
const statusText = $('status-text');
const settingsModal = $('settings-modal');
const errorBanner = $('error-banner');
const diagnosticsPanel = $('diagnostics-panel');
const diagnosticsLogEl = $('diagnostics-log');
const opsSummaryEl = $('ops-summary');
const opsOutputEl = $('ops-output');
const speakLastBtn = $('speak-last-btn');


// ─── Diagnostics ─────────────────────────────────────────────────────────
const MAX_DIAGNOSTICS = 200;

function diagnosticText(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (payload instanceof Error) return payload.stack || payload.message;
  try {
    return JSON.stringify(payload);
  } catch (_) {
    return String(payload);
  }
}

function addDiagnostic(level, message, payload) {
  const ts = new Date().toISOString();
  const detail = diagnosticText(payload);
  const diags = getActiveDiagnostics();
  diags.push({ ts, level, message, detail });
  if (diags.length > MAX_DIAGNOSTICS) diags.shift();
  renderDiagnostics();
}

function formatDiagnostics() {
  const diags = getActiveDiagnostics();
  if (diags.length === 0) return '暂无诊断信息。';
  return diags.map((entry) => {
    const suffix = entry.detail ? `\n  ${entry.detail}` : '';
    return `[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}${suffix}`;
  }).join('\n');
}

function renderDiagnostics() {
  if (diagnosticsLogEl) diagnosticsLogEl.textContent = formatDiagnostics();
}

function openDiagnostics() {
  renderDiagnostics();
  diagnosticsPanel.classList.remove('hidden');
}

function closeDiagnostics() {
  diagnosticsPanel.classList.add('hidden');
}

async function copyDiagnostics() {
  const text = formatDiagnostics();
  try {
    await navigator.clipboard.writeText(text);
    addDiagnostic('info', '诊断信息已复制到剪贴板');
  } catch (err) {
    addDiagnostic('error', '复制诊断信息失败', err);
    showError('复制诊断信息失败：' + (err.message || err), null, null, { skipDiagnostic: true });
  }
}

function clearDiagnostics() {
  const sess = state.sessions.get(state.activeId);
  if (sess) sess.diagnostics = [];
  renderDiagnostics();
}

// ─── Markdown ─────────────────────────────────────────────────────────────
if (typeof marked !== 'undefined') {
  marked.setOptions({
    gfm: true,
    breaks: true,
    mangle: false,
    headerIds: false
  });
}

const ALLOWED_URI_RE = /^(https?:|mailto:|tel:|#|\/)/i;

function renderMarkdown(text) {
  if (typeof marked === 'undefined') {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  try {
    return sanitizeMarkdown(marked.parse(text));
  } catch (e) {
    return escapeHtml(text);
  }
}

function sanitizeMarkdown(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html);
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const removals = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (blockedTags.has(el.tagName)) {
      removals.push(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && value && !ALLOWED_URI_RE.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('target', '_blank');
    }
  }
  for (const el of removals) el.remove();
  return template.innerHTML;
}


function detectStructuredKind(line) {
  const trimmed = String(line || '').trim();
  const m = trimmed.match(/^(TOOL_RECALL|TOOL_REQUEST|TOOL_RESPONSE|COWORK|TUNR|TURN|ACTION|OBSERVATION|THOUGHT|TOOL)[\s:_-]*(.*)$/i);
  if (m) return { kind: m[1].toUpperCase(), rest: (m[2] || '').trim() };

  // The upstream ACP bridge currently streams tool calls/results as plain
  // assistant text, not as ACP `tool_call` notifications. Recognize the real
  // XML-ish markers so streamed code_run/file_read/etc. blocks are folded.
  if (/^<function_calls\b[^>]*>/i.test(trimmed) || /^<invoke\b[^>]*\bname=["'][^"']+["'][^>]*>/i.test(trimmed)) {
    return { kind: 'TOOL_CALL', rest: trimmed };
  }
  if (/^<function_results\b[^>]*>/i.test(trimmed) || /^<result\b[^>]*>/i.test(trimmed)) {
    return { kind: 'TOOL_RESULT', rest: trimmed };
  }
  return null;
}

function isStructuredClosingLine(line, kind, textSoFar) {
  const trimmed = String(line || '').trim();
  const block = String(textSoFar || '');
  if (kind === 'TOOL_CALL') {
    if (/^<\/function_calls>$/i.test(trimmed)) return true;
    // Single-invoke streams may omit the <function_calls> wrapper.
    return /^<\/invoke>$/i.test(trimmed) && !/^\s*<function_calls\b/im.test(block);
  }
  if (kind === 'TOOL_RESULT') {
    if (/^<\/function_results>$/i.test(trimmed)) return true;
    // Single-result streams may omit the <function_results> wrapper.
    return /^<\/result>$/i.test(trimmed) && !/^\s*<function_results\b/im.test(block);
  }
  return false;
}

function summarizeStructuredBlock(kind, text) {
  const raw = String(text || '');
  // For all kinds: prefer <summary> tag content only
  const summaryMatch = raw.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/i);
  if (summaryMatch) {
    const line = summaryMatch[1].trim().split('\n')[0] || kind;
    return line.length > 96 ? line.slice(0, 96) + '…' : line;
  }
  // No summary tag: show kind only (no body text leakage)
  if (kind === 'LLM_RUNNING') return '模型运行中';
  return kind;
}

const LLM_RUNNING_MARKER_RE = /(\**LLM Running \(Turn \d+\) \.\.\.\**)/g;

function splitLLMRunningSegments(raw) {
  const placeholders = [];
  const protect = value => {
    placeholders.push(value);
    return `\u0000PH${placeholders.length - 1}\u0000`;
  };
  let safe = String(raw || '').replace(/`{4,}[\s\S]*?`{4,}/g, protect);
  safe = safe.replace(/`{4,}[^`][\s\S]*$/g, protect);
  const restore = value => String(value || '').replace(/\u0000PH(\d+)\u0000/g, (_, i) => placeholders[Number(i)] || '');
  const parts = safe.split(LLM_RUNNING_MARKER_RE).map(restore);
  if (parts.length < 4) return null;
  const segments = [];
  if (parts[0] && parts[0].trim()) segments.push({ kind: 'agent_message_chunk', text: parts[0].trimEnd() });
  const turns = [];
  for (let i = 1; i < parts.length; i += 2) {
    turns.push({ marker: parts[i] || '', content: parts[i + 1] || '' });
  }
  turns.forEach((turn, idx) => {
    const text = `${turn.marker}${turn.content}`.trimEnd();
    if (!text) return;
    // Match Streamlit: historical/intermediate LLM Running turns are folded;
    // the latest turn remains plain so final answers are not hidden by default.
    segments.push({ kind: idx < turns.length - 1 ? 'LLM_RUNNING' : 'agent_message_chunk', text });
  });
  return segments.length ? segments : null;
}

function splitStructuredSegments(text) {
  const raw = String(text || '');
  const llmSegments = splitLLMRunningSegments(raw);
  if (llmSegments) return llmSegments;
  const lines = raw.split(/\r?\n/);
  const segments = [];
  let buf = [];
  let kind = 'agent_message_chunk';
  let inFence = false;
  const flush = () => {
    if (!buf.length) return;
    segments.push({ kind, text: buf.join('\n').trimEnd() });
    buf = [];
  };
  for (const line of lines) {
    const fence = /^\s*```/.test(line);
    const hit = !inFence ? detectStructuredKind(line) : null;
    if (hit && hit.kind !== kind) {
      flush();
      kind = hit.kind;
      buf.push(line);
    } else {
      buf.push(line);
    }
    if (!inFence && kind !== 'agent_message_chunk' && isStructuredClosingLine(line, kind, buf.join('\n'))) {
      flush();
      kind = 'agent_message_chunk';
    }
    if (fence) inFence = !inFence;
  }
  flush();
  return segments.length ? segments : [{ kind: 'agent_message_chunk', text: raw }];
}

function hasUnfencedStructuredMarker(text) {
  let inFence = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const fence = /^\s*```/.test(line);
    if (!inFence && detectStructuredKind(line)) return true;
    if (fence) inFence = !inFence;
  }
  return false;
}

function shouldFoldSegment(kind, text) {
  return kind !== 'agent_message_chunk' || hasUnfencedStructuredMarker(text);
}

function getNowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return Math.round(performance.now());
  return Date.now();
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTaskElapsed(ms, ended) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (hours || minutes) parts.push(`${minutes}min`);
  parts.push(`${seconds}s`);
  const elapsed = parts.join(' ');
  if (ended) return `Done ✓ ${elapsed}`;
  const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const frame = spinner[Math.floor(Date.now() / 1000) % spinner.length];
  return `${frame} ${elapsed}`;
}

function getSessionRuntime(sess) {
  if (!sess) return null;
  const sessionId = sess.id;
  let runtime = state.runtimeBySessionId.get(sessionId);
  if (!runtime) {
    runtime = {
      busy: false,
      currentTurnEl: null,
      lastMessageType: null,
      taskStartedAt: 0,
      taskTimerId: null,
      assistantDraft: null,

    };
    state.runtimeBySessionId.set(sessionId, runtime);
  }
  return runtime;
}

function getActiveSessionRuntime() {
  const sess = state.sessions.get(state.activeId);
  return sess ? getSessionRuntime(sess) : null;
}

function findSessionByBridgeId(bridgeSessionId) {
  if (!bridgeSessionId) return state.sessions.get(state.activeId) || null;
  for (const sess of state.sessions.values()) {
    if (sess.bridgeSessionId === bridgeSessionId || sess.id === bridgeSessionId) return sess;
  }
  return null;
}

function isActiveSession(sess) {
  return !!sess && sess.id === state.activeId;
}

function withSessionDom(sess, fn) {
  if (isActiveSession(sess)) return fn();
  return null;
}

function updateTaskRuntimeBadges(now = getNowMs()) {
  const badges = document.querySelectorAll('.task-elapsed[data-started-at]');
  badges.forEach((badge) => {
    const startedAt = Number(badge.dataset.startedAt || 0);
    if (startedAt) badge.textContent = formatTaskElapsed(now - startedAt);
  });
}

function clearTaskTimer(sess) {
  const runtime = sess ? getSessionRuntime(sess) : getActiveSessionRuntime();
  if (runtime?.taskTimerId) {
    clearInterval(runtime.taskTimerId);
    runtime.taskTimerId = null;
  }
}

function startTaskTimer(sess, startedAt = getNowMs()) {
  const runtime = getSessionRuntime(sess);
  clearTaskTimer(sess);
  runtime.taskStartedAt = Number(startedAt) || getNowMs();
  if (isActiveSession(sess)) updateTaskRuntimeBadges(runtime.taskStartedAt);
  runtime.taskTimerId = setInterval(() => {
    if (isActiveSession(sess)) updateTaskRuntimeBadges();
  }, 1000);
}

function stopTaskTimer(sess) {
  if (isActiveSession(sess)) updateTaskRuntimeBadges();
  const runtime = getSessionRuntime(sess);
  clearTaskTimer(sess);
  runtime.taskStartedAt = 0;
}

function taskElapsedBadge(startedAt, endedAt) {
  const start = Number(startedAt || 0);
  if (!start) return '';
  const end = Number(endedAt || 0);
  const now = end || getNowMs();
  const ended = !!end;
  const liveAttr = ended ? 'data-ended="1"' : `data-started-at="${escapeHtml(String(start))}"`;
  return `<span class="task-elapsed" ${liveAttr}>${escapeHtml(formatTaskElapsed(now - start, ended))}</span>`;
}

function ensureAssistantTaskElapsed(wrap, startedAt, endedAt) {
  if (!wrap) return null;
  const html = taskElapsedBadge(startedAt, endedAt);
  let badge = wrap.querySelector(':scope > .task-elapsed');
  if (!html) {
    badge?.remove();
    return null;
  }
  if (!badge) {
    wrap.insertAdjacentHTML('afterbegin', html);
    badge = wrap.querySelector(':scope > .task-elapsed');
  } else {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    badge.replaceWith(holder.firstElementChild);
    badge = wrap.querySelector(':scope > .task-elapsed');
  }
  return badge;
}

function turnLabelForSegment(seg, index) {
  const summary = summarizeStructuredBlock(seg.kind, seg.text);
  if (seg.kind === 'LLM_RUNNING') return summary || `第 ${index + 1} 轮`;
  if (seg.kind === 'TOOL_CALL') return '工具调用';
  if (seg.kind === 'TOOL_RESULT') return '工具结果';
  return summary || seg.kind || `第 ${index + 1} 轮`;
}

function nextTurnIndexForWrap(wrap) {
  const current = Number(wrap?.dataset?.turnIndex || 0) || 0;
  const next = current + 1;
  if (wrap) wrap.dataset.turnIndex = String(next);
  return next;
}

function turnHeaderLabel(index, label) {
  return `第 ${index} 轮：${label || '回复'}`;
}

function groupIntoTurns(segments, options = {}) {
  let foldIndex = 0;
  return (segments || []).map((seg) => {
    if (!shouldFoldSegment(seg.kind, seg.text)) return { type: 'plain', segment: seg };
    const index = ++foldIndex;
    return {
      type: 'turn',
      index,
      label: turnLabelForSegment(seg, index - 1),
      segment: seg
    };
  });
}

function extractTagBody(text, tag) {
  const escapedTag = String(tag || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = '<' + escapedTag + '\\b[^>]*>([\\s\\S]*?)<\\/' + escapedTag + '>';
  const m = String(text || '').match(new RegExp(pattern, 'i'));
  return m ? m[1].trim() : '';
}

function parseToolDetails(kind, text) {
  const raw = String(text || '');
  if (kind === 'TOOL_CALL') {
    const invoke = raw.match(/<invoke\b[^>]*\bname=["']([^"']+)["'][^>]*>/i);
    const tool = invoke ? invoke[1] : '';
    const params = extractTagBody(raw, 'parameter') || extractTagBody(raw, 'arguments') || extractTagBody(raw, 'args');
    const jsonish = params || (raw.match(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/i)?.[0] || '').replace(/<\/?invoke[^>]*>/gi, '').trim();
    if (tool || jsonish) return { title: tool ? `工具：${tool}` : '工具调用', tool, args: jsonish };
  }
  if (kind === 'TOOL_RESULT') {
    const result = extractTagBody(raw, 'result') || raw.replace(/<\/?function_results[^>]*>/gi, '').trim();
    if (result) return { title: '工具结果', tool: 'result', args: result };
  }
  return null;
}

function renderToolDetailInto(container, seg) {
  const detail = parseToolDetails(seg.kind, seg.text);
  if (!detail) return;
  const detailTurn = document.createElement('div');
  detailTurn.className = 'turn tool-detail-turn';
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'turn-header tool-detail-header';
  header.innerHTML = `<span class="turn-caret">▼</span><span class="turn-tag">${escapeHtml(detail.title)}</span><span class="turn-summary">参数</span>`;
  header.addEventListener('click', () => detailTurn.classList.toggle('collapsed'));
  const body = document.createElement('div');
  body.className = 'turn-body md tool-detail-body';
  const codeText = `工具：${detail.tool || detail.title.replace(/^工具：\s*/, '') || 'tool'}\n参数：\n${detail.args || ''}`;
  body.innerHTML = `<pre class="tool-args-code"><code>${escapeHtml(codeText)}</code></pre>`;
  detailTurn.appendChild(header);
  detailTurn.appendChild(body);
  container.appendChild(detailTurn);
}

function renderTurnTreeInto(container, turn) {
  const seg = turn.segment;
  const node = document.createElement('div');
  node.className = 'turn collapsed structured-turn turn-group';
  node.dataset.kind = seg.kind;
  node.dataset.buf = seg.text;
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'turn-header';
  header.innerHTML = `<span class="turn-caret">▼</span><span class="turn-tag">${escapeHtml(turnHeaderLabel(turn.index, turn.label))}</span>`;
  header.addEventListener('click', () => node.classList.toggle('collapsed'));
  const body = document.createElement('div');
  body.className = 'turn-body md';
  const hasToolDetail = Boolean(parseToolDetails(seg.kind, seg.text));
  renderToolDetailInto(body, seg);
  if (!hasToolDetail) {
    const rendered = document.createElement('div');
    rendered.className = 'turn-rendered-md';
    rendered.innerHTML = renderMarkdown(seg.text);
    body.appendChild(rendered);
  }
  node.appendChild(header);
  node.appendChild(body);
  container.appendChild(node);
}

/**
 * Extract <summary>...</summary> from text, render it as a faded italic hint,
 * and return the remaining text. If no summary tag found, returns text unchanged.
 */
/**
 * Strip leading <summary> and <think> tags from text.
 * Returns { summary, think, remaining } where summary/think are the extracted
 * content strings (or null), and remaining is the text to render as markdown.
 */
function stripLeadingMetaTags(text) {
  let remaining = text;
  let summary = null;
  let think = null;
  // Strip <summary>...</summary> at start
  const sumRe = /^<summary>([\s\S]*?)<\/summary>\s*/i;
  const sumM = remaining.match(sumRe);
  if (sumM) {
    summary = sumM[1].trim();
    remaining = remaining.slice(sumM[0].length);
  }
  // Strip <think>...</think> at start (or after summary)
  const thinkRe = /^<think>([\s\S]*?)<\/think>\s*/i;
  const thinkM = remaining.match(thinkRe);
  if (thinkM) {
    think = thinkM[1].trim();
    remaining = remaining.slice(thinkM[0].length);
  }
  return { summary, think, remaining };
}

function extractAndRenderSummary(container, text) {
  const { summary, think, remaining } = stripLeadingMetaTags(text);
  if (summary) {
    const hint = document.createElement('div');
    hint.className = 'summary-hint';
    hint.textContent = summary;
    container.appendChild(hint);
  }
  if (think) {
    const thinkEl = document.createElement('div');
    thinkEl.className = 'think-hint';
    thinkEl.textContent = think;
    container.appendChild(thinkEl);
  }
  return remaining;
}

function renderStructuredMarkdownInto(container, text, options = {}) {
  const segments = splitStructuredSegments(text);
  container.innerHTML = '';
  if (segments.length === 1 && !shouldFoldSegment(segments[0].kind, segments[0].text)) {
    const remaining = extractAndRenderSummary(container, text);
    if (remaining) container.insertAdjacentHTML('beforeend', renderMarkdown(remaining));
    return;
  }
  for (const item of groupIntoTurns(segments, options)) {
    if (item.type === 'plain') {
      const plain = document.createElement('div');
      plain.className = 'md';
      const remaining = extractAndRenderSummary(plain, item.segment.text);
      if (remaining) plain.insertAdjacentHTML('beforeend', renderMarkdown(remaining));
      container.appendChild(plain);
      continue;
    }
    renderTurnTreeInto(container, item);
  }
}

// ─── Copy button injection for code blocks and pre blocks ─────────────────
function injectCopyButtons(container) {
  if (!container) return;
  const blocks = container.querySelectorAll('pre');
  blocks.forEach(pre => {
    if (pre.querySelector('.copy-btn')) return; // already injected
    pre.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.setAttribute('aria-label', '复制代码');
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code') || pre;
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = '✓ 已复制';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
      }).catch(() => {
        btn.textContent = '✗ 失败';
        setTimeout(() => { btn.textContent = '复制'; }, 2000);
      });
    });
    pre.appendChild(btn);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ─── Session management ──────────────────────────────────────────────────
function isUntitledSessionTitle(title) {
  return !title || /^new\s+chat$/i.test(String(title).trim()) || String(title).trim() === '新对话';
}

function createLocalSession(id, title, bridgeSessionId = id) {
  const sess = {
    id, bridgeSessionId, title: title || '新对话', messages: [], cwd: null,
    untitled: isUntitledSessionTitle(title),
    config: { ...state.defaultConfig },
    diagnostics: [],
  };
  getSessionRuntime(sess);
  // Keep freshly-created chats visually quiet: the empty state is enough guidance.
  state.sessions.set(id, sess);
  renderSessionList();
  return sess;
}

function setActiveSession(id) {
  // Save scroll position of current session before switching
  if (state.activeId) {
    const prevRuntime = state.runtimeBySessionId.get(state.activeId);
    if (prevRuntime) prevRuntime.scrollPos = messagesEl.scrollTop;
  }
  state.activeId = id;
  const sess = state.sessions.get(id);
  if (!sess) return;
  sessionTitleEl.textContent = sess.title;
  renderMessages();
  renderSessionList();
  renderDiagnostics();
  updateSpeechButton();
  const runtime = getSessionRuntime(sess);
  setBusy(runtime.busy, runtime.busy ? '蓬莱正在回复…' : null, sess);
  // When switching to a session that is still running, ensure the live draft
  // is rendered immediately and polling is active (it may have been started
  // earlier but its render calls were no-ops because the session wasn't active).
  if (runtime.busy) {
    const draft = runtime.assistantDraft;
    if (draft && !draft.finalized) {
      renderAssistantDraftInPlace(sess, draft);
    }
    // Restart polling if it stopped (e.g. page reload or race condition)
    if (!runtime.polling) {
      runtime.forcePollOnce = true;
      pollSessionMessages(sess);
    } else {
      // Polling is running but was rendering as no-op while we were away.
      // Do an immediate one-shot poll to refresh the view right now.
      (async () => {
        try {
          const res = await GaBridge.pollSession(sess.bridgeSessionId || sess.id, runtime.lastPolledMessageId || 0);
          if (res?.error) return;
          const result = res.result || res;
          for (const msg of (result.messages || [])) upsertPolledMessage(sess, msg, { partial: false });
          if (result.partial) upsertPolledMessage(sess, result.partial, { partial: true });
        } catch(e) { /* ignore, regular polling will handle it */ }
      })();
    }
  }
}

function renderSessionList() {
  // Preserve the + button (must remain in DOM as anchor for insertBefore)
  const newBtn = document.getElementById('new-session-btn');
  // Remove only existing tab elements, never the + button
  sessionListEl.querySelectorAll('.session-tab').forEach((el) => el.remove());
  if (state.sessions.size === 0) return;
  for (const sess of state.sessions.values()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'session-tab' + (sess.id === state.activeId ? ' active' : '');
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', sess.id === state.activeId ? 'true' : 'false');
    item.setAttribute('data-session-id', sess.id);
    item.title = sess.title;
    // ─── Drag-and-drop reorder ───
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', sess.id);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      sessionListEl.querySelectorAll('.session-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== sess.id) {
        reorderSession(draggedId, sess.id);
      }
    });
    // Per-tab status dot
    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    const runtime = getSessionRuntime(sess);
    if (runtime && runtime.busy) dot.classList.add('busy');
    item.appendChild(dot);
    // Tab label
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = sess.title;
    item.appendChild(label);
    // Close button (Chrome-style ×)
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('aria-label', '关闭标签');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSession(sess.id);
    });
    item.appendChild(closeBtn);
    item.addEventListener('click', () => setActiveSession(sess.id));
    sessionListEl.insertBefore(item, newBtn);
  }
}

// ─── Tab drag reorder helper ─────────────────────────────────────────────────
function reorderSession(draggedId, targetId) {
  const entries = [...state.sessions.entries()];
  const fromIdx = entries.findIndex(([id]) => id === draggedId);
  const toIdx = entries.findIndex(([id]) => id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = entries.splice(fromIdx, 1);
  entries.splice(toIdx, 0, moved);
  state.sessions = new Map(entries);
  renderSessionList();
}

function closeSession(id) {
  if (state.sessions.size <= 1) return; // Don't close the last tab
  // Notify bridge to delete this session
  const sess = state.sessions.get(id);
  if (sess && sess.bridgeSessionId) {
    window.penglai.deleteSession(sess.bridgeSessionId).catch(() => {});
  }
  const keys = [...state.sessions.keys()];
  const idx = keys.indexOf(id);
  state.sessions.delete(id);
  state.runtimeBySessionId.delete(id);
  if (state.activeId === id) {
    // Switch to adjacent tab (prefer right, fallback left)
    const newIdx = Math.min(idx, keys.length - 2);
    const remaining = [...state.sessions.keys()];
    setActiveSession(remaining[Math.max(0, Math.min(newIdx, remaining.length - 1))]);
  } else {
    renderSessionList();
  }
}

async function newSession() {
  if (!state.bridgeReady) {
    showError('中枢桥接尚未就绪，请稍等。');
    return;
  }
  const previousSess = state.sessions.get(state.activeId) || null;
  // Don't mark previousSess as busy - it's not doing anything
  // Just show status text without changing any tab dot
  const statusEl = $('status');
  if (statusEl) statusEl.textContent = '正在创建对话…';
  let createdSess = null;
  try {
    const cwd = await getCwd();
    const res = await window.penglai.rpc('session/new', { cwd, mcp_servers: [] });
    if (res.error) throw new Error(typeof res.error === 'string' ? res.error : (res.error.message || JSON.stringify(res.error)));
    const bridgeSessionId = res.sessionId;
    const localSessionId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    createdSess = createLocalSession(localSessionId, '新对话', bridgeSessionId);
    createdSess.cwd = cwd;
    setActiveSession(localSessionId);
  } catch (e) {
    showError('创建对话失败：' + e.message);
  } finally {
    setBusy(false, null, createdSess || previousSess);
  }
}

async function getCwd() {
  // Use Penglai root as default cwd
  const status = await window.penglai.checkStatus();
  return status.penglaiRoot || status.gaRoot;
}

// ─── Messages rendering ──────────────────────────────────────────────────
// DOM cache: sessionId -> { fragment, scrollTop }
const _domCache = new Map();

function renderMessages() {
  const sess = state.sessions.get(state.activeId);
  const runtime = sess ? getSessionRuntime(sess) : null;

  // Save current DOM + scroll to cache for previous session
  if (state._prevRenderedId && state._prevRenderedId !== state.activeId) {
    const frag = document.createDocumentFragment();
    while (messagesEl.firstChild) frag.appendChild(messagesEl.firstChild);
    _domCache.set(state._prevRenderedId, {
      fragment: frag,
      scrollTop: runtime ? (state.runtimeBySessionId.get(state._prevRenderedId)?.scrollPos ?? 0) : 0,
    });
  }

  if (runtime) {
    runtime.currentTurnEl = null;
    runtime.lastMessageType = null;
  }

  const hasSavedMessages = !!sess && sess.messages.length > 0;
  const hasDraft = !!runtime?.assistantDraft && !runtime.assistantDraft.finalized;
  if (!sess || (!hasSavedMessages && !hasDraft)) {
    messagesEl.innerHTML = '';
    messagesEl.classList.add('empty');
    messagesEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">新任务</div>
        <div class="empty-sub">直接输入任务，或输入 <code>/help</code> 查看命令。</div>
      </div>`;
    state._prevRenderedId = state.activeId;
    updateSpeechButton();
    return;
  }

  messagesEl.classList.remove('empty');

  // Try to restore from cache
  const cached = _domCache.get(state.activeId);
  if (cached) {
    messagesEl.innerHTML = '';
    messagesEl.appendChild(cached.fragment);
    _domCache.delete(state.activeId);
    // If there's a live draft, the cached DOM is stale — re-render the draft portion
    if (hasDraft) {
      // Remove the stale assistant wrap (last unfinalized msg-assistant element)
      const last = messagesEl.lastElementChild;
      if (last?.classList?.contains('msg-assistant') && last.dataset.finalized !== '1') {
        last.remove();
      }
      renderAssistantDraft(sess, runtime.assistantDraft);
    }
    messagesEl.scrollTop = cached.scrollTop;
  } else {
    messagesEl.innerHTML = '';
    for (const m of sess.messages) renderMessage(m, false);
    if (hasDraft) renderAssistantDraft(sess, runtime.assistantDraft);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  state._prevRenderedId = state.activeId;
  updateSpeechButton();
}

function prepareMessagesForContent() {
  if (messagesEl.classList.contains('empty')) messagesEl.innerHTML = '';
  messagesEl.classList.remove('empty');
}

function renderMessage(msg, append = true) {
  prepareMessagesForContent();

  if (msg.role === 'user') {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-user';
    let imagesHtml = '';
    const ids = msg.image_ids || [];
    if (ids.length > 0) {
      imagesHtml = '<div class="user-images">' + ids.map(id => {
        const dataUrl = sessionStorage.getItem('img:' + id);
        if (dataUrl) {
          return `<img src="${dataUrl}" class="user-msg-thumb" />`;
        }
        return `<span class="user-msg-thumb-placeholder" title="图片已过期">🖼</span>`;
      }).join('') + '</div>';
    }
    wrap.innerHTML = `<div class="bubble">${imagesHtml}${escapeHtml(msg.content)}</div>`;
    messagesEl.appendChild(wrap);
    const sess = state.sessions.get(state.activeId);
    const runtime = sess ? getSessionRuntime(sess) : null;
    if (runtime) {
      runtime.currentTurnEl = null; // reset turn grouping on user message
      runtime.lastMessageType = 'user';
    }
  } else if (msg.role === 'system') {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-system';
    wrap.textContent = msg.content;
    messagesEl.appendChild(wrap);
  } else if (msg.role === 'error') {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-error';
    wrap.textContent = msg.content;
    messagesEl.appendChild(wrap);
    const sess = state.sessions.get(state.activeId);
    const runtime = sess ? getSessionRuntime(sess) : null;
    if (runtime) runtime.currentTurnEl = null;
  } else if (msg.role === 'assistant') {
    // Final full message (when reloading from state)
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-assistant';
    if (msg.segments) {
      ensureAssistantTaskElapsed(wrap, msg.taskStartedAt, msg.taskEndedAt);
      for (const seg of msg.segments) {
        wrap.appendChild(buildTurn(seg.kind, seg.text, seg.collapsed, nextTurnIndexForWrap(wrap)));
      }
    } else {
      const body = document.createElement('div');
      body.className = 'assistant-response md';
      ensureAssistantTaskElapsed(wrap, msg.taskStartedAt, msg.taskEndedAt);
      const cleanContent = (msg.content || '').replace(/\n*`{5}\n*\[Info\] Final response to user\.\n*`{5}\s*$/, '');
      renderStructuredMarkdownInto(body, cleanContent);
      if (msg.permission) renderPermissionActionsInto(body, msg.permission);
      injectCopyButtons(body);
      wrap.appendChild(body);
    }
    injectCopyButtons(wrap);
    messagesEl.appendChild(wrap);
  }
  if (append) scrollToBottom();
  updateSpeechButton();
}

function renderPermissionActionsInto(container, permission) {
  if (!container || !permission) return;
  const options = Array.isArray(permission.options) ? permission.options : [];
  if (!options.length && !permission.allow_free_text) return;
  const box = document.createElement('div');
  box.className = 'permission-actions';
  box.dataset.requestId = permission.request_id || '';
  if (options.length) {
    for (const option of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'permission-choice-btn';
      btn.textContent = option.label || option.value || `选项 ${option.index || ''}`.trim();
      btn.title = '发送此确认选择';
      btn.addEventListener('click', () => {
        const sess = state.sessions.get(state.activeId);
        const runtime = sess ? getSessionRuntime(sess) : null;
        if (runtime?.busy) {
          showSystem('蓬莱仍在处理上一条消息，请稍后再选择。');
          return;
        }
        sendPrompt(option.label || option.value || '');
      });
      box.appendChild(btn);
    }
  }
  if (permission.allow_free_text) {
    const hint = document.createElement('div');
    hint.className = 'permission-free-text';
    hint.textContent = '也可以直接在输入框回复。';
    box.appendChild(hint);
  }
  container.appendChild(box);
}

function buildTurn(kind, text, collapsed, index) {
  const turn = document.createElement('div');
  turn.className = 'turn' + (collapsed ? ' collapsed' : '');
  turn.dataset.kind = kind;
  const turnIndex = Number(index || 0);
  const label = turnIndex ? turnHeaderLabel(turnIndex, kind) : kind;
  const summary = summarizeStructuredBlock(kind, text);
  const header = document.createElement('div');
  header.className = 'turn-header';
  header.innerHTML = `<span class="turn-caret">▼</span><span class="turn-tag">${escapeHtml(label)}</span><span class="turn-summary">${escapeHtml(summary)}</span>`;
  header.addEventListener('click', () => turn.classList.toggle('collapsed'));
  const body = document.createElement('div');
  body.className = 'turn-body md';
  const hasToolDetail = Boolean(parseToolDetails(kind, text));
  renderToolDetailInto(body, { kind, text });
  if (!hasToolDetail) {
    const rendered = document.createElement('div');
    rendered.className = 'turn-rendered-md';
    rendered.innerHTML = renderMarkdown(text);
    body.appendChild(rendered);
  }
  turn.appendChild(header);
  turn.appendChild(body);
  injectCopyButtons(body);
  return turn;
}

function isNearBottom(threshold = 150) {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
}

function scrollToBottom(smooth = true) {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

// ─── Streaming chunks (from ACP bridge notifications) ────────────────────
// ACP sends method='session/update' with params.update.sessionUpdate=
//   agent_message_chunk | agent_thought_chunk | tool_call | tool_call_update | plan | available_commands_update
function handleNotification(msg) {
  // Handle WS session-state notifications from the bridge backend.
  // These have {type: "session-state", sessionId, state, status, seq, ...}
  // and are used to kick-start polling for sessions that became active
  // (e.g. after page reload, or when a background session starts running).
  if (msg.type === 'session-state') {
    const sess = findSessionByBridgeId(msg.sessionId);
    if (!sess) return;
    const runtime = getSessionRuntime(sess);
    if ((msg.state === 'running' || msg.status === 'running') && !runtime.polling) {
      runtime.busy = true;
      runtime.forcePollOnce = true;
      setBusy(true, '思考中…', sess);
      pollSessionMessages(sess);
    } else if (msg.state === 'idle' || msg.state === 'error' || msg.status === 'idle') {
      // Session finished in background — do a final poll to pick up remaining messages
      if (!runtime.polling && runtime.busy) {
        runtime.forcePollOnce = true;
        pollSessionMessages(sess);
      }
    }
    // Update tab dot regardless
    renderSessionList();
    return;
  }
  if (msg.method !== 'session/update') return;
  const update = msg.params?.update;
  if (!update) return;
  const kind = update.sessionUpdate;
  const bridgeSessionId = msg.params?.sessionId || update.sessionId || update.session?.id;
  const sess = findSessionByBridgeId(bridgeSessionId);
  if (!sess) return;


  if (kind === 'agent_message_chunk') {
    const text = extractText(update.content);
    appendAssistantChunk(sess, text);
  } else if (kind === 'task_started') {
    hideError();
    startTaskTimer(sess);
    setBusy(true, '思考中…', sess);
  } else if (kind === 'task_completed' || kind === 'cancelled') {
    finalizeAssistantReply(sess);
    setBusy(false, null, sess);
    hideError();
  } else if (kind === 'error') {
    finalizeAssistantReply(sess);
    setBusy(false, null, sess);
    const errText = update.message || update.error || '中枢桥接错误';
    sess.messages.push({ role: 'error', content: errText });
    if (isActiveSession(sess)) renderMessage({ role: 'error', content: errText });
    showError(errText);
  } else if (kind === 'agent_thought_chunk') {
    const text = extractText(update.content);
    appendStreamChunk(sess, kind, text);
  } else if (kind === 'tool_call') {
    const toolName = update.title || update.name || update.kind || update.toolCallId || 'tool';
    const args = update.arguments || update.args || update.input || update.content || '';
    const argText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    const text = `<function_calls>
<invoke name="${escapeHtml(toolName)}">
<parameter name="args">${escapeHtml(argText)}</parameter>
</invoke>
</function_calls>`;
    appendTurn(sess, 'TOOL_CALL', text, true);
  } else if (kind === 'tool_call_update') {
    // Status updates, keep simple
    if (update.status && update.status !== 'in_progress') {
      appendTurn(sess, 'tool', `[${update.status}] ${update.toolCallId || ''}`, true);
    }
  } else if (kind === 'plan') {
    const lines = (update.entries || []).map(e =>
      `- [${e.status || 'pending'}] ${e.content || ''}`
    ).join('\n');
    appendTurn(sess, 'plan', lines, false);
  }
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (content.type === 'text') return content.text || '';
  if (Array.isArray(content)) return content.map(extractText).join('');
  return '';
}

function getLiveAssistantWrap(sess) {
  if (!isActiveSession(sess)) return null;
  const last = messagesEl.lastElementChild;
  if (last?.classList?.contains('msg-assistant') && last.dataset.finalized !== '1') return last;
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  const runtime = getSessionRuntime(sess);
  if (runtime.taskStartedAt) {
    wrap.dataset.taskStartedAt = String(runtime.taskStartedAt);
    ensureAssistantTaskElapsed(wrap, runtime.taskStartedAt);
  }
  messagesEl.appendChild(wrap);
  return wrap;
}

function getAssistantDraft(sess) {
  const runtime = getSessionRuntime(sess);
  if (!runtime.assistantDraft || runtime.assistantDraft.finalized) {
    runtime.assistantDraft = {
      text: '',
      segments: [],
      currentSegmentIndex: -1,
      taskStartedAt: runtime.taskStartedAt || 0,
      taskEndedAt: 0,
      finalized: false,
      bridgeMessageId: 0
    };
  }
  if (!runtime.assistantDraft.taskStartedAt && runtime.taskStartedAt) runtime.assistantDraft.taskStartedAt = runtime.taskStartedAt;
  return runtime.assistantDraft;
}

function renderAssistantDraft(sess, draft) {
  if (!isActiveSession(sess) || !draft || draft.finalized) return null;
  prepareMessagesForContent();
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  if (draft.taskStartedAt) {
    wrap.dataset.taskStartedAt = String(draft.taskStartedAt);
    ensureAssistantTaskElapsed(wrap, draft.taskStartedAt, draft.taskEndedAt);
  }
  if (draft.text) {
    wrap.dataset.buf = draft.text;
    const body = document.createElement('div');
    body.className = 'assistant-response md';
    renderStructuredMarkdownInto(body, draft.text);
    injectCopyButtons(body);
    if (!draft.finalized) body.insertAdjacentHTML('beforeend', '<span class="cursor"></span>');
    wrap.appendChild(body);
  }
  for (const seg of draft.segments || []) {
    wrap.appendChild(buildTurn(seg.kind, seg.text, seg.collapsed, nextTurnIndexForWrap(wrap)));
  }
  injectCopyButtons(wrap);
  messagesEl.appendChild(wrap);
  return wrap;
}

function renderAssistantDraftInPlace(sess, draft) {
  if (!isActiveSession(sess) || !draft || draft.finalized) return null;
  prepareMessagesForContent();
  const runtime = getSessionRuntime(sess);
  const wrap = getLiveAssistantWrap(sess);
  if (draft.taskStartedAt || runtime.taskStartedAt) {
    const startedAt = draft.taskStartedAt || runtime.taskStartedAt;
    wrap.dataset.taskStartedAt = String(startedAt);
    ensureAssistantTaskElapsed(wrap, startedAt, draft.taskEndedAt);
  }
  wrap.dataset.buf = draft.text || '';
  let body = wrap.querySelector('.assistant-response');
  if (!body) {
    body = document.createElement('div');
    body.className = 'assistant-response md';
    // Keep plain assistant text before folded/tool turns.
    const firstTurn = wrap.querySelector('.turn');
    if (firstTurn) wrap.insertBefore(body, firstTurn);
    else wrap.appendChild(body);
  }
  renderStructuredMarkdownInto(body, draft.text || '');
  injectCopyButtons(body);
  body.insertAdjacentHTML('beforeend', '<span class="cursor"></span>');
  if (isNearBottom()) scrollToBottom(false);
  return wrap;
}

function appendAssistantChunk(sess, text) {
  if (!text) return;
  const runtime = getSessionRuntime(sess);
  const draft = getAssistantDraft(sess);
  draft.text += text;
  draft.currentSegmentIndex = -1;
  runtime.currentTurnEl = null;
  if (!isActiveSession(sess)) return;
  prepareMessagesForContent();
  let wrap = getLiveAssistantWrap(sess);
  let body = wrap.querySelector('.assistant-response');
  if (!body) {
    body = document.createElement('div');
    body.className = 'assistant-response md';
    wrap.appendChild(body);
  }
  wrap.dataset.buf = draft.text;
  ensureAssistantTaskElapsed(wrap, draft.taskStartedAt || runtime.taskStartedAt);
  renderStructuredMarkdownInto(body, draft.text);
  body.insertAdjacentHTML('beforeend', '<span class="cursor"></span>');
  if (isNearBottom()) scrollToBottom(false);
}

function appendStreamChunk(sess, kind, text) {
  if (!text) return;
  // Group consecutive chunks of same kind into one turn (fold_turns style)
  const runtime = getSessionRuntime(sess);
  const draft = getAssistantDraft(sess);
  let seg = draft.segments[draft.currentSegmentIndex];
  if (!seg || seg.kind !== kind) {
    seg = { kind, text: '', collapsed: false };
    draft.segments.push(seg);
    draft.currentSegmentIndex = draft.segments.length - 1;
    runtime.currentTurnEl = null;
  }
  seg.text += text;
  if (!isActiveSession(sess)) return;
  let turn = runtime.currentTurnEl;
  const currentKind = turn?.dataset.kind;
  if (!turn || currentKind !== kind) {
    turn = createStreamingTurn(sess, kind);
    runtime.currentTurnEl = turn;
  }
  turn.dataset.buf = seg.text;
  const body = turn.querySelector('.turn-body');
  const { summary, remaining: cleanText } = stripLeadingMetaTags(seg.text);
  // Update the header turn-summary span (visible when collapsed)
  const summarySpan = turn.querySelector('.turn-summary');
  if (summarySpan && summary) {
    summarySpan.textContent = summary;
  }
  // Only render the clean body text (no summary-hint in body)
  body.innerHTML = renderMarkdown(cleanText) + '<span class="cursor"></span>';
  if (isNearBottom()) scrollToBottom(false);
}

function appendTurn(sess, kind, text, collapsed) {
  const draft = getAssistantDraft(sess);
  draft.segments.push({ kind, text, collapsed: !!collapsed });
  draft.currentSegmentIndex = -1;
  if (!isActiveSession(sess)) return;
  prepareMessagesForContent();
  const wrap = getLiveAssistantWrap(sess);
  wrap.appendChild(buildTurn(kind, text, collapsed, nextTurnIndexForWrap(wrap)));
  if (isNearBottom()) scrollToBottom(false);
}

function createStreamingTurn(sess, kind) {
  prepareMessagesForContent();
  const wrap = getLiveAssistantWrap(sess);
  const turn = document.createElement('div');
  turn.className = 'turn';
  turn.dataset.kind = kind;
  const displayKind = kind === 'agent_thought_chunk' ? 'thinking' : 'response';
  const turnIndex = nextTurnIndexForWrap(wrap);
  turn.innerHTML = `
    <div class="turn-header"><span class="turn-caret">▼</span><span class="turn-tag">${escapeHtml(turnHeaderLabel(turnIndex, displayKind))}</span><span class="turn-summary"></span></div>
    <div class="turn-body md"></div>`;
  turn.querySelector('.turn-header').addEventListener('click', () => turn.classList.toggle('collapsed'));
  // thinking turns collapsed by default once complete
  if (kind === 'agent_thought_chunk') turn.dataset.autoCollapse = '1';
  wrap.appendChild(turn);
  return turn;
}

function getCurrentAssistantWrap(sess) {
  if (!isActiveSession(sess)) return null;
  const last = messagesEl.lastElementChild;
  if (last?.classList?.contains('msg-assistant') && last.dataset.finalized !== '1') return last;
  return null;
}

function finalizeStreamingTurn(sess) {
  const runtime = getSessionRuntime(sess);
  const wrap = getCurrentAssistantWrap(sess);
  const liveAssistant = wrap?.querySelector('.assistant-response');
  if (liveAssistant) {
    renderStructuredMarkdownInto(liveAssistant, wrap.dataset.buf || '');
    injectCopyButtons(liveAssistant);
  }
  if (runtime.assistantDraft?.segments?.length) {
    for (const seg of runtime.assistantDraft.segments) {
      if (seg.kind === 'agent_thought_chunk') seg.collapsed = true;
    }
  }
  if (!runtime.currentTurnEl) return;
  const t = runtime.currentTurnEl;
  const body = t.querySelector('.turn-body');
  // Remove cursor, strip summary/think tags; set turn-summary in header
  if (body) {
    const { summary: extractedSummary, remaining: cleanBuf } = stripLeadingMetaTags(t.dataset.buf || '');
    body.innerHTML = renderMarkdown(cleanBuf);
    // Set the turn-summary span in the header for collapsed display
    const summaryEl = t.querySelector('.turn-summary');
    if (summaryEl) {
      const kind = t.dataset.kind || 'response';
      summaryEl.textContent = extractedSummary || summarizeStructuredBlock(kind, cleanBuf);
    }
  }
  if (t.dataset.autoCollapse === '1') t.classList.add('collapsed');
  const idx = runtime.assistantDraft?.currentSegmentIndex;
  if (Number.isInteger(idx) && runtime.assistantDraft?.segments?.[idx]) {
    runtime.assistantDraft.segments[idx].collapsed = t.classList.contains('collapsed');
  }
  runtime.currentTurnEl = null;
}

function finalizeAssistantReply(sess) {
  const endedAt = getNowMs();
  finalizeStreamingTurn(sess);
  // Remove any residual blinking cursors (e.g. after RPC timeout)
  messagesEl.querySelectorAll('.cursor').forEach(el => el.remove());
  const runtime = getSessionRuntime(sess);
  const draft = runtime.assistantDraft;
  const wrap = getCurrentAssistantWrap(sess);
  if (draft && sess && !draft.finalized) {
    draft.finalized = true;
    draft.taskEndedAt = endedAt;
    // Strip trailing [Info] Final response to user. marker (wrapped in 5 backticks)
    if (draft.text) {
      draft.text = draft.text.replace(/\n*`{5}\n*\[Info\] Final response to user\.\n*`{5}\s*$/, '');
    }
    if (draft.segments?.length) {
      const last = draft.segments[draft.segments.length - 1];
      if (last && last.text) {
        last.text = last.text.replace(/\n*`{5}\n*\[Info\] Final response to user\.\n*`{5}\s*$/, '');
      }
    }
    const msg = { role: 'assistant', finalized: true, taskEndedAt: endedAt };
    if (draft.bridgeMessageId) msg.id = Number(draft.bridgeMessageId);
    if (draft.taskStartedAt) msg.taskStartedAt = Number(draft.taskStartedAt);
    if (draft.text) msg.content = draft.text;
    if (draft.segments?.length) msg.segments = draft.segments.map((seg) => ({
      kind: seg.kind,
      text: seg.text || '',
      collapsed: !!seg.collapsed
    }));
    if (msg.content || msg.segments?.length) sess.messages.push(msg);
    runtime.assistantDraft = null;
  }
  if (wrap) {
    wrap.dataset.finalized = '1';
    wrap.dataset.taskEndedAt = String(endedAt);
    ensureAssistantTaskElapsed(wrap, wrap.dataset.taskStartedAt || runtime.taskStartedAt || draft?.taskStartedAt, endedAt);
    renderMessages();
  } else if (!isActiveSession(sess)) {
    // Session finished in background — its DOM cache is stale, discard it
    // so that switching to it will do a full re-render from sess.messages
    _domCache.delete(sess.id);
  }
  stopTaskTimer(sess);
}

// ─── Sending prompts ─────────────────────────────────────────────────────
function normalizeBridgeMessage(msg) {
  return {
    id: Number(msg.id || 0),
    role: msg.role || 'system',
    content: msg.content || '',
    image_ids: msg.image_ids || [],
    permission: msg.permission || null
  };
}

function upsertPolledMessage(sess, raw, { partial = false } = {}) {
  if (!sess || !raw) return;
  const msg = normalizeBridgeMessage(raw);
  if (!msg.id) return;
  const runtime = getSessionRuntime(sess);
  if (!runtime.seenBridgeMessageIds) runtime.seenBridgeMessageIds = new Set();

  if (partial && msg.role === 'assistant') {
    const draft = getAssistantDraft(sess);
    const changed = draft.bridgeMessageId !== msg.id || draft.text !== (msg.content || '');
    draft.bridgeMessageId = msg.id;
    draft.text = msg.content || '';
    draft.currentSegmentIndex = -1;
    draft.finalized = false;
    // Polling partial updates used to call renderMessages(), which rebuilt the
    // whole message list every 500ms. That destroys user fold/collapse DOM
    // state and can make the live answer appear to jump/duplicate. Update only
    // the live assistant draft in-place; final messages are still reconciled by
    // id in the non-partial branch below.
    if (changed && isActiveSession(sess)) renderAssistantDraftInPlace(sess, draft);
    return;
  }

  if (runtime.seenBridgeMessageIds.has(msg.id)) return;
  runtime.seenBridgeMessageIds.add(msg.id);
  runtime.lastPolledMessageId = Math.max(Number(runtime.lastPolledMessageId || 0), msg.id);

  const draft = runtime.assistantDraft;
  if (msg.role === 'assistant' && draft && !draft.finalized && Number(draft.bridgeMessageId || 0) === msg.id) {
    draft.text = msg.content || draft.text || '';
    finalizeAssistantReply(sess);
    return;
  }
  sess.messages.push(msg);
  if (isActiveSession(sess)) renderMessage(msg);
}

async function pollSessionMessages(sess) {
  if (!sess) return;
  const runtime = getSessionRuntime(sess);
  if (runtime.polling) return;
  runtime.polling = true;
  try {
    while (runtime.busy || runtime.forcePollOnce) {
      runtime.forcePollOnce = false;
      const res = await window.penglai.pollSession(sess.bridgeSessionId || sess.id, runtime.lastPolledMessageId || 0);
      if (res?.error) throw new Error(res.error.message || res.error);
      const result = res.result || res;
      for (const msg of (result.messages || [])) upsertPolledMessage(sess, msg, { partial: false });
      if (result.partial) upsertPolledMessage(sess, result.partial, { partial: true });
      const busy = result.status === 'running' || !!result.partial;
      setBusy(busy, busy ? '思考中…' : null, sess);
      if (!busy) {
        finalizeAssistantReply(sess);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (e) {
    addDiagnostic('error', '轮询失败', e);
    showError('轮询失败：' + (e.message || e));
    setBusy(false, null, sess);
  } finally {
    runtime.polling = false;
  }
}

async function sendPrompt(text, images = []) {
  if (!state.bridgeReady) {
    showError('中枢桥接尚未就绪。');
    return;
  }
  if (!state.activeId) {
    await newSession();
    if (!state.activeId) return;
  }
  const sess = state.sessions.get(state.activeId);
  const runtime = getSessionRuntime(sess);
  if (runtime.busy) return;

  // Store images in sessionStorage and collect ids
  const imageIds = images.map(img => {
    try { sessionStorage.setItem('img:' + img.id, img.dataUrl); } catch(e) { /* quota */ }
    return img.id;
  });

  const localUserMsg = { role: 'user', content: text, image_ids: imageIds };
  sess.messages.push(localUserMsg);
  renderMessage(localUserMsg);
  startTaskTimer(sess);
  if (sess.untitled || isUntitledSessionTitle(sess.title)) {
    sess.title = text.trim().slice(0, 40) + (text.trim().length > 40 ? '…' : '');
    sess.untitled = false;
    sessionTitleEl.textContent = sess.title;
    renderSessionList();
  }

  setBusy(true, '思考中…', sess);
  try {
    const res = await window.penglai.rpc('session/prompt', {
      sessionId: await ensureBridgeSession(sess),
      prompt: text,
      images: images.map(img => ({id: img.id, dataUrl: img.dataUrl})),
      llmNo: sess.config.llmNo
    });
    if (res?.error) throw new Error(res.error.message || res.error);
    const acceptedUserId = Number(res.userMessageId || res.result?.userMessageId || 0);
    if (acceptedUserId) {
      if (!runtime.seenBridgeMessageIds) runtime.seenBridgeMessageIds = new Set();
      runtime.seenBridgeMessageIds.add(acceptedUserId);
      runtime.lastPolledMessageId = Math.max(Number(runtime.lastPolledMessageId || 0), acceptedUserId);
    }
    runtime.forcePollOnce = true;
    pollSessionMessages(sess);
  } catch (e) {
    sess.messages.push({ role: 'error', content: e.message || String(e) });
    if (isActiveSession(sess)) renderMessage({ role: 'error', content: e.message || String(e) });
    setBusy(false, null, sess);
  }
}

async function cancelPrompt() {
  const sess = state.sessions.get(state.activeId);
  const runtime = sess ? getSessionRuntime(sess) : null;
  if (!runtime?.busy) return false;
  try {
    const res = await window.penglai.rpc('session/cancel', { sessionId: sess?.bridgeSessionId || state.activeId });
    if (res.error) throw new Error(res.error.message || res.error);
    setBusy(false, null, sess);  // clear busy immediately; don't wait for server-side cancelled event
    return true;
  } catch (e) {
    showSystem('停止失败：' + (e.message || e));
    return false;
  }
}

// ─── Slash commands ──────────────────────────────────────────────────────
async function handleSlash(cmd) {
  const [name, ...rest] = cmd.trim().slice(1).split(/\s+/);
  const arg = rest.join(' ');
  const sess = state.sessions.get(state.activeId);

  switch (name) {
    case 'help':
      showSystem([
        '可用命令：',
        '  /new        新建对话',
        '  /clear      清空当前对话显示',
        '  /stop       取消当前请求',
        '  /theme      切换主题（light|dark|auto）',
      ].join('\n'));
      break;
    case 'new':
      await newSession();
      break;
    case 'clear':
      if (sess) { sess.messages = []; renderMessages(); }
      break;
    case 'stop':
      if (await cancelPrompt()) showSystem('已请求停止。');
      break;
    case 'restart':
      await restartBridge();
      break;
    case 'settings':
      openSettings();
      break;
    case 'theme':
      if (['light', 'dark', 'auto'].includes(arg)) {
        const cfg = getActiveConfig();
        cfg.theme = arg;
        applyTheme();
        await window.penglai.saveConfig(cfg);
        showSystem(`主题 → ${arg}`);
      } else {
        showSystem('用法：/theme light|dark|auto');
      }
      break;
    case 'cwd':
      if (!arg) {
        const status = await window.penglai.checkStatus();
        showSystem(`cwd: ${sess?.cwd || status.penglaiRoot || status.gaRoot}`);
      } else {
        showSystem(`正在 ${arg} 中创建新对话…`);
        // Need a new session for different cwd
        const res = await window.penglai.rpc('session/new', { cwd: arg, mcp_servers: [] });
        if (res.error) showSystem('失败：' + (res.error.message || res.error));
        else {
          const bridgeSessionId = res.sessionId;
          const localSessionId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const ns = createLocalSession(localSessionId, arg.split('/').pop() || arg, bridgeSessionId);
          ns.cwd = arg;
          setActiveSession(localSessionId);
        }
      }
      break;
    default:
      showSystem(`未知命令：/${name}。可输入 /help 查看帮助。`);
  }
}

function showSystem(text) {
  const msg = { role: 'system', content: text };
  const sess = state.sessions.get(state.activeId);
  if (sess) sess.messages.push(msg);
  renderMessage(msg);
  return msg;
}

function assistantSpeechText(msg) {
  if (!msg || msg.role !== 'assistant' || msg.permission) return '';
  if (typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim();
  const segments = Array.isArray(msg.segments) ? msg.segments : [];
  const primary = segments
    .filter((seg) => !seg.kind || String(seg.kind).toLowerCase() === 'agent_message_chunk')
    .map((seg) => String(seg.text || '').trim())
    .filter(Boolean);
  const parts = primary.length ? primary : segments.map((seg) => String(seg.text || '').trim()).filter(Boolean);
  return parts.join('\n\n').trim();
}

function getLastAssistantSpeechText() {
  const sess = state.sessions.get(state.activeId);
  if (!sess) return '';
  for (let i = sess.messages.length - 1; i >= 0; i -= 1) {
    const text = assistantSpeechText(sess.messages[i]);
    if (text) return text;
  }
  return '';
}

function updateSpeechButton() {
  if (!speakLastBtn) return;
  const hasText = !!getLastAssistantSpeechText();
  speakLastBtn.disabled = !state.bridgeReady || state.speechBusy || !hasText;
  speakLastBtn.classList.toggle('active', state.speechBusy);
  speakLastBtn.title = state.speechBusy ? '正在生成语音…' : '朗读最近回复';
}

async function speakLastAssistant() {
  if (!speakLastBtn || state.speechBusy) return;
  const text = getLastAssistantSpeechText();
  if (!text) {
    showError('当前对话还没有可朗读的回复。');
    return;
  }
  if (!window.penglai?.synthesizeSpeech) {
    showError('桌面语音桥接不可用。');
    return;
  }
  try {
    if (state.speechAudio && !state.speechAudio.paused) state.speechAudio.pause();
    state.speechBusy = true;
    updateSpeechButton();
    const result = await window.penglai.synthesizeSpeech(text.slice(0, 1200));
    if (!result?.ok) throw new Error(result?.error || '语音合成失败');
    const url = result.audioUrl || result.audio?.url;
    if (!url) throw new Error('语音合成没有返回音频地址');
    const audio = new Audio(url);
    state.speechAudio = audio;
    audio.addEventListener('error', () => showError('语音播放失败。'));
    await audio.play();
    addDiagnostic('info', '已播放最近回复语音', result.audio || result);
  } catch (err) {
    addDiagnostic('error', '朗读最近回复失败', err);
    showError('朗读失败：' + (err.message || err), null, null, { skipDiagnostic: true });
  } finally {
    state.speechBusy = false;
    updateSpeechButton();
  }
}

function updateBridgeNotice(text) {
  const notice = state.bridgeNoticeMessage;
  state.bridgeNoticeMessage = null;
  if (!notice) return;
  notice.content = text;
  const sess = state.sessions.get(state.activeId);
  if (sess && sess.messages.includes(notice)) renderMessages();
}

// ─── Status / UI helpers ─────────────────────────────────────────────────
function setStatus(kind, text) {
  statusBadge.className = 'badge ' + kind;
  statusText.textContent = text;
  // Update per-tab dot for active session
  updateTabDot(state.activeId, kind);
}

function updateTabDot(sessionId, kind) {
  if (!sessionId) return;
  const tab = sessionListEl.querySelector(`[data-session-id="${sessionId}"]`);
  if (!tab) return;
  const dot = tab.querySelector('.tab-dot');
  if (!dot) return;
  dot.className = 'tab-dot';
  if (kind === 'busy') dot.classList.add('busy');
  else if (kind === 'warn') dot.classList.add('warn');
  else if (kind === 'err') dot.classList.add('err');
  // 'ok' = default green (no extra class needed)
}

const SEND_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;

function setBusy(busy, label, sess = state.sessions.get(state.activeId)) {
  const runtime = sess ? getSessionRuntime(sess) : null;
  if (runtime) runtime.busy = busy;
  // Always update per-tab dot for this session
  if (sess) {
    const dotKind = busy ? 'busy' : (state.bridgeReady ? 'ok' : 'warn');
    updateTabDot(sess.id, dotKind);
  }
  if (!isActiveSession(sess)) return;
  if (busy) setStatus('busy', label || '处理中…');
  else setStatus(state.bridgeReady ? 'ok' : 'warn', state.bridgeReady ? '就绪' : '启动中…');
  renderSendButtonState();
  updateSpeechButton();
}

function renderSendButtonState() {
  const hasText = inputEl.value.trim().length > 0;
  const busy = !!getActiveSessionRuntime()?.busy;
  sendBtn.classList.toggle('stop', busy);
  sendBtn.title = busy ? '停止（Esc）' : '发送（Enter）';
  sendBtn.innerHTML = busy ? STOP_ICON : SEND_ICON;
  sendBtn.disabled = !hasText && !busy;
}

function updateSendButton() {
  renderSendButtonState();
}

function showError(text, actionLabel, actionFn, options = {}) {
  if (!options.skipDiagnostic) addDiagnostic('error', text);
  $('error-text').textContent = text;
  const actionBtn = $('error-action');
  if (actionLabel && actionFn) {
    actionBtn.textContent = actionLabel;
    actionBtn.classList.remove('hidden');
    actionBtn.onclick = async () => {
      try {
        await actionFn();
      } catch (err) {
        showError('操作失败：' + (err.message || err));
      }
    };
  } else {
    actionBtn.classList.add('hidden');
  }
  errorBanner.classList.remove('hidden');
  clearTimeout(showError._t);
  if (!actionLabel) {
    showError._t = setTimeout(() => errorBanner.classList.add('hidden'), 6000);
  }
}
function hideError() { errorBanner.classList.add('hidden'); }

// ─── Theme ───────────────────────────────────────────────────────────────
function applyTheme() {
  const cfg = getActiveConfig();
  document.documentElement.setAttribute('data-theme', cfg.theme || 'auto');
}

// ─── Settings modal ──────────────────────────────────────────────────────
function renderModelOptions() {
  const select = $('cfg-llm');
  const selected = String(getActiveConfig().llmNo || 0);
  const profiles = Array.isArray(state.modelProfiles) ? state.modelProfiles : [];
  const options = profiles.length ? profiles : [{ llmNo: 0, name: '默认 / 自动' }];
  select.textContent = '';
  for (const profile of options) {
    const opt = document.createElement('option');
    opt.value = String(profile.llmNo);
    // Display as "name/model" when both fields available
    const displayName = profile.name && profile.model
      ? `${profile.name}/${profile.model}`
      : profile.name || profile.model || `模型 ${profile.llmNo}`;
    opt.textContent = displayName;
    select.appendChild(opt);
  }
  if (![...select.options].some((opt) => opt.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = selected === '0' ? '默认 / 自动' : `模型 ${selected}`;
    select.appendChild(opt);
  }
  select.value = selected;
}

async function loadModelProfiles() {
  try {
    const result = await window.penglai.getModelProfiles();
    state.modelProfiles = Array.isArray(result && result.profiles) ? result.profiles : [];
    renderModelOptions();
  } catch (err) {
    addDiagnostic('warn', '加载模型名称失败', err);
    renderModelOptions();
  }
}

function openSettings() {
  renderModelOptions();
  const cfg = getActiveConfig();
  $('cfg-llm').value = String(cfg.llmNo || 0);
  settingsModal.classList.remove('hidden');
  loadModelProfiles();
  refreshOpsPanel({ silent: true });
}
function closeSettings() { settingsModal.classList.add('hidden'); }

function opsStatusClass(value) {
  if (value === true || value === 'active' || value === 'ok') return 'ok';
  if (value === false || value === 'failed' || value === 'privacy_blocker') return 'err';
  return 'warn';
}

function opsStatusText(value, okText = '正常', badText = '阻断') {
  if (value === true) return okText;
  if (value === false) return badText;
  if (value == null || value === '') return '-';
  if (value === 'active') return '运行中';
  if (value === 'inactive') return '未运行';
  if (value === 'pending') return '排队中';
  if (value === 'queued') return '排队中';
  if (value === 'running') return '运行中';
  if (value === 'waiting_permission') return '等待确认';
  if (value === 'succeeded') return '已完成';
  if (value === 'cancelled') return '已停止';
  if (value === 'failed') return '失败';
  if (value === 'ok') return '正常';
  if (value === 'privacy_blocker') return '隐私阻断';
  return String(value);
}

const OPS_COMMAND_LABELS = {
  doctor: '体检',
  selfcheck: '自检',
  'install-check': '安装预检',
  'update-check': '检查更新',
  'runtime-audit': '旧入口审计',
  'privacy-audit': '隐私审计',
  'runtime-service-status': '服务状态',
  'runtime-service-install': '启动中枢服务',
  'runtime-service-uninstall': '停止中枢服务',
};

const OPS_LOG_CHANNEL_LABELS = {
  feishu: '飞书',
  runtime: '中枢',
  wechat: '微信',
  scheduler: '调度器',
  companion: '陪伴端',
};

function opsCommandLabel(command) {
  return OPS_COMMAND_LABELS[command] || command;
}

function opsLogChannelLabel(channel) {
  return OPS_LOG_CHANNEL_LABELS[channel] || channel;
}

function getActiveRuntimeSessionId() {
  const sess = state.sessions.get(state.activeId);
  if (!sess) return '';
  for (let i = sess.messages.length - 1; i >= 0; i -= 1) {
    const msg = sess.messages[i] || {};
    const runtimeId = msg.runtime_session_id || msg.runtimeSessionId;
    if (runtimeId) return runtimeId;
  }
  return '';
}

function opsCard(label, value, cls) {
  const card = document.createElement('div');
  card.className = 'ops-card';
  const title = document.createElement('span');
  title.className = 'ops-label';
  title.textContent = label;
  const body = document.createElement('span');
  body.className = 'ops-value ' + (cls || '');
  body.textContent = value;
  card.appendChild(title);
  card.appendChild(body);
  return card;
}

function renderOpsSummary(data) {
  if (!opsSummaryEl) return;
  opsSummaryEl.textContent = '';
  if (!data || data.error) {
    const empty = document.createElement('div');
    empty.className = 'ops-empty';
    empty.textContent = data?.error || '中枢状态不可用。';
    opsSummaryEl.appendChild(empty);
    return;
  }
  const version = data.version || {};
  const runtime = data.runtime_audit || {};
  const privacy = data.privacy_audit || {};
  const capabilities = data.selfcheck?.capabilities || {};
  const voice = capabilities.voice || {};
  const tts = capabilities.tts || {};
  const services = Array.isArray(data.services) ? data.services : [];
  const feishu = services.find(s => s.name === 'penglai-feishu') || {};
  const runtimeHub = services.find(s => s.name === 'penglai-runtime-hub') || {};

  opsSummaryEl.appendChild(opsCard('中枢', opsStatusText(data.ok), opsStatusClass(data.ok)));
  opsSummaryEl.appendChild(opsCard('版本', `${version.version || '-'} / ${version.branch || '-'}`));
  opsSummaryEl.appendChild(opsCard('旧入口', `${runtime.active_blocker_count ?? '-'} 个活跃阻断`, runtime.active_blocker_count ? 'err' : 'ok'));
  opsSummaryEl.appendChild(opsCard('隐私', opsStatusText(privacy.privacy_ok), opsStatusClass(privacy.privacy_ok)));
  opsSummaryEl.appendChild(opsCard('发布', privacy.release_ready ? '可发布' : `${privacy.release_blocker_count ?? 0} 个阻断项`, privacy.release_ready ? 'ok' : 'warn'));
  opsSummaryEl.appendChild(opsCard('飞书', feishu.active ? opsStatusText(feishu.active) : '未启用', opsStatusClass(feishu.active)));
  opsSummaryEl.appendChild(opsCard('中枢服务', runtimeHub.active ? opsStatusText(runtimeHub.active) : '未启用', opsStatusClass(runtimeHub.active)));
  opsSummaryEl.appendChild(opsCard('语音转写', voice.detail || opsStatusText(voice.ready), opsStatusClass(voice.ready)));
  opsSummaryEl.appendChild(opsCard('语音输出', tts.detail || opsStatusText(tts.ready), opsStatusClass(tts.ready)));
  opsSummaryEl.appendChild(opsCard('本地改动', version.dirty ? '有' : '无', version.dirty ? 'warn' : 'ok'));
}

function setOpsOutput(label, payload) {
  if (!opsOutputEl) return;
  if (payload == null) {
    opsOutputEl.textContent = '';
    return;
  }
  if (typeof payload === 'string') {
    opsOutputEl.textContent = label ? `${label}\n\n${payload}` : payload;
    return;
  }
  const out = [];
  if (label) out.push(label);
  if ('returncode' in payload) out.push(`退出码：${payload.returncode}`);
  if (payload.stdout) out.push(String(payload.stdout).trimEnd());
  if (payload.stderr) out.push(String(payload.stderr).trimEnd());
  if (payload.text) out.push(String(payload.text).trimEnd());
  if (out.length <= (label ? 1 : 0)) out.push(JSON.stringify(payload, null, 2));
  opsOutputEl.textContent = out.filter(Boolean).join('\n\n');
  opsOutputEl.scrollIntoView({ block: 'nearest' });
}

async function refreshOpsPanel(options = {}) {
  if (!window.penglai?.getOpsChecks || !opsSummaryEl) return;
  try {
    if (!options.silent) setOpsOutput('正在刷新中枢状态…', '');
    const data = await window.penglai.getOpsChecks();
    renderOpsSummary(data);
    if (!options.silent) setOpsOutput('中枢状态', JSON.stringify(data, null, 2));
  } catch (err) {
    renderOpsSummary({ error: err.message || String(err) });
    addDiagnostic('warn', '刷新中枢状态失败', err);
    if (!options.silent) showError('中枢状态刷新失败：' + (err.message || err));
  }
}

async function runOpsCommandUi(command, options = {}) {
  try {
    const label = opsCommandLabel(command);
    setOpsOutput(`正在运行${label}…`, '');
    const data = await window.penglai.runOpsCommand(command, options);
    setOpsOutput(`penglai ${command}（${label}）`, data);
    refreshOpsPanel({ silent: true });
  } catch (err) {
    const label = opsCommandLabel(command);
    setOpsOutput(`penglai ${command}（${label}）`, err.data || err.message || String(err));
    showError(`${label}失败：${err.message || err}`);
  }
}

async function runOpsStateCommandUi(command, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  await runOpsCommandUi(command, { method: 'POST', timeout: 120 });
}

async function loadOpsLogUi() {
  try {
    const channel = $('ops-log-channel')?.value || 'feishu';
    const label = opsLogChannelLabel(channel);
    setOpsOutput(`正在加载${label}日志…`, '');
    const data = await window.penglai.getOpsLogs(channel, 120);
    setOpsOutput(`${label}日志`, data);
  } catch (err) {
    setOpsOutput('日志', err.data || err.message || String(err));
    showError('加载日志失败：' + (err.message || err));
  }
}

function formatRuntimeStatus(data) {
  const session = data?.session || {};
  const queue = session.queue || {};
  return [
    `会话：${data?.session_id || session.session_id || '-'}`,
    `运行中：${queue.active ? '是' : '否'}`,
    `排队：${queue.pending ?? 0}`,
    `当前任务：${session.active_run_id || '-'}`,
    `当前状态：${opsStatusText(session.active_status)}`,
  ].join('\n');
}

function formatRuntimeRun(row) {
  const ts = Number(row.created_at || 0);
  const timeText = ts ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '-';
  const result = String(row.error || row.result_text || '').replace(/\s+/g, ' ').trim();
  const summary = result ? `\n  ${result.slice(0, 160)}` : '';
  return `${timeText}  ${row.session_id || '-'}  ${opsStatusText(row.status)}  ${row.worker_id || '-'}\n  ${row.run_id || '-'}${summary}`;
}

async function loadRuntimeStatusUi() {
  try {
    const sessionId = getActiveRuntimeSessionId();
    setOpsOutput('正在加载会话状态…', '');
    const data = await window.penglai.getRuntimeStatus(sessionId);
    setOpsOutput('中枢会话状态', formatRuntimeStatus(data));
  } catch (err) {
    setOpsOutput('会话状态', err.data || err.message || String(err));
    showError('加载会话状态失败：' + (err.message || err));
  }
}

async function loadRuntimeRunsUi() {
  try {
    const sessionId = getActiveRuntimeSessionId();
    setOpsOutput('正在加载运行记录…', '');
    const data = await window.penglai.getRuntimeRuns(sessionId, 20);
    const rows = Array.isArray(data.runs) ? data.runs : [];
    const body = rows.length ? rows.map(formatRuntimeRun).join('\n\n') : '没有运行记录。';
    const scope = data.session_id ? `（${data.session_id}）` : '（全部会话）';
    setOpsOutput(`中枢运行记录${scope}`, body);
  } catch (err) {
    setOpsOutput('运行记录', err.data || err.message || String(err));
    showError('加载运行记录失败：' + (err.message || err));
  }
}

async function openConfigFile(openFn, label) {
  try {
    const result = await openFn();
    if (result && result.ok === false) {
      showError(`打开 ${label} 失败：${result.error || result.path || '未知错误'}`);
    }
  } catch (err) {
    showError(`打开 ${label} 失败：${err.message || err}`);
  }
}

async function saveSettings() {
  const saveBtn = $('save-settings');
  saveBtn.disabled = true;
  try {
    const sess = state.sessions.get(state.activeId);
    if (!sess) throw new Error('没有活动对话');
    const cfg = sess.config;
    cfg.llmNo = Math.max(0, parseInt($('cfg-llm').value, 10) || 0);
    await window.penglai.saveConfig(cfg);
    closeSettings();
  } catch (err) {
    showError('保存设置失败：' + (err.message || err));
  } finally {
    saveBtn.disabled = false;
  }
}

async function ensureBridgeSession(sess) {
  if (!sess) throw new Error('没有活动对话。');
  if (sess.bridgeSessionId) return sess.bridgeSessionId;
  const cwd = sess.cwd || await getCwd();
  const res = await window.penglai.rpc('session/new', { cwd, mcp_servers: [] });
  if (res.error) throw new Error(typeof res.error === 'string' ? res.error : (res.error.message || JSON.stringify(res.error)));
  sess.bridgeSessionId = res.sessionId;
  sess.cwd = cwd;
  return sess.bridgeSessionId;
}

async function restartBridge(options = {}) {
  const { remapSessions = false } = options;
  setStatus('warn', '重启中…');
  state.bridgeReady = false;
  state.restartingBridge = true;
  if (remapSessions) {
    for (const sess of state.sessions.values()) sess.bridgeSessionId = null;
  }
  state.bridgeNoticeMessage = showSystem('中枢桥接正在重启…');
  await window.penglai.startBridge(getActiveConfig().llmNo || 0);
  window.setTimeout(() => {
    if (state.restartingBridge && !state.bridgeReady && !getActiveSessionRuntime()?.busy) {
      markBridgeReady('中枢桥接已就绪。');
      addDiagnostic('warn', '中枢桥接就绪事件超时，已在本地恢复就绪状态');
    }
  }, 2500);
}

// ─── Bridge events ───────────────────────────────────────────────────────
let _bootstrappingSession = false;
async function markBridgeReady(noticeText = '中枢桥接已就绪。') {
  if (state.bridgeReady) return; // already marked ready, prevent double-fire
  state.bridgeReady = true;
  state.restartingBridge = false;
  if (getActiveSessionRuntime()?.busy) setStatus('busy', '蓬莱正在回复…');
  else setStatus('ok', '就绪');
  updateBridgeNotice(noticeText);
  hideError();
  // Restore sessions from bridge (survives page refresh) or create first session
  if (state.sessions.size === 0 && !_bootstrappingSession) {
    _bootstrappingSession = true;
    try {
      // Try to restore existing sessions from bridge
      const listRes = await window.penglai.listSessions().catch(() => null);
      const existingSessions = listRes?.sessions || [];
      if (existingSessions.length > 0) {
        // Restore each session from bridge
        for (const bSess of existingSessions) {
          const localId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const sess = createLocalSession(localId, bSess.title || '已恢复', bSess.id || bSess.sessionId);
          // Fetch full messages for this session
          const sid = bSess.id || bSess.sessionId;
          const msgRes = await window.penglai.getSessionMessages(sid, 0, 9999).catch(() => null);
          if (msgRes?.messages) {
            sess.messages = msgRes.messages;
            // Initialize polling state so we don't re-fetch these messages
            const runtime = getSessionRuntime(sess);
            runtime.seenBridgeMessageIds = new Set();
            let maxId = 0;
            for (const m of msgRes.messages) {
              if (m.id) { runtime.seenBridgeMessageIds.add(Number(m.id)); maxId = Math.max(maxId, Number(m.id)); }
            }
            runtime.lastPolledMessageId = maxId;
          }
        }
        // Activate the first session
        const firstLocalId = [...state.sessions.keys()][0];
        if (firstLocalId) setActiveSession(firstLocalId);
      } else {
        await newSession();
      }
    } finally { _bootstrappingSession = false; }
  }
  updateSendButton();
  updateSpeechButton();
  // Refresh model profiles from bridge (authoritative source)
  loadModelProfiles();
}

window.penglai.onBridgeReady(() => {
  markBridgeReady();
});

window.penglai.onBridgeMessage(() => {
  // RPC responses are resolved in main; renderer readiness comes from bridge-ready.
});

window.penglai.onBridgeNotification((msg) => {
  handleNotification(msg);
});

window.penglai.onBridgeError((err) => {
  console.error('Bridge error:', err);
  addDiagnostic('error', '中枢桥接错误', err);
  setStatus('err', '出错');
  state.bridgeReady = false;
  state.restartingBridge = false;
  updateSpeechButton();

  if (err.type === 'no-mykey') {
    showError(err.message, '配置', async () => {
      await window.penglai.openMykeyTemplate();
    }, { skipDiagnostic: true });
  } else if (err.type === 'no-python') {
    showError(err.message, '设置', openSettings, { skipDiagnostic: true });
  } else {
    showError(err.message || '中枢桥接错误', null, null, { skipDiagnostic: true });
  }
});

window.penglai.onBridgeClosed((info) => {
  addDiagnostic('warn', '中枢桥接已关闭', info);
  if (state.restartingBridge) {
    setStatus('warn', '重启中…');
    return;
  }
  state.bridgeReady = false;
  updateSpeechButton();
  // Clear busy flag on all sessions so pending poll loops can exit cleanly
  for (const [sid, runtime] of state.runtimeBySessionId) {
    if (runtime.busy) setBusy(false, null, state.sessions.get(sid));
  }
  setStatus('err', `中枢桥接已停止（${info.code}）`);
});

window.penglai.onBridgeLog((text) => {
  console.log('[bridge]', text);
  addDiagnostic('info', '中枢桥接日志', text);
});

// ─── Input handling ──────────────────────────────────────────────────────
inputEl.addEventListener('input', () => {
  // auto-resize
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  updateSendButton();
});

// IME composition fix - triple guard for CJK input methods (macOS especially)
let _imeComposing = false;
inputEl.addEventListener('compositionstart', () => { _imeComposing = true; });
inputEl.addEventListener('compositionend', () => { _imeComposing = false; });

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (e.isComposing || _imeComposing || e.keyCode === 229) return; // IME active, ignore
    e.preventDefault();
    submitInput();
  } else if (e.key === 'Escape' && getActiveSessionRuntime()?.busy) {
    e.preventDefault();
    cancelPrompt();
  }
});

// ─── Image paste handling ─────────────────────────────────────────────────
const imagePreviews = document.getElementById('image-previews');
const pendingImages = []; // Array of { dataUrl, id }

inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const id = `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        pendingImages.push({ dataUrl, id });
        renderImagePreviews();
      };
      reader.readAsDataURL(file);
      break; // handle one image per paste
    }
  }
});

function renderImagePreviews() {
  imagePreviews.innerHTML = '';
  for (const img of pendingImages) {
    const wrapper = document.createElement('div');
    wrapper.className = 'image-preview-item';
    wrapper.dataset.imgId = img.id;

    const imgEl = document.createElement('img');
    imgEl.src = img.dataUrl;
    imgEl.alt = '粘贴的图片';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'remove-img';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', '移除图片');
    closeBtn.addEventListener('click', () => {
      const idx = pendingImages.findIndex(i => i.id === img.id);
      if (idx !== -1) pendingImages.splice(idx, 1);
      renderImagePreviews();
    });

    wrapper.appendChild(imgEl);
    wrapper.appendChild(closeBtn);
    imagePreviews.appendChild(wrapper);
  }
  imagePreviews.style.display = pendingImages.length ? 'flex' : 'none';
}

function clearPendingImages() {
  pendingImages.length = 0;
  renderImagePreviews();
}

function submitInput() {
  const text = inputEl.value.trim();
  if (!text && pendingImages.length === 0) return;
  if (getActiveSessionRuntime()?.busy) {
    showSystem('蓬莱仍在回复。请先按 Esc 或停止按钮，再发送新消息。');
    return;
  }
  const images = [...pendingImages];
  inputEl.value = '';
  inputEl.style.height = 'auto';
  clearPendingImages();
  updateSendButton();

  if (text.startsWith('/')) {
    handleSlash(text).catch((err) => {
      showSystem('命令执行失败：' + (err.message || err));
    });
  } else {
    sendPrompt(text, images);
  }
}

sendBtn.addEventListener('click', () => {
  if (getActiveSessionRuntime()?.busy) {
    cancelPrompt().then((ok) => {
      if (ok) showSystem('已请求停止。');
    });
  } else submitInput();
});

// ─── Buttons ─────────────────────────────────────────────────────────────
$('new-session-btn').addEventListener('click', newSession);
$('settings-btn').addEventListener('click', openSettings);
$('speak-last-btn')?.addEventListener('click', speakLastAssistant);
$('close-settings').addEventListener('click', closeSettings);
$('cancel-settings').addEventListener('click', closeSettings);
$('save-settings').addEventListener('click', saveSettings);
$('open-mykey').addEventListener('click', () => openConfigFile(window.penglai.openMykey, 'mykey.py'));
$('ops-refresh')?.addEventListener('click', () => refreshOpsPanel());
$('ops-runtime-service-status')?.addEventListener('click', () => runOpsCommandUi('runtime-service-status'));
$('ops-runtime-service-install')?.addEventListener('click', () => runOpsStateCommandUi(
  'runtime-service-install',
  '启动本机中枢服务？这只会管理 penglai-runtime-hub，不会启动飞书或微信渠道。'
));
$('ops-runtime-service-uninstall')?.addEventListener('click', () => runOpsStateCommandUi(
  'runtime-service-uninstall',
  '停止并移除本机中枢服务？这只会管理 penglai-runtime-hub，不会停止飞书或微信渠道。'
));
$('ops-doctor')?.addEventListener('click', () => runOpsCommandUi('doctor'));
$('ops-selfcheck')?.addEventListener('click', () => runOpsCommandUi('selfcheck'));
$('ops-install-check')?.addEventListener('click', () => runOpsCommandUi('install-check'));
$('ops-update-check')?.addEventListener('click', () => runOpsCommandUi('update-check'));
$('ops-runtime-audit')?.addEventListener('click', () => runOpsCommandUi('runtime-audit'));
$('ops-privacy-audit')?.addEventListener('click', () => runOpsCommandUi('privacy-audit'));
$('ops-runtime-status')?.addEventListener('click', loadRuntimeStatusUi);
$('ops-runtime-runs')?.addEventListener('click', loadRuntimeRunsUi);
$('ops-load-log')?.addEventListener('click', loadOpsLogUi);
$('error-dismiss').addEventListener('click', hideError);

settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);

// ─── Message Search (Cmd/Ctrl+F) ─────────────────────────────────────────
(function initSearch() {
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const searchClose = document.getElementById('search-close');
  const searchPrev = document.getElementById('search-prev');
  const searchNext = document.getElementById('search-next');
  const searchCount = document.getElementById('search-count');

  let highlights = [];
  let currentIdx = -1;

  function openSearch() {
    searchBar.classList.remove('hidden');
    searchBar.classList.add('visible');
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    searchBar.classList.remove('visible');
    searchBar.classList.add('hidden');
    clearHighlights();
    searchInput.value = '';
    searchCount.textContent = '';
  }

  function clearHighlights() {
    highlights.forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });
    highlights = [];
    currentIdx = -1;
  }

  function doSearch(query) {
    clearHighlights();
    if (!query) { searchCount.textContent = ''; return; }

    const chatArea = document.getElementById('messages');
    const walker = document.createTreeWalker(chatArea, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const lowerQ = query.toLowerCase();
    textNodes.forEach(node => {
      const text = node.textContent;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(lowerQ);
      if (idx === -1) return;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        highlights.push(mark);
        lastIdx = idx + query.length;
        idx = lower.indexOf(lowerQ, lastIdx);
      }
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    });

    searchCount.textContent = highlights.length ? `1/${highlights.length}` : '0';
    if (highlights.length) { currentIdx = 0; scrollToHighlight(); }
  }

  function scrollToHighlight() {
    highlights.forEach((el, i) => el.classList.toggle('active', i === currentIdx));
    if (highlights[currentIdx]) {
      // Expand any collapsed ancestor turns so the match is visible
      let ancestor = highlights[currentIdx].parentElement;
      while (ancestor && ancestor !== document.body) {
        if (ancestor.classList.contains('turn') && ancestor.classList.contains('collapsed')) {
          ancestor.classList.remove('collapsed');
        }
        ancestor = ancestor.parentElement;
      }
      highlights[currentIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
      searchCount.textContent = `${currentIdx + 1}/${highlights.length}`;
    }
  }

  function nextMatch() { if (!highlights.length) return; currentIdx = (currentIdx + 1) % highlights.length; scrollToHighlight(); }
  function prevMatch() { if (!highlights.length) return; currentIdx = (currentIdx - 1 + highlights.length) % highlights.length; scrollToHighlight(); }

  // Event listeners
  searchClose.addEventListener('click', closeSearch);
  searchPrev.addEventListener('click', prevMatch);
  searchNext.addEventListener('click', nextMatch);

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(searchInput.value), 200);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.shiftKey ? prevMatch() : nextMatch(); e.preventDefault(); }
    if (e.key === 'Escape') { closeSearch(); e.preventDefault(); }
  });

  // Global shortcut: Cmd+F (Mac) / Ctrl+F (Win/Linux)
  // Note: On macOS Electron intercepts Cmd+F via menu accelerator,
  // so we also listen for IPC 'open-search' from main process.
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === 'f') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape' && searchBar.classList.contains('visible')) {
      e.preventDefault();
      closeSearch();
    }
  });

  // Listen for IPC from main process (menu accelerator on macOS)
  if (window.penglai && window.penglai.onOpenSearch) {
    window.penglai.onOpenSearch(() => openSearch());
  }
})();

// ─── Init ────────────────────────────────────────────────────────────────
(async function init() {
  // Add platform class to body for platform-specific CSS
  const platform = (window.penglai && window.penglai.platform) || process.platform || 'unknown';
  document.body.classList.add('platform-' + platform);

  try {
    const saved = await window.penglai.getConfig();
    Object.assign(state.defaultConfig, saved);
  } catch (err) {
    addDiagnostic('error', '加载设置失败', err);
    showError('加载设置失败，已使用默认值：' + (err.message || err));
  }
  applyTheme();
  await loadModelProfiles();
  updateSendButton();
  inputEl.focus();

  // Check for runtime updates on startup
  checkForUpdates();

  // Task 9: listen for tray menu "check_update" events emitted from Rust
  // (replaces the previous w.eval("checkForUpdates()") anti-pattern).
  if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
    try {
      await window.__TAURI__.event.listen('menu-check-update', () => {
        if (typeof checkForUpdates === 'function') checkForUpdates();
      });
    } catch (_err) {
      // Best-effort: if Tauri event API is unavailable, tray click still focuses window.
    }
  }
})();

// ── Settings tabs (v0.3.0 channel/ability management) ──────────────────
(function initSettingsTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = {
    ops: document.getElementById('tab-ops'),
    channels: document.getElementById('tab-channels'),
    abilities: document.getElementById('tab-abilities'),
    doctor: document.getElementById('tab-doctor'),
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(contents).forEach(c => c?.classList.add('hidden'));
      const target = contents[tab.dataset.tab];
      if (target) target.classList.remove('hidden');
      // Load content on tab switch
      if (tab.dataset.tab === 'channels') loadChannels();
      if (tab.dataset.tab === 'abilities') loadAbilities();
    });
  });

  // Doctor button
  document.getElementById('doctor-run')?.addEventListener('click', runDoctor);
})();

async function loadChannels() {
  const el = document.getElementById('channels-list');
  if (!el) return;
  try {
    const data = await window.penglai.apiGet('/channels');
    const channels = (data && data.channels) || [];
    el.innerHTML = channels.map(ch => `
      <div class="item-card">
        <div class="item-info">
          <div class="item-name">${escHtml(ch.name)}</div>
          <div class="item-desc">${escHtml(ch.desc)}</div>
        </div>
        <span class="item-status ${ch.configured ? 'status-configured' : 'status-unconfigured'}">${ch.configured ? (ch.running ? '运行中' : '已配置') : '未配置'}</span>
        <button class="btn btn-sm" onclick="${ch.configured ? `disableChannel('${ch.id}')` : `enableChannel('${ch.id}')`}">${ch.configured ? '禁用' : '启用'}</button>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<div class="ops-empty">加载渠道失败: ${escHtml(err.message || err)}</div>`;
  }
}

async function enableChannel(id) {
  try {
    setOpsOutput(`正在启用渠道 ${id}…`, '');
    const data = await window.penglai.apiPost(`/channels/${id}/enable`);
    setOpsOutput(`启用渠道 ${id}`, data);
    setTimeout(loadChannels, 1000);
  } catch (err) {
    showError('启用渠道失败: ' + (err.message || err));
  }
}

async function disableChannel(id) {
  try {
    const data = await window.penglai.apiPost(`/channels/${id}/disable`);
    setOpsOutput(`禁用渠道 ${id}`, data);
    setTimeout(loadChannels, 1000);
  } catch (err) {
    showError('禁用渠道失败: ' + (err.message || err));
  }
}

async function loadAbilities() {
  const el = document.getElementById('abilities-list');
  if (!el) return;
  try {
    const data = await window.penglai.apiGet('/abilities');
    const abilities = (data && data.abilities) || [];
    el.innerHTML = abilities.map(ab => `
      <div class="item-card">
        <div class="item-info">
          <div class="item-name">${escHtml(ab.name)}</div>
          <div class="item-desc">${escHtml(ab.desc)}</div>
        </div>
        <span class="item-status ${ab.enabled ? 'status-configured' : 'status-unconfigured'}">${ab.enabled ? '已启用' : '未启用'}</span>
        <button class="btn btn-sm" onclick="${ab.enabled ? `disableAbility('${ab.id}')` : `enableAbility('${ab.id}')`}">${ab.enabled ? '禁用' : '启用'}</button>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<div class="ops-empty">加载能力失败: ${escHtml(err.message || err)}</div>`;
  }
}

async function enableAbility(id) {
  try {
    setOpsOutput(`正在启用能力 ${id}…`, '');
    const data = await window.penglai.apiPost(`/abilities/${id}/enable`);
    setOpsOutput(`启用能力 ${id}`, data);
    setTimeout(loadAbilities, 1000);
  } catch (err) {
    showError('启用能力失败: ' + (err.message || err));
  }
}

async function disableAbility(id) {
  try {
    const data = await window.penglai.apiPost(`/abilities/${id}/disable`);
    setOpsOutput(`禁用能力 ${id}`, data);
    setTimeout(loadAbilities, 1000);
  } catch (err) {
    showError('禁用能力失败: ' + (err.message || err));
  }
}

async function runDoctor() {
  const el = document.getElementById('doctor-output');
  if (!el) return;
  el.textContent = '诊断中…';
  try {
    const data = await window.penglai.apiGet('/doctor');
    let text = data.all_ok ? '✅ 全部检查通过\n\n' : '⚠️ 发现问题\n\n';
    for (const c of (data.checks || [])) {
      text += `${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail || ''}\n`;
    }
    el.textContent = text;
  } catch (err) {
    el.textContent = '诊断失败: ' + (err.message || err);
  }
}

// ─── Update check ──────────────────────────────────────────────────────
async function checkForUpdates() {
  const banner = $('update-banner');
  if (!banner) return;
  try {
    const data = await window.penglai.runOpsCommand('update-check');
    const text = (data && (data.stdout || data.text)) || '';
    if (text.includes('落后') || text.includes('新版本')) {
      banner.classList.remove('hidden');
      const updateText = $('update-text');
      if (updateText) updateText.textContent = '运行时新版本可用，点击一键升级（自动备份+回滚）';
    }
  } catch (err) {
    // Silently skip — update check is best-effort, not a hard requirement
  }
}

$('update-apply-btn')?.addEventListener('click', async () => {
  const banner = $('update-banner');
  const btn = $('update-apply-btn');
  if (btn) { btn.disabled = true; btn.textContent = '升级中…'; }
  try {
    setOpsOutput('正在升级运行时（预检→下载→重启→健康检查→失败自动回滚）…', '');
    const data = await window.penglai.runOpsCommand('update-apply', { method: 'POST', timeout: 180 });
    setOpsOutput('penglai update --apply（运行时升级）', data);
    if (banner) banner.classList.add('hidden');
    // Reload after update
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '一键升级'; }
    showError('升级失败：' + (err.message || err));
  }
});

$('update-dismiss-btn')?.addEventListener('click', () => {
  $('update-banner')?.classList.add('hidden');
});

// ============================================================
// Penglai Desktop 0.3.2 — 9-Module Shell Router & Renderers
// Appended IIFE. Coexists with legacy chat logic above.
// Each module renders into its <section class="pl-view"> container
// defined in index.html. Reuses window.penglai bridge adapter and
// existing helpers (showError / setOpsOutput / addDiagnostic).
// Red lines enforced:
//   - No raw token display (maskToken masks everything)
//   - Every GUI action annotated with a penglai CLI mapping
//   - Channels/Feishu/WeChat config delegated to CLI, not reimplemented
//   - Bridge port 14168, HTTP+WS via window.penglai
// ============================================================
(() => {
  'use strict';

  // ─── Platform detection (drives Mac frosted glass vs Windows Mica) ───
  const platform = (window.penglai && window.penglai.platform) ||
                   (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32');
  document.documentElement.classList.add(`platform-${platform}`);
  const isMac = platform === 'darwin';

  // ─── Local helpers (self-contained; legacy escapeHtml stays untouched) ───
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const refreshIcons = () => { try { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); } catch (_) {} };
  const cliHint = (cmd) => `<span class="pl-cli-hint"><code>$ ${esc(cmd)}</code></span>`;
  const diag = (level, msg, payload) => { try { if (typeof addDiagnostic === 'function') addDiagnostic(level, msg, payload); } catch (_) {} };
  const fail = (msg, err) => { try { if (typeof showError === 'function') showError(msg + (err ? '：' + (err.message || err) : '')); } catch (_) {} };

  function formatOpsResult(data) {
    if (!data) return '(无输出)';
    const parts = [];
    if ('returncode' in data) parts.push(`退出码：${data.returncode}`);
    if (data.stdout) parts.push(String(data.stdout).trimEnd());
    if (data.stderr) parts.push(String(data.stderr).trimEnd());
    if (data.text) parts.push(String(data.text).trimEnd());
    return parts.join('\n\n') || '(无输出)';
  }

  function maskToken(value) {
    if (!value) return '';
    const s = String(value);
    if (s.length <= 8) return '****';
    return s.slice(0, 4) + '****' + s.slice(-4);
  }

  const VIEW_TITLES = {
    chat: '聊天工作台', runtime: '运行历史', channels: '渠道管理',
    abilities: '能力管理', companion: '陪伴控制', diagnostics: '诊断面板',
    logs: '脱敏日志', update: '检查更新', security: '安全设置', setup: '安装引导'
  };

  const renderedViews = new Set();

  // ─── View router ───────────────────────────────────────────
  function switchView(view) {
    document.querySelectorAll('#pl-nav .pl-nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.view === view);
    });
    document.querySelectorAll('.pl-view').forEach((v) => {
      v.classList.toggle('hidden', v.dataset.view !== view);
    });
    const titleEl = $('pl-topbar-title');
    if (titleEl) titleEl.textContent = VIEW_TITLES[view] || view;
    const target = document.querySelector(`.pl-view[data-view="${view}"]`);
    if (target && !renderedViews.has(view) && view !== 'chat') {
      renderedViews.add(view);
      try {
        (renderers[view] || (() => {}))(target);
      } catch (err) {
        target.innerHTML = `<div class="pl-note pl-note-error">渲染失败: ${esc(err.message || err)}</div>`;
      }
    }
    refreshIcons();
    // Refresh dynamic data on each visit (best-effort)
    if (view !== 'chat' && refreshers[view]) {
      Promise.resolve(refreshers[view]()).catch((err) => diag('error', `刷新 ${view} 失败`, err));
    }
  }

  function bindNav() {
    const nav = $('pl-nav');
    if (!nav) return;
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('.pl-nav-item');
      if (!item || !item.dataset.view) return;
      switchView(item.dataset.view);
    });
  }

  // ─── Bridge badge ──────────────────────────────────────────
  function updateBridgeBadge(ready) {
    const dot = $('pl-bridge-dot');
    const text = $('pl-bridge-text');
    const badge = $('pl-platform-badge');
    if (badge) badge.textContent = isMac ? 'Mac' : 'Windows';
    if (dot && text) {
      dot.style.background = ready ? 'var(--state-success)' : 'var(--state-warning)';
      text.textContent = ready ? '桥接已就绪' : '启动中…';
    }
  }

  // ─── QR modal (Channels + Setup use it) ────────────────────
  function bindQrModal() {
    const backdrop = $('qr-modal-backdrop');
    const close = $('qr-modal-close');
    close?.addEventListener('click', () => backdrop?.classList.add('hidden'));
    backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.classList.add('hidden'); });
  }

  function openQrModal(channel) {
    const backdrop = $('qr-modal-backdrop');
    const title = $('qr-modal-title');
    const placeholder = $('qr-placeholder');
    if (!backdrop || !title || !placeholder) return;
    title.textContent = channel === 'feishu' ? '飞书扫码登录' : '微信扫码登录';
    placeholder.textContent = `请使用 ${channel === 'feishu' ? '飞书' : '微信'} App 扫一扫\n（实际二维码由 penglai CLI 生成）`;
    placeholder.style.whiteSpace = 'pre-line';
    backdrop.classList.remove('hidden');
  }

  // ============================================================
  //  Runtime Runs (SubTask 25.6) — state machine + run list
  // ============================================================
  let runtimeRunsCache = [];

  function renderRuntimeRuns(container) {
    container.innerHTML = `
      <div class="pl-runtime-wrap">
        <div class="pl-state-machine" aria-label="TaskRun 状态机">
          <div class="pl-state-node" data-state="pending"><span class="pl-state-dot"></span><span>pending</span></div>
          <span class="pl-state-arrow">→</span>
          <div class="pl-state-node" data-state="running"><span class="pl-state-dot"></span><span>running</span></div>
          <span class="pl-state-arrow">→</span>
          <div class="pl-state-node" data-state="waiting_permission"><span class="pl-state-dot"></span><span>waiting_permission</span></div>
          <span class="pl-state-arrow">→</span>
          <div class="pl-state-node" data-state="succeeded"><span class="pl-state-dot"></span><span>succeeded</span></div>
          <span class="pl-state-sep">/</span>
          <div class="pl-state-node" data-state="failed"><span class="pl-state-dot"></span><span>failed</span></div>
          <span class="pl-state-sep">/</span>
          <div class="pl-state-node" data-state="cancelled"><span class="pl-state-dot"></span><span>cancelled</span></div>
        </div>
        <div class="pl-page-actions">
          <button class="pl-btn pl-btn-primary" id="pl-runtime-refresh"><span data-lucide="refresh-cw"></span>刷新</button>
          ${cliHint('penglai runtime runs / penglai runtime status')}
        </div>
        <div id="pl-runtime-list" class="pl-run-list">
          <div class="pl-note">点击"刷新"加载运行记录</div>
        </div>
      </div>`;
    container.querySelector('#pl-runtime-refresh')?.addEventListener('click', fetchRuntimeRuns);
  }

  async function fetchRuntimeRuns() {
    const list = $('pl-runtime-list');
    if (!list) return;
    list.innerHTML = '<div class="pl-note">加载运行记录…</div>';
    try {
      const data = await window.penglai.getRuntimeRuns('', 50);
      runtimeRunsCache = (data && (data.runs || data.items || [])) || [];
      if (!runtimeRunsCache.length) {
        list.innerHTML = `<div class="pl-note">暂无运行记录。${cliHint('penglai runtime runs --limit 50')}</div>`;
        return;
      }
      list.innerHTML = runtimeRunsCache.map((run) => {
        const id = run.id || run.run_id || '';
        const status = run.status || 'unknown';
        const cls = runStatusClass(status);
        const time = formatRunTime(run);
        return `
          <div class="pl-run-item" data-run-id="${esc(id)}">
            <div class="pl-run-grid">
              <span class="pl-badge pl-badge-${cls}">${esc(status)}</span>
              <code class="pl-mono">${esc(id)}</code>
              <span class="pl-run-time">${esc(time)}</span>
            </div>
          </div>`;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="pl-note pl-note-error">加载失败: ${esc(err.message || err)} ${cliHint('penglai runtime runs')}</div>`;
    }
  }

  function runStatusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'succeeded' || s === 'success') return 'success';
    if (s === 'failed' || s === 'error') return 'error';
    if (s === 'running') return 'info';
    if (s === 'waiting_permission' || s === 'waiting-permission') return 'warning';
    return 'muted';
  }

  function formatRunTime(run) {
    if (!run) return '';
    const start = run.started_at || run.startedAt || '';
    const end = run.finished_at || run.finishedAt || run.ended_at || '';
    if (start && end) return `${start} → ${end}`;
    return start || '';
  }

  // ============================================================
  //  Channels (SubTask 25.7) — channel cards + QR modal
  // ============================================================
  function renderChannels(container) {
    container.innerHTML = `
      <div class="pl-channels-wrap">
        <div class="pl-page-actions">
          <button class="pl-btn pl-btn-primary" id="pl-channels-refresh"><span data-lucide="refresh-cw"></span>刷新</button>
          ${cliHint('penglai channel list / penglai channel enable <id>')}
        </div>
        <div id="pl-channels-list" class="pl-channel-grid">
          <div class="pl-note">点击"刷新"加载渠道</div>
        </div>
      </div>`;
    container.querySelector('#pl-channels-refresh')?.addEventListener('click', fetchChannels);
  }

  async function fetchChannels() {
    const list = $('pl-channels-list');
    if (!list) return;
    list.innerHTML = '<div class="pl-note">加载渠道…</div>';
    try {
      const data = await window.penglai.apiGet('/channels');
      const channels = (data && data.channels) || [];
      if (!channels.length) {
        list.innerHTML = `<div class="pl-note">暂无渠道。${cliHint('penglai channel list')}</div>`;
        return;
      }
      list.innerHTML = channels.map((ch) => {
        const configured = !!ch.configured;
        const running = !!ch.running;
        const cls = running ? 'success' : (configured ? 'warning' : 'muted');
        const txt = running ? '运行中' : (configured ? '已配置' : '未配置');
        const actionBtn = configured
          ? `<button class="pl-btn pl-btn-sm" data-channel-disable="${esc(ch.id)}">禁用</button>`
          : `<button class="pl-btn pl-btn-sm pl-btn-primary" data-channel-enable="${esc(ch.id)}">启用</button>`;
        const qrBtn = (ch.id === 'feishu' || ch.id === 'wechat')
          ? `<button class="pl-btn pl-btn-sm pl-btn-ghost" data-channel-qr="${esc(ch.id)}">扫码登录</button>`
          : '';
        return `
          <div class="pl-channel-card">
            <div class="pl-channel-head">
              <div>
                <div class="pl-channel-name">${esc(ch.name || ch.id)}</div>
                <div class="pl-channel-desc">${esc(ch.desc || '')}</div>
              </div>
              <span class="pl-badge pl-badge-${cls}">${txt}</span>
            </div>
            <div class="pl-channel-actions">${actionBtn}${qrBtn}</div>
          </div>`;
      }).join('');
      list.querySelectorAll('[data-channel-enable]').forEach((b) => b.addEventListener('click', () => toggleChannel(b.dataset.channelEnable, true)));
      list.querySelectorAll('[data-channel-disable]').forEach((b) => b.addEventListener('click', () => toggleChannel(b.dataset.channelDisable, false)));
      list.querySelectorAll('[data-channel-qr]').forEach((b) => b.addEventListener('click', () => openQrModal(b.dataset.channelQr)));
      refreshIcons();
    } catch (err) {
      list.innerHTML = `<div class="pl-note pl-note-error">加载渠道失败: ${esc(err.message || err)}</div>`;
    }
  }

  async function toggleChannel(id, enable) {
    try {
      await window.penglai.apiPost(`/channels/${id}/${enable ? 'enable' : 'disable'}`);
      diag('info', `渠道 ${id} 已${enable ? '启用' : '禁用'}`);
      setTimeout(fetchChannels, 800);
    } catch (err) {
      fail('渠道操作失败', err);
    }
  }

  // ============================================================
  //  Abilities — ability cards
  // ============================================================
  function renderAbilities(container) {
    container.innerHTML = `
      <div class="pl-abilities-wrap">
        <div class="pl-page-actions">
          <button class="pl-btn pl-btn-primary" id="pl-abilities-refresh"><span data-lucide="refresh-cw"></span>刷新</button>
          ${cliHint('penglai ability list / penglai ability enable <id>')}
        </div>
        <div id="pl-abilities-list" class="pl-card-grid">
          <div class="pl-note">点击"刷新"加载能力</div>
        </div>
      </div>`;
    container.querySelector('#pl-abilities-refresh')?.addEventListener('click', fetchAbilities);
  }

  async function fetchAbilities() {
    const list = $('pl-abilities-list');
    if (!list) return;
    list.innerHTML = '<div class="pl-note">加载能力…</div>';
    try {
      const data = await window.penglai.apiGet('/abilities');
      const abilities = (data && data.abilities) || [];
      if (!abilities.length) {
        list.innerHTML = `<div class="pl-note">暂无能力。${cliHint('penglai ability list')}</div>`;
        return;
      }
      list.innerHTML = abilities.map((ab) => {
        const enabled = !!ab.enabled;
        const cls = enabled ? 'success' : 'muted';
        const txt = enabled ? '已启用' : '未启用';
        const btn = enabled
          ? `<button class="pl-btn pl-btn-sm" data-ab-disable="${esc(ab.id)}">禁用</button>`
          : `<button class="pl-btn pl-btn-sm pl-btn-primary" data-ab-enable="${esc(ab.id)}">启用</button>`;
        return `
          <div class="pl-card">
            <div class="pl-card-head">
              <div>
                <div class="pl-card-title">${esc(ab.name || ab.id)}</div>
                <div class="pl-card-desc">${esc(ab.desc || '')}</div>
              </div>
              <span class="pl-badge pl-badge-${cls}">${txt}</span>
            </div>
            <div class="pl-card-actions">${btn}</div>
          </div>`;
      }).join('');
      list.querySelectorAll('[data-ab-enable]').forEach((b) => b.addEventListener('click', () => toggleAbility(b.dataset.abEnable, true)));
      list.querySelectorAll('[data-ab-disable]').forEach((b) => b.addEventListener('click', () => toggleAbility(b.dataset.abDisable, false)));
      refreshIcons();
    } catch (err) {
      list.innerHTML = `<div class="pl-note pl-note-error">加载失败: ${esc(err.message || err)}</div>`;
    }
  }

  async function toggleAbility(id, enable) {
    try {
      await window.penglai.apiPost(`/abilities/${id}/${enable ? 'enable' : 'disable'}`);
      diag('info', `能力 ${id} 已${enable ? '启用' : '禁用'}`);
      setTimeout(fetchAbilities, 800);
    } catch (err) {
      fail('能力操作失败', err);
    }
  }

  // ============================================================
  //  Companion (SubTask 25.8) — four-mode segment + heartbeat timeline
  // ============================================================
  let companionCache = { mode: 'present', heartbeats: [], voices: [], why: null };

  function renderCompanion(container) {
    container.innerHTML = '<div class="pl-note">加载陪伴配置…</div>';
  }

  async function fetchCompanion() {
    const view = $('view-companion');
    if (!view) return;
    try {
      const cfg = await window.penglai.apiGet('/companion/config').catch(() => null);
      if (cfg) companionCache = Object.assign(companionCache, cfg);
      const hb = await window.penglai.apiGet('/companion/heartbeats?limit=20').catch(() => null);
      if (hb && hb.heartbeats) companionCache.heartbeats = hb.heartbeats;
      const voices = await window.penglai.apiGet('/tts/voices').catch(() => null);
      if (voices && voices.voices) {
        companionCache.voices = voices.voices;
        companionCache.voiceCurrent = voices.current || {};
      }
      const why = await window.penglai.apiGet('/companion/why').catch(() => null);
      if (why) companionCache.why = why;
    } catch (_) { /* endpoints may not exist yet */ }
    renderCompanionContent();
  }

  function renderCompanionContent() {
    const view = $('view-companion');
    if (!view) return;
    const modes = [
      { id: 'off', label: '关闭', desc: '完全不主动说话' },
      { id: 'quiet', label: '安静', desc: '仅天气等必要提示' },
      { id: 'present', label: '常规', desc: '按需主动提醒' },
      { id: 'active', label: '活跃', desc: '频繁主动交互' }
    ];
    const current = companionCache.mode || 'present';
    const heartbeats = companionCache.heartbeats || [];
    const hbHtml = heartbeats.length
      ? heartbeats.map((h) => `
          <div class="pl-heartbeat-item">
            <span class="pl-heartbeat-time">${esc(h.ts || h.time || '')}</span>
            <span class="pl-heartbeat-msg">${esc(h.message || h.summary || '')}</span>
            ${h.tag ? `<span class="pl-tag">${esc(h.tag)}</span>` : ''}
          </div>`).join('')
      : '<div class="pl-note">暂无心跳记录</div>';
    const voices = companionCache.voices || [];
    const vc = companionCache.voiceCurrent || {};
    const curGender = vc.gender || companionCache.voiceGender || 'auto';
    const curPersona = companionCache.relationshipStyle || companionCache.persona || 'butler';
    const personas = [
      { id: 'butler', label: '稳重管家' },
      { id: 'steady_male', label: '稳重男声' },
      { id: 'warm_female', label: '温和陪伴' },
      { id: 'custom', label: '自定义' }
    ];
    const why = companionCache.why || {};
    const whyHtml = why.last_decision
      ? `<div class="pl-heartbeat-item">
           <span class="pl-heartbeat-time">最近决策</span>
           <span class="pl-heartbeat-msg">${esc(why.last_decision)} · ${esc(why.last_reason || '')}</span>
           ${why.last_trigger_kind ? `<span class="pl-tag">${esc(why.last_trigger_kind)}</span>` : ''}
         </div>`
      : '<div class="pl-note">暂无主动陪伴记录</div>';
    const zhVoices = voices.filter(v => v.lang === 'zh');
    const zhVoiceOpts = zhVoices.map(v => `<option value="${esc(v.voice_id)}">${esc(v.label)}（${v.gender === 'male' ? '男' : '女'}）</option>`).join('');
    view.innerHTML = `
      <div class="pl-companion-wrap">
        <div class="pl-section">
          <div class="pl-section-title">陪伴模式</div>
          <div class="pl-mode-segment" role="tablist">
            ${modes.map((m) => `
              <button class="pl-mode-btn ${current === m.id ? 'active' : ''}" data-mode="${m.id}" title="${esc(m.desc)}">${esc(m.label)}</button>
            `).join('')}
          </div>
          <p class="pl-section-hint">${cliHint('penglai companion mode <off|quiet|present|active>')}</p>
        </div>
        <div class="pl-section">
          <div class="pl-section-title">声音人格（0.3.5）</div>
          <div class="pl-mode-segment" role="tablist">
            ${['auto','male','female'].map(g => `
              <button class="pl-mode-btn ${curGender === g ? 'active' : ''}" data-voice-gender="${g}" title="默认声音性别">${g === 'auto' ? '自动' : (g === 'male' ? '男声' : '女声')}</button>
            `).join('')}
          </div>
          <div class="pl-mode-segment" role="tablist" style="margin-top:8px">
            ${personas.map(p => `
              <button class="pl-mode-btn ${curPersona === p.id ? 'active' : ''}" data-persona="${p.id}" title="人格风格">${esc(p.label)}</button>
            `).join('')}
          </div>
          <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <select id="pl-companion-test-voice" class="pl-input" style="min-width:160px">
              <option value="">试听声音（默认）</option>
              ${zhVoiceOpts}
            </select>
            <input id="pl-companion-test-text" class="pl-input" type="text" value="你好，我是蓬莱，需要我帮忙吗？" style="flex:1; min-width:200px" />
            <button class="pl-btn" id="pl-companion-audition"><span data-lucide="volume-2"></span>试听</button>
          </div>
          <p class="pl-section-hint">${cliHint('penglai tts-voices · penglai companion voice male|female|auto')}</p>
        </div>
        <div class="pl-section">
          <div class="pl-section-title">为什么主动出现</div>
          <div class="pl-heartbeat-list">${whyHtml}</div>
        </div>
        <div class="pl-section">
          <div class="pl-section-title">心跳时间线</div>
          <div class="pl-heartbeat-list">${hbHtml}</div>
        </div>
      </div>`;
    view.querySelectorAll('.pl-mode-btn[data-mode]').forEach((b) => b.addEventListener('click', () => setCompanionMode(b.dataset.mode)));
    view.querySelectorAll('.pl-mode-btn[data-voice-gender]').forEach((b) => b.addEventListener('click', () => setCompanionVoice(b.dataset.voiceGender)));
    view.querySelectorAll('.pl-mode-btn[data-persona]').forEach((b) => b.addEventListener('click', () => setCompanionPersona(b.dataset.persona)));
    const auditionBtn = $('pl-companion-audition');
    if (auditionBtn) auditionBtn.addEventListener('click', companionAudition);
    refreshIcons();
  }

  async function setCompanionMode(mode) {
    try {
      await window.penglai.apiPost('/companion/mode', { mode });
      companionCache.mode = mode;
      diag('info', `陪伴模式已切换为 ${mode}`);
      renderCompanionContent();
    } catch (err) {
      fail('切换陪伴模式失败', err);
    }
  }

  async function setCompanionVoice(gender) {
    try {
      const res = await window.penglai.apiPost('/companion/voice', { gender });
      companionCache.voiceGender = gender;
      if (res && res.zh_sample) companionCache.voiceCurrent = Object.assign(companionCache.voiceCurrent || {}, { gender, zh_sample: res.zh_sample });
      diag('info', `声音性别已设为 ${gender}`);
      renderCompanionContent();
    } catch (err) {
      fail('设置声音性别失败', err);
    }
  }

  async function setCompanionPersona(persona) {
    try {
      await window.penglai.apiPost('/companion/persona', { persona });
      companionCache.relationshipStyle = persona;
      diag('info', `人格风格已设为 ${persona}`);
      renderCompanionContent();
    } catch (err) {
      fail('设置人格风格失败', err);
    }
  }

  async function companionAudition() {
    const voiceSel = $('pl-companion-test-voice');
    const textInput = $('pl-companion-test-text');
    const voice = voiceSel ? voiceSel.value : '';
    const text = textInput ? textInput.value.trim() : '';
    if (!text) { fail('试听文本为空', null); return; }
    try {
      const res = await window.penglai.apiPost('/tts/say', { text, voice: voice || undefined });
      if (res && res.audio_url) {
        const audio = new Audio(res.audio_url);
        audio.play().catch(() => fail('音频播放失败', null));
        diag('info', `试听：${voice || '默认声音'}`);
      } else {
        fail('试听失败：TTS 资源未就绪', res);
      }
    } catch (err) {
      fail('试听失败', err);
    }
  }

  // ============================================================
  //  Diagnostics (SubTask 25.9) — doctor / selfcheck / privacy-audit tabs
  // ============================================================
  function renderDiagnostics(container) {
    container.innerHTML = `
      <div class="pl-diagnostics-wrap">
        <div class="pl-tabs" role="tablist">
          <button class="pl-tab active" data-diag-tab="doctor">体检</button>
          <button class="pl-tab" data-diag-tab="selfcheck">自检</button>
          <button class="pl-tab" data-diag-tab="privacy">隐私审计</button>
        </div>
        <div class="pl-tab-content" id="pl-diag-doctor">
          <div class="pl-page-actions">
            <button class="pl-btn pl-btn-primary" id="pl-doctor-run"><span data-lucide="stethoscope"></span>运行体检</button>
            ${cliHint('penglai doctor')}
          </div>
          <pre class="pl-code-block" id="pl-doctor-output">点击"运行体检"查看结果</pre>
        </div>
        <div class="pl-tab-content hidden" id="pl-diag-selfcheck">
          <div class="pl-page-actions">
            <button class="pl-btn pl-btn-primary" id="pl-selfcheck-run"><span data-lucide="wrench"></span>运行自检</button>
            ${cliHint('penglai selfcheck')}
          </div>
          <pre class="pl-code-block" id="pl-selfcheck-output">点击"运行自检"查看结果</pre>
        </div>
        <div class="pl-tab-content hidden" id="pl-diag-privacy">
          <div class="pl-page-actions">
            <button class="pl-btn pl-btn-primary" id="pl-privacy-run"><span data-lucide="shield"></span>运行隐私审计</button>
            ${cliHint('penglai privacy-audit')}
          </div>
          <pre class="pl-code-block" id="pl-privacy-output">点击"运行隐私审计"查看结果</pre>
        </div>
      </div>`;
    container.querySelectorAll('[data-diag-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('[data-diag-tab]').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        container.querySelectorAll('.pl-tab-content').forEach((c) => c.classList.add('hidden'));
        container.querySelector(`#pl-diag-${tab.dataset.diagTab}`)?.classList.remove('hidden');
      });
    });
    container.querySelector('#pl-doctor-run')?.addEventListener('click', runDiagDoctor);
    container.querySelector('#pl-selfcheck-run')?.addEventListener('click', runDiagSelfcheck);
    container.querySelector('#pl-privacy-run')?.addEventListener('click', runDiagPrivacy);
  }

  async function runDiagDoctor() {
    const out = $('pl-doctor-output');
    if (!out) return;
    out.textContent = '诊断中…';
    try {
      const data = await window.penglai.apiGet('/doctor');
      let text = data.all_ok ? '✅ 全部检查通过\n\n' : '⚠️ 发现问题\n\n';
      for (const c of (data.checks || [])) text += `${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail || ''}\n`;
      out.textContent = text;
    } catch (err) {
      out.textContent = '诊断失败: ' + (err.message || err);
    }
  }

  async function runDiagSelfcheck() {
    const out = $('pl-selfcheck-output');
    if (!out) return;
    out.textContent = '自检中…';
    try {
      const data = await window.penglai.runOpsCommand('selfcheck');
      out.textContent = formatOpsResult(data);
    } catch (err) {
      out.textContent = '自检失败: ' + (err.message || err);
    }
  }

  async function runDiagPrivacy() {
    const out = $('pl-privacy-output');
    if (!out) return;
    out.textContent = '审计中…';
    try {
      const data = await window.penglai.runOpsCommand('privacy-audit');
      out.textContent = formatOpsResult(data);
    } catch (err) {
      out.textContent = '审计失败: ' + (err.message || err);
    }
  }

  // ============================================================
  //  Logs — channel selector + log viewer
  // ============================================================
  let currentLogChannel = 'runtime';
  let currentLogLines = 200;

  function renderLogs(container) {
    container.innerHTML = `
      <div class="pl-logs-wrap">
        <div class="pl-page-actions">
          <label class="pl-field-inline">
            <span>通道</span>
            <select id="pl-log-channel" class="pl-select">
              <option value="runtime">中枢</option>
              <option value="feishu">飞书</option>
              <option value="wechat">微信</option>
              <option value="scheduler">调度器</option>
              <option value="companion">陪伴端</option>
            </select>
          </label>
          <label class="pl-field-inline">
            <span>行数</span>
            <select id="pl-log-lines" class="pl-select">
              <option value="80">80</option>
              <option value="200" selected>200</option>
              <option value="500">500</option>
            </select>
          </label>
          <button class="pl-btn pl-btn-primary" id="pl-log-refresh"><span data-lucide="refresh-cw"></span>刷新</button>
          ${cliHint('penglai logs <channel> --lines 200')}
        </div>
        <pre class="pl-log-viewer" id="pl-log-output">点击"刷新"加载日志</pre>
      </div>`;
    container.querySelector('#pl-log-channel')?.addEventListener('change', (e) => fetchLogs(e.target.value, currentLogLines));
    container.querySelector('#pl-log-lines')?.addEventListener('change', (e) => fetchLogs(currentLogChannel, parseInt(e.target.value, 10) || 200));
    container.querySelector('#pl-log-refresh')?.addEventListener('click', () => fetchLogs());
  }

  async function fetchLogs(channel, lines) {
    currentLogChannel = channel || currentLogChannel;
    currentLogLines = lines || currentLogLines;
    const out = $('pl-log-output');
    if (!out) return;
    out.textContent = '加载日志…';
    try {
      const data = await window.penglai.getOpsLogs(currentLogChannel, currentLogLines);
      const text = (data && (data.stdout || data.text || data.log)) || '(无日志)';
      out.textContent = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    } catch (err) {
      out.textContent = '加载失败: ' + (err.message || err);
    }
  }

  // ============================================================
  //  Update — two layers: desktop app (tauri updater) + runtime (git pull)
  // ============================================================
  function renderUpdate(container) {
    container.innerHTML = `
      <div class="pl-update-wrap">
        <div class="pl-page-hero">
          <h2>检查更新</h2>
          <p>蓬莱桌面有两层升级：桌面应用本身（.app/.exe，通过 tauri-plugin-updater 签名升级）和运行时（Python 代码，通过 git pull 升级）。建议先升级桌面应用，再升级运行时。</p>
        </div>

        <div class="pl-card">
          <div class="pl-card-head">
            <div>
              <div class="pl-card-title">桌面应用（推荐先升级）</div>
              <div class="pl-card-desc">升级蓬莱桌面 App 本身（Tauri 壳 + 前端），通过签名验证的自动升级</div>
            </div>
          </div>
          <div class="pl-card-actions">
            <button class="pl-btn pl-btn-primary" id="pl-app-update-check"><span data-lucide="download-cloud"></span>检查桌面应用更新</button>
            <button class="pl-btn" id="pl-app-update-apply" disabled><span data-lucide="arrow-up-circle"></span>一键升级桌面应用</button>
          </div>
          <pre class="pl-code-block" id="pl-app-update-output">点击"检查桌面应用更新"查看是否有新版本。</pre>
        </div>

        <div class="pl-card">
          <div class="pl-card-head">
            <div>
              <div class="pl-card-title">运行时（Python 代码）</div>
              <div class="pl-card-desc">检查并升级 PenglaiAgent 运行时（自动备份 + 失败回滚，仅 git 安装可用）</div>
            </div>
          </div>
          <div class="pl-card-actions">
            <button class="pl-btn pl-btn-primary" id="pl-update-check"><span data-lucide="git-branch"></span>检查运行时更新</button>
            <button class="pl-btn" id="pl-update-apply" disabled><span data-lucide="arrow-up-circle"></span>一键升级运行时</button>
          </div>
          <pre class="pl-code-block" id="pl-update-output">点击"检查运行时更新"查看当前版本与远端版本。</pre>
          <p class="pl-section-hint">${cliHint('penglai update --check / penglai update --apply')}</p>
        </div>
      </div>`;
    container.querySelector('#pl-app-update-check')?.addEventListener('click', runAppUpdateCheck);
    container.querySelector('#pl-app-update-apply')?.addEventListener('click', runAppUpdateApply);
    container.querySelector('#pl-update-check')?.addEventListener('click', runUpdateCheck);
    container.querySelector('#pl-update-apply')?.addEventListener('click', runUpdateApply);
    refreshIcons();
  }

  async function runAppUpdateCheck() {
    const out = $('pl-app-update-output');
    const applyBtn = $('pl-app-update-apply');
    if (out) out.textContent = '检查中…（连接 GitHub Releases）';
    if (applyBtn) applyBtn.disabled = true;
    try {
      const result = await window.__TAURI__.core.invoke('check_app_update');
      if (result && result.has_update) {
        if (out) out.textContent = `✅ 发现新版本 ${result.version || ''}\n${result.body || ''}`;
        if (applyBtn) applyBtn.disabled = false;
      } else {
        if (out) out.textContent = '已是最新版本，无需升级。';
      }
    } catch (err) {
      if (out) out.textContent = '检查失败: ' + (err.message || err) + '\n\n可能原因：网络问题，或 GitHub Releases 尚未发布 latest.json。';
    }
  }

  async function runAppUpdateApply() {
    const out = $('pl-app-update-output');
    const applyBtn = $('pl-app-update-apply');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '下载安装中…'; }
    if (out) out.textContent = '正在下载更新包并安装，完成后将自动重启…';
    try {
      await window.__TAURI__.core.invoke('install_app_update');
      // install_app_update calls app_handle.restart() — code here may not run
      if (out) out.textContent = '更新已安装，正在重启…';
    } catch (err) {
      if (out) out.textContent = '升级失败: ' + (err.message || err);
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '一键升级桌面应用'; }
    }
  }

  async function runUpdateCheck() {
    const out = $('pl-update-output');
    const applyBtn = $('pl-update-apply');
    if (out) out.textContent = '检查中…';
    if (applyBtn) applyBtn.disabled = true;
    try {
      const data = await window.penglai.runOpsCommand('update-check');
      const text = formatOpsResult(data);
      if (out) out.textContent = text;
      const hasUpdate = /落后|新版本|new version|behind/i.test(text);
      if (applyBtn) applyBtn.disabled = !hasUpdate;
    } catch (err) {
      if (out) out.textContent = '检查失败: ' + (err.message || err);
    }
  }

  async function runUpdateApply() {
    const out = $('pl-update-output');
    const applyBtn = $('pl-update-apply');
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '升级中…'; }
    if (out) out.textContent = '升级中（预检→下载→重启→健康检查→失败自动回滚）…';
    try {
      const data = await window.penglai.runOpsCommand('update-apply', { method: 'POST', timeout: 180 });
      if (out) out.textContent = formatOpsResult(data);
      setTimeout(() => location.reload(), 2000);
    } catch (err) {
      if (out) out.textContent = '升级失败: ' + (err.message || err);
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '一键升级运行时'; }
    }
  }

  // ============================================================
  //  Security — token management (masked) + blocked notice toggle + audit
  // ============================================================
  let securityCache = { tokens: [], blockedNotice: true };

  function renderSecurity(container) {
    container.innerHTML = '<div class="pl-note">加载安全配置…</div>';
  }

  async function fetchSecurity() {
    const view = $('view-security');
    if (!view) return;
    try {
      const cfg = await window.penglai.getConfig().catch(() => null);
      if (cfg) {
        securityCache.tokens = cfg.tokens || cfg.api_keys || [];
        securityCache.blockedNotice = cfg.blocked_notice !== false;
      }
    } catch (_) { /* fall through to render with defaults */ }
    renderSecurityContent();
  }

  function renderSecurityContent() {
    const view = $('view-security');
    if (!view) return;
    const tokens = securityCache.tokens || [];
    const tokenHtml = tokens.length
      ? tokens.map((t) => `
          <div class="pl-sec-item">
            <div>
              <div class="pl-sec-name">${esc(t.name || t.label || 'Token')}</div>
              <code class="pl-mono pl-sec-value">${esc(maskToken(t.value || t.key))}</code>
            </div>
            <span class="pl-badge pl-badge-${t.valid === false ? 'error' : 'success'}">${t.valid === false ? '已失效' : '可用'}</span>
          </div>`).join('')
      : '<div class="pl-note">未检测到已配置 token（或后端未返回）</div>';
    view.innerHTML = `
      <div class="pl-security-wrap">
        <div class="pl-section">
          <div class="pl-section-title">Token 管理（脱敏显示）</div>
          <div class="pl-sec-list">${tokenHtml}</div>
          <p class="pl-section-hint">${cliHint('penglai security rotate-token / penglai security audit')}</p>
        </div>
        <div class="pl-section">
          <div class="pl-section-title">外发安全策略</div>
          <div class="pl-sec-item">
            <div>
              <div class="pl-sec-name">blocked notice</div>
              <div class="pl-sec-desc">文件外发时附加安全声明</div>
            </div>
            <label class="pl-toggle">
              <input type="checkbox" id="pl-sec-blocked-notice" ${securityCache.blockedNotice ? 'checked' : ''}>
              <span class="pl-toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="pl-section">
          <div class="pl-section-title">隐私审计</div>
          <button class="pl-btn pl-btn-primary" id="pl-sec-audit"><span data-lucide="shield"></span>运行隐私审计</button>
          <pre class="pl-code-block" id="pl-sec-audit-output">点击按钮运行审计</pre>
        </div>
      </div>`;
    view.querySelector('#pl-sec-blocked-notice')?.addEventListener('change', (e) => {
      diag('info', `blocked notice 已${e.target.checked ? '开启' : '关闭'}`);
      window.penglai.saveConfig?.({ blocked_notice: e.target.checked }).catch(() => {});
    });
    view.querySelector('#pl-sec-audit')?.addEventListener('click', runSecAudit);
    refreshIcons();
  }

  async function runSecAudit() {
    const out = $('pl-sec-audit-output');
    if (!out) return;
    out.textContent = '审计中…';
    try {
      const data = await window.penglai.runOpsCommand('privacy-audit');
      out.textContent = formatOpsResult(data);
    } catch (err) {
      out.textContent = '审计失败: ' + (err.message || err);
    }
  }

  // ============================================================
  //  Setup Dashboard (reconfigure from within running app)
  //  — NOT a first-run wizard. First-run onboarding lives in
  //    fallback.html (language select → runtime install →
  //    full setup wizard calling setup_op → bridge /setup/*).
  //  — This panel is for re-configuring individual parts after
  //    the app is already running. Each action maps to a
  //    `penglai setup --only ...` CLI command.
  // ============================================================

  function renderSetupWizard(container) {
    container.innerHTML = `
      <div class="pl-setup-dashboard">
        <div class="pl-page-hero">
          <h2>安装引导 / 重新配置</h2>
          <p>首次启动的完整向导（语言选择 → 运行时安装 → 配置）在独立窗口进行。此面板用于运行后单独重配某一项，每项均映射到 CLI 命令。</p>
        </div>

        <div class="pl-setup-section">
          <div class="pl-setup-section-head">
            <h3>1. 大模型密钥 (LLM)</h3>
            <span class="pl-setup-cli">${cliHint('penglai setup --only llm')}</span>
          </div>
          <div class="pl-setup-section-body">
            <button class="pl-btn" id="pl-setup-open-mykey"><span data-lucide="file-text"></span>打开 mykey.py 编辑</button>
            <button class="pl-btn" id="pl-setup-open-mykey-real"><span data-lucide="file"></span>打开现有 mykey.py</button>
          </div>
        </div>

        <div class="pl-setup-section">
          <div class="pl-setup-section-head">
            <h3>2. 主人身份 (Identity)</h3>
            <span class="pl-setup-cli">${cliHint('penglai setup --only identity')}</span>
          </div>
          <div class="pl-setup-section-body">
            <p class="pl-note">身份信息保存在 mykey.py 中。可直接编辑 mykey.py，或在终端运行上方 CLI 命令交互式重配。</p>
            <button class="pl-btn" id="pl-setup-open-mykey-2"><span data-lucide="file"></span>编辑 mykey.py 修改身份</button>
          </div>
        </div>

        <div class="pl-setup-section">
          <div class="pl-setup-section-head">
            <h3>3. 渠道启用 (Channels)</h3>
            <span class="pl-setup-cli">${cliHint('penglai setup --only feishu')}</span>
          </div>
          <div class="pl-setup-section-body">
            <button class="pl-btn pl-btn-primary" id="pl-setup-refresh-channels"><span data-lucide="refresh-cw"></span>加载渠道列表</button>
          </div>
          <div id="pl-channels-list-setup" class="pl-channel-grid"></div>
        </div>

        <div class="pl-setup-section">
          <div class="pl-setup-section-head">
            <h3>4. 诊断验证 (Doctor)</h3>
            <span class="pl-setup-cli">${cliHint('penglai doctor')}</span>
          </div>
          <div class="pl-setup-section-body">
            <button class="pl-btn pl-btn-primary" id="pl-setup-run-doctor"><span data-lucide="stethoscope"></span>运行体检</button>
          </div>
          <pre class="pl-code-block" id="pl-setup-doctor-output">点击"运行体检"查看结果</pre>
        </div>

        <div class="pl-setup-section">
          <div class="pl-setup-section-head">
            <h3>5. 重新走完整首次向导</h3>
          </div>
          <div class="pl-setup-section-body">
            <p class="pl-note">如需重新走完整首次安装向导（语言选择 → 运行时 → 配置），请退出蓬莱桌面后重新启动，若未检测到有效配置将自动进入向导。</p>
          </div>
        </div>
      </div>`;

    container.querySelector('#pl-setup-open-mykey')?.addEventListener('click', async () => {
      try { await window.penglai.openMykeyTemplate?.(); diag('info', '已打开 mykey.py 模板'); }
      catch (err) { fail('打开 mykey.py 模板失败', err); }
    });
    container.querySelector('#pl-setup-open-mykey-real')?.addEventListener('click', async () => {
      try { await window.penglai.openMykey?.(); }
      catch (err) { fail('打开 mykey.py 失败', err); }
    });
    container.querySelector('#pl-setup-open-mykey-2')?.addEventListener('click', async () => {
      try { await window.penglai.openMykey?.(); }
      catch (err) { fail('打开 mykey.py 失败', err); }
    });
    container.querySelector('#pl-setup-refresh-channels')?.addEventListener('click', fetchChannelsForSetup);
    container.querySelector('#pl-setup-run-doctor')?.addEventListener('click', async () => {
      const out = container.querySelector('#pl-setup-doctor-output');
      if (!out) return;
      out.textContent = '诊断中…';
      try {
        const data = await window.penglai.apiGet('/doctor');
        let text = data.all_ok ? '✅ 全部通过' : '⚠️ 有问题';
        for (const c of (data.checks || [])) text += `\n${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail || ''}`;
        out.textContent = text;
      } catch (err) { out.textContent = '失败: ' + (err.message || err); }
    });
    refreshIcons();
  }

  async function fetchChannelsForSetup() {
    const el = document.querySelector('#pl-channels-list-setup');
    if (!el) return;
    el.innerHTML = '<div class="pl-note">加载渠道…</div>';
    try {
      const data = await window.penglai.apiGet('/channels');
      const channels = (data && data.channels) || [];
      if (!channels.length) { el.innerHTML = '<div class="pl-note">暂无渠道</div>'; return; }
      el.innerHTML = channels.map((ch) => `
        <div class="pl-channel-card">
          <div class="pl-channel-head">
            <div>
              <div class="pl-channel-name">${esc(ch.name || ch.id)}</div>
              <div class="pl-channel-desc">${esc(ch.desc || '')}</div>
            </div>
            <span class="pl-badge pl-badge-${ch.configured ? (ch.running ? 'success' : 'warning') : 'muted'}">${ch.configured ? (ch.running ? '运行中' : '已配置') : '未配置'}</span>
          </div>
          <div class="pl-channel-actions">
            <button class="pl-btn pl-btn-sm ${ch.configured ? '' : 'pl-btn-primary'}" data-setup-channel="${esc(ch.id)}" data-enable="${ch.configured ? '0' : '1'}">${ch.configured ? '禁用' : '启用'}</button>
          </div>
        </div>`).join('');
      el.querySelectorAll('[data-setup-channel]').forEach((b) => b.addEventListener('click', async () => {
        const id = b.dataset.setupChannel;
        const enable = b.dataset.enable === '1';
        try {
          await window.penglai.apiPost(`/channels/${id}/${enable ? 'enable' : 'disable'}`);
          diag('info', `渠道 ${id} 已${enable ? '启用' : '禁用'}`);
          setTimeout(fetchChannelsForSetup, 800);
        } catch (err) { fail('渠道操作失败', err); }
      }));
    } catch (err) {
      el.innerHTML = `<div class="pl-note pl-note-error">加载失败: ${esc(err.message || err)}</div>`;
    }
  }

  // ============================================================
  //  Chat Workspace (SubTask 25.5)
  //  — legacy chat UI already lives in #view-chat.
  //  Mac frosted glass / Windows Mica is CSS-driven via
  //  .platform-darwin / .platform-win32 on <html> (set above).
  //  No JS rendering needed here.
  // ============================================================

  // ─── Renderer + refresher registry ─────────────────────────
  const renderers = {
    runtime: renderRuntimeRuns,
    channels: renderChannels,
    abilities: renderAbilities,
    companion: renderCompanion,
    diagnostics: renderDiagnostics,
    logs: renderLogs,
    update: renderUpdate,
    security: renderSecurity,
    setup: renderSetupWizard
  };

  const refreshers = {
    runtime: fetchRuntimeRuns,
    channels: fetchChannels,
    abilities: fetchAbilities,
    companion: fetchCompanion,
    diagnostics: () => {},
    logs: () => fetchLogs(currentLogChannel, currentLogLines),
    update: () => {},
    security: fetchSecurity,
    setup: () => {}
  };

  // ─── Init ──────────────────────────────────────────────────
  function init() {
    bindNav();
    bindQrModal();
    updateBridgeBadge(false);
    if (window.penglai) {
      window.penglai.onBridgeReady?.(() => updateBridgeBadge(true));
      window.penglai.onBridgeError?.(() => updateBridgeBadge(false));
    }
    switchView('chat');
    refreshIcons();
    diag('info', `桌面 9 模块 Shell 已初始化（${isMac ? 'Mac' : 'Windows'} 平台）`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.PenglaiDesktop9Modules = { switchView, refreshers, renderers };
})();
