// Penglai browser bridge adapter.
// HTTP is the command/data channel. WebSocket only carries small state events.
(() => {
  'use strict';

  const listeners = new Map();
  let ws = null;
  let cachedBridgeReady = null;
  const bridgeBase = `${location.protocol}//${location.hostname}:14168`;
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:14168/ws`;

  function on(channel, cb) {
    if (typeof cb !== 'function') return () => {};
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(cb);
    if (channel === 'bridge-ready' && cachedBridgeReady) {
      try { cb(cachedBridgeReady); } catch (err) { console.error('[ga-web2 listener] replay bridge-ready', err); }
    }
    return () => listeners.get(channel)?.delete(cb);
  }

  function emit(channel, payload) {
    if (channel === 'bridge-ready') cachedBridgeReady = payload;
    const set = listeners.get(channel);
    if (!set) return;
    for (const cb of Array.from(set)) {
      try { cb(payload); } catch (err) { console.error('[ga-web2 listener]', channel, err); }
    }
  }

  async function http(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const init = Object.assign({}, options, { headers });
    if (init.body && typeof init.body !== 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(`${bridgeBase}${path}`, init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || `${res.status} ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () => emit('bridge-log', '状态通道已连接'));
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.type === 'bridge-ready') {
          emit('bridge-ready', msg);
        } else if (msg.type === 'session-state') {
          emit('bridge-notification', msg);
        } else if (msg.type === 'bridge-log') {
          emit('bridge-log', msg.payload || msg);
        } else if (msg.type === 'bridge-error') {
          emit('bridge-error', msg.payload || msg);
        }
      });
      ws.addEventListener('close', () => emit('bridge-closed', { reason: 'ws-closed' }));
      ws.addEventListener('error', () => emit('bridge-error', { type: 'ws-error', message: 'WebSocket 状态通道错误' }));
    } catch (err) {
      emit('bridge-error', { type: 'ws-error', message: err.message || String(err) });
    }
  }

  async function rpc(method, params = {}) {
    switch (method) {
      case 'app/status':
        return http('/status');
      case 'app/config/get':
        return http('/config');
      case 'app/config/save':
        return http('/config', { method: 'POST', body: params || {} });
      case 'get/model-profiles':
        return http('/model-profiles');
      case 'session/new':
        return http('/session/new', { method: 'POST', body: params || {} });
      case 'session/prompt': {
        const sid = params.sessionId || params.id || params.bridgeSessionId;
        if (!sid) throw new Error('缺少对话 ID');
        return http(`/session/${encodeURIComponent(sid)}/prompt`, { method: 'POST', body: params || {} });
      }
      case 'session/poll': {
        const sid = params.sessionId || params.id || params.bridgeSessionId;
        if (!sid) throw new Error('缺少对话 ID');
        const after = params.afterId ?? params.after ?? 0;
        const limit = params.limit ?? 200;
        return http(`/session/${encodeURIComponent(sid)}/messages?after=${encodeURIComponent(after)}&limit=${encodeURIComponent(limit)}`);
      }
      case 'session/cancel': {
        const sid = params.sessionId || params.id || params.bridgeSessionId;
        if (!sid) throw new Error('缺少对话 ID');
        return http(`/session/${encodeURIComponent(sid)}/cancel`, { method: 'POST', body: params || {} });
      }
      case 'app/path/open':
        return http('/path/open', { method: 'POST', body: params || {} });
      case 'ops/commands':
        return http('/ops/commands');
      case 'ops/checks':
        return http('/ops/checks');
      case 'ops/logs': {
        const channel = encodeURIComponent(params.channel || 'feishu');
        const lines = encodeURIComponent(params.lines || 80);
        return http(`/ops/logs?channel=${channel}&lines=${lines}`);
      }
      case 'ops/command': {
        const command = params.command || params.name || '';
        if (!command) throw new Error('缺少中枢命令');
        if (params.method === 'POST') {
          return http('/ops/command', { method: 'POST', body: params || {} });
        }
        return http(`/ops/command?name=${encodeURIComponent(command)}`);
      }
      case 'runtime/status': {
        const sessionId = params.sessionId || params.session_id || '';
        const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
        return http(`/runtime/status${query}`);
      }
      case 'runtime/runs': {
        const sessionId = params.sessionId || params.session_id || '';
        const limit = encodeURIComponent(params.limit || 20);
        const parts = [`limit=${limit}`];
        if (sessionId) parts.push(`session_id=${encodeURIComponent(sessionId)}`);
        return http(`/runtime/runs?${parts.join('&')}`);
      }
      case 'app/path/selectGaRoot':
        return http('/config');
      case 'list_continuable_sessions':
        return { sessions: [] };
      case 'restore_session':
        throw new Error('当前桥接暂不支持恢复旧会话');
      default:
        throw new Error(`未知 RPC 方法：${method}`);
    }
  }

  window.ga = {
    platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32',
    bridgeUrl: bridgeBase,
    startBridge: async () => { connectWs(); return http('/status'); },
    stopBridge: async () => ({ ok: true }),
    checkStatus: () => rpc('app/status', {}),
    getConfig: () => rpc('app/config/get', {}),
    saveConfig: (cfg) => rpc('app/config/save', cfg || {}),
    getModelProfiles: () => rpc('get/model-profiles', {}),
    selectGaRoot: () => rpc('app/path/selectGaRoot', {}),
    openMykeyTemplate: () => rpc('app/path/open', { kind: 'mykeyTemplate' }),
    openMykey: () => rpc('app/path/open', { kind: 'mykey' }),
    getOpsCommands: () => rpc('ops/commands', {}),
    getOpsChecks: () => rpc('ops/checks', {}),
    getOpsLogs: (channel = 'feishu', lines = 80) => rpc('ops/logs', { channel, lines }),
    runOpsCommand: (command, options = {}) => rpc('ops/command', Object.assign({ command }, options)),
    getRuntimeStatus: (sessionId = '') => rpc('runtime/status', { sessionId }),
    getRuntimeRuns: (sessionId = '', limit = 20) => rpc('runtime/runs', { sessionId, limit }),
    pollSession: (sessionId, afterId = 0) => rpc('session/poll', { sessionId, afterId }),
    rpc,
    onBridgeMessage: (cb) => on('bridge-message', cb),
    onBridgeNotification: (cb) => on('bridge-notification', cb),
    onBridgeError: (cb) => on('bridge-error', cb),
    onBridgeClosed: (cb) => on('bridge-closed', cb),
    onBridgeReady: (cb) => on('bridge-ready', cb),
    onBridgeLog: (cb) => on('bridge-log', cb),
    onOpenSearch: (cb) => on('open-search', cb)
  };

  connectWs();
  http('/status').then(status => emit('bridge-ready', status)).catch(err => emit('bridge-error', { type: 'http-error', message: err.message || String(err) }));
})();
