window.__ModuleLoader__.load({
  id: "@penglai/moss-tts",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const inject = ["remote"];

    function strictJson(value, depth = 0, seen = new Set()) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (
        depth > 12 ||
        !value ||
        typeof value !== "object" ||
        (!Array.isArray(value) &&
          Object.prototype.toString.call(value) !== "[object Object]")
      )
        throw new TypeError("TTS Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("TTS Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("TTS Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("TTS Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/moss-tts/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("TTS Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const remoteDescriptor = (method, hasInput = false) => ({
      id: `@penglai/moss-tts#penglaiMossTtsSettings/${method}`,
      service: "penglaiMossTtsSettings",
      namespace: "penglaiMossTtsSettings",
      method,
      implementation: method,
      invocation: { kind: "direct" },
      parameters: hasInput
        ? [
            {
              name: "input",
              wire: "input",
              source: "json",
              codec: remoteCodec("input"),
            },
          ]
        : [],
      result: remoteCodec("result"),
    });
    const REMOTE = {
      package: "@penglai/moss-tts",
      descriptors: [
        "describe",
        "describeModels",
        "listVoices",
        "prepareModel",
        "pauseDownload",
        "resumeDownload",
        "cancelDownload",
        "getOperation",
        "cancelSynthesis",
        "previewVoice",
        "readAloud",
      ].map((method) =>
        remoteDescriptor(
          method,
          !["describe", "describeModels", "listVoices"].includes(method),
        ),
      ),
    };

    const COPY = {
      zh: {
        title: "蓬莱语音合成",
        hint: "本地 MOSS-TTS-Nano。先下载模型，再选一个内置声音试听。试听使用固定短句，不会读取对话正文。",
        model: "模型",
        state: "状态",
        voice: "声音",
        download: "下载并校验模型",
        pause: "暂停下载",
        resume: "继续下载",
        cancel: "取消下载",
        preview: "试听所选声音",
        playing: "正在播放试听…",
        readOriginal: "朗读原文",
        stopPlayback: "停止朗读",
        queuedPlayback: "等待语音合成",
        synthesizingPlayback: "正在生成语音",
        bufferingPlayback: "语音已生成，正在准备播放",
        endedPlayback: "朗读完成",
        stoppedPlayback: "朗读已停止",
        failedPlayback: "朗读失败",
        stalledPlayback: "播放停滞，请重试",
        retry: "重试",
        openSettings: "打开语音合成设置",
        loading: "正在读取语音合成状态…",
        unavailable: "语音合成服务暂时不可用。插件仍可通过 Center 查看。",
        busy: "处理中…",
        progress: "模型下载进度",
        speed: "速度",
        downloaded: "已下载",
        operationFailed: "操作未完成。请刷新状态后重试。",
        diagnosticReference: "诊断参考号",
        modelStates: {
          ready: "已就绪",
          not_installed: "未安装",
          downloading: "正在下载",
          paused: "已暂停",
          failed: "需要重试",
          corrupt: "校验失败",
          loading: "正在加载",
          unavailable: "暂不可用",
          unknown: "等待状态",
        },
      },
      en: {
        title: "Penglai Speech Synthesis",
        hint: "Local MOSS-TTS-Nano. Download the model first, then preview a built-in voice. Preview uses a fixed phrase and never reads conversation text.",
        model: "Model",
        state: "State",
        voice: "Voice",
        download: "Download and verify model",
        pause: "Pause download",
        resume: "Resume download",
        cancel: "Cancel download",
        preview: "Preview selected voice",
        playing: "Playing preview…",
        readOriginal: "Read original text",
        stopPlayback: "Stop reading",
        queuedPlayback: "Waiting for speech synthesis",
        synthesizingPlayback: "Generating speech",
        bufferingPlayback: "Speech is ready; preparing playback",
        endedPlayback: "Reading complete",
        stoppedPlayback: "Reading stopped",
        failedPlayback: "Reading failed",
        stalledPlayback: "Playback stalled; retry",
        retry: "Retry",
        openSettings: "Open speech settings",
        loading: "Reading speech synthesis status…",
        unavailable:
          "Speech synthesis is temporarily unavailable. The plugin is still listed in Center.",
        busy: "Working…",
        progress: "Model download progress",
        speed: "Speed",
        downloaded: "Downloaded",
        operationFailed: "The operation did not complete. Refresh the status and retry.",
        diagnosticReference: "Diagnostic reference",
        modelStates: {
          ready: "Ready",
          not_installed: "Not installed",
          downloading: "Downloading",
          paused: "Paused",
          failed: "Retry required",
          corrupt: "Verification failed",
          loading: "Loading",
          unavailable: "Unavailable",
          unknown: "Waiting for status",
        },
      },
    };

    function createAudioPlaybackController(io) {
      const media = io || {
        Audio,
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
      };
      let generation = 0;
      let state = "idle";
      let current;
      const listeners = new Set();
      const emit = (next) => {
        state = next;
        listeners.forEach((fn) => fn(state));
      };
      const release = () => {
        const held = current;
        current = undefined;
        if (!held) return;
        try {
          held.audio.onended = null;
          held.audio.onerror = null;
          held.audio.onstalled = null;
          held.audio.onabort = null;
          held.audio.pause();
        } catch {
          /* player already closed */
        }
        media.revokeObjectURL(held.url);
      };
      const finish = (token, next, url) => {
        if (token !== generation || current?.generation !== token) return;
        if (url) media.revokeObjectURL(url);
        current = undefined;
        emit(next);
      };
      return {
        beginSynthesize() {
          generation += 1;
          release();
          emit("synthesizing");
          return generation;
        },
        async play(blob, token) {
          const used = token ?? generation;
          if (used !== generation) return { state, generation };
          release();
          emit("buffering");
          const url = media.createObjectURL(blob);
          const audio = new media.Audio(url);
          current = { url, audio, generation: used };
          audio.onended = () => finish(used, "completed", url);
          audio.onerror = () => finish(used, "failed", url);
          audio.onstalled = () => finish(used, "stalled", url);
          audio.onabort = () => finish(used, "failed", url);
          try {
            await audio.play();
            if (used !== generation || current?.generation !== used)
              return { state, generation };
            emit("playing");
            return { state: "playing", generation: used };
          } catch {
            finish(used, "failed", url);
            return { state: "failed", generation: used, errorCode: "TTS_PLAY_REJECTED" };
          }
        },
        async stop() {
          generation += 1;
          emit("stopping");
          release();
          emit("idle");
        },
        getState() {
          return state;
        },
        getGeneration() {
          return generation;
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    }
    const playback = createAudioPlaybackController();
    let activeSynthesis = null;
    function claimSynthesis(api, operationId) {
      const previous = activeSynthesis;
      activeSynthesis = { api, operationId };
      if (
        previous &&
        previous.operationId !== operationId &&
        previous.api?.cancelSynthesis
      ) {
        void Promise.resolve(
          previous.api.cancelSynthesis({
            operationId: previous.operationId,
          }),
        ).catch(() => undefined);
      }
    }
    function releaseSynthesis(operationId) {
      if (activeSynthesis?.operationId === operationId) activeSynthesis = null;
    }
    function cancelSynthesis(api, operationId) {
      releaseSynthesis(operationId);
      if (!operationId || !api?.cancelSynthesis) return;
      void Promise.resolve(api.cancelSynthesis({ operationId })).catch(
        () => undefined,
      );
    }
    function wavBlob(wavBase64) {
      const binary = atob(String(wavBase64 ?? ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: "audio/wav" });
    }

    function localeCopy() {
      const id = String(document.documentElement.lang ?? "zh");
      return COPY[id.startsWith("en") ? "en" : "zh"];
    }

    function modelStateText(value, t) {
      return t.modelStates[String(value || "unknown")] || t.modelStates.unknown;
    }

    function unwrapRemote(result) {
      if (result && typeof result === "object" && "ok" in result) {
        if (result.ok === false)
          throw new Error((result.error && result.error.message) || "remote");
        return result.value;
      }
      return result;
    }

    function operationId(prefix) {
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function formatBytes(value) {
      const bytes = Number(value) || 0;
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    function MossTtsTab({ remote }) {
      const t = localeCopy();
      const api = remote?.penglaiMossTtsSettings;
      const [view, setView] = React.useState({
        status: "loading",
        capability: null,
        models: [],
        voices: [],
        voiceId: "moss-zh-default",
        busy: false,
        playing: false,
        error: "",
        operationId: "",
        synthesisOperationId: "",
        playbackGeneration: 0,
        bytesPerSecond: 0,
        progressSample: null,
      });
      const refresh = React.useCallback(() => {
        if (!api?.describe) {
          setView((current) => ({ ...current, status: "unavailable" }));
          return;
        }
        Promise.all([api.describe(), api.describeModels(), api.listVoices()])
          .then(([capability, models, voices]) => {
            const list = unwrapRemote(voices) ?? [];
            const rows = unwrapRemote(models) ?? [];
            const operation = rows.map((row) => row.operation).find(Boolean);
            const sampledAt = Date.now();
            setView((current) => {
              const previous = current.progressSample;
              const elapsed = previous && operation && previous.operationId === operation.operationId
                ? sampledAt - previous.sampledAt
                : 0;
              const delta = previous && operation ? Number(operation.completedBytes) - previous.completedBytes : 0;
              return {
                ...current,
                status: "ready",
                capability: unwrapRemote(capability),
                models: rows,
                voices: list,
                voiceId: list.some((row) => row.id === current.voiceId)
                  ? current.voiceId
                  : (list[0]?.id ?? "moss-zh-default"),
                operationId: operation?.operationId ?? current.operationId,
                bytesPerSecond: elapsed > 0 && delta >= 0 ? Math.round((delta * 1000) / elapsed) : current.bytesPerSecond,
                progressSample: operation ? { operationId: operation.operationId, completedBytes: Number(operation.completedBytes) || 0, sampledAt } : null,
                error: "",
              };
            });
          })
          .catch(() => {
            setView((current) => ({
              ...current,
              status: "unavailable",
              error: "",
            }));
          });
      }, [api]);
      React.useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 2000);
        return () => clearInterval(timer);
      }, [refresh]);
      React.useEffect(
        () =>
          playback.subscribe((state) => {
            setView((current) => {
              const owns =
                current.playbackGeneration > 0 &&
                current.playbackGeneration === playback.getGeneration();
              if (!owns) {
                return current.synthesisOperationId || current.playing
                  ? {
                      ...current,
                      synthesisOperationId: "",
                      playbackGeneration: 0,
                      playing: false,
                      busy: false,
                    }
                  : current;
              }
              return { ...current, playing: state === "playing" };
            });
          }),
        [],
      );
      const run = (method, input) => {
        if (!api?.[method]) return;
        setView((current) => ({ ...current, busy: true, error: "" }));
        Promise.resolve(api[method](input))
          .then((value) => {
            unwrapRemote(value);
            refresh();
            setView((current) => ({ ...current, busy: false }));
          })
          .catch(() => {
            setView((current) => ({
              ...current,
              busy: false,
              error: t.operationFailed,
            }));
          });
      };
      const beginDownload = () => {
        const id = operationId("ttsdl");
        setView((current) => ({ ...current, operationId: id }));
        run("prepareModel", { operationId: id });
      };
      const preview = () => {
        if (!api?.previewVoice) return;
        if (
          view.synthesisOperationId ||
          ["buffering", "playing"].includes(playback.getState())
        ) {
          cancelSynthesis(api, view.synthesisOperationId);
          void playback.stop();
          setView((current) => ({
            ...current,
            synthesisOperationId: "",
            playbackGeneration: 0,
            playing: false,
            busy: false,
          }));
          return;
        }
        const voice = (view.voices || []).find(
          (row) => row.id === view.voiceId,
        );
        const id = operationId("ttsprev");
        claimSynthesis(api, id);
        const token = playback.beginSynthesize();
        setView((current) => ({
          ...current,
          synthesisOperationId: id,
          playbackGeneration: token,
          busy: true,
          playing: false,
          error: "",
        }));
        Promise.resolve(
          api.previewVoice({
            voiceId: view.voiceId,
            locale:
              voice?.locale === "en" || voice?.locale === "ja"
                ? voice.locale
                : "zh",
            operationId: id,
          }),
        )
          .then(async (value) => {
            releaseSynthesis(id);
            if (playback.getGeneration() !== token) return;
            const out = unwrapRemote(value);
            const result = await playback.play(wavBlob(out.wavBase64), token);
            if (playback.getGeneration() !== token) return;
            setView((current) => ({
              ...current,
              synthesisOperationId: "",
              busy: false,
              playing: result.state === "playing",
              error:
                result.state === "failed"
                  ? t.failedPlayback
                  : "",
            }));
          })
          .catch(() => {
            releaseSynthesis(id);
            if (playback.getGeneration() !== token) return;
            void playback.stop();
            setView((current) => ({
              ...current,
              synthesisOperationId: "",
              playbackGeneration: 0,
              busy: false,
              playing: false,
              error: t.failedPlayback,
            }));
          });
      };
      const model = view.capability?.model ?? "unknown";
      const operation = (view.models || []).map((row) => row.operation).find(Boolean);
      const activeOperationId = operation?.operationId ?? view.operationId;
      const totalBytes = Number(operation?.totalBytes ?? 0);
      const completedBytes = Number(operation?.completedBytes ?? 0);
      const percent = totalBytes > 0 ? Math.min(100, Math.max(0, (completedBytes / totalBytes) * 100)) : 0;
      const ready = model === "ready";
      if (view.status === "loading") {
        return jsx.jsx("section", {
          "data-penglai-tts": "1",
          "data-penglai-tts-status": "loading",
          children: t.loading,
        });
      }
      if (view.status === "unavailable") {
        return jsx.jsxs("section", {
          "data-penglai-tts": "1",
          "data-penglai-tts-status": "unavailable",
          children: t.unavailable,
        });
      }
      return jsx.jsxs("section", {
        "data-penglai-tts": "1",
        "data-penglai-tts-status": model,
        role: "region",
        "aria-label": t.title,
        children: [
          jsx.jsx("h3", { children: t.title }),
          jsx.jsx("p", { children: t.hint }),
          jsx.jsxs("p", { children: [t.state, ": ", modelStateText(model, t)] }),
          (view.models || []).map((row) =>
            jsx.jsxs(
              "p",
              {
                children: [
                  t.model,
                  ": ",
                  String(row.label ?? row.id ?? ""),
                  " · ",
                  modelStateText(row.state, t),
                ],
              },
              String(row.id ?? "model"),
            ),
          ),
          jsx.jsxs("div", {
            children: [
              model === "not_installed" ||
              model === "failed" ||
              model === "corrupt"
                ? jsx.jsx("button", {
                    type: "button",
                    disabled: view.busy,
                    onClick: beginDownload,
                    children: t.download,
                  })
                : null,
              model === "downloading"
                ? jsx.jsx("button", {
                    type: "button",
                    disabled: !activeOperationId,
                    onClick: () => run("pauseDownload", { operationId: activeOperationId }),
                    children: t.pause,
                  })
                : null,
              model === "paused"
                ? jsx.jsx("button", {
                    type: "button",
                    disabled: !activeOperationId,
                    onClick: () => run("resumeDownload", { operationId: activeOperationId }),
                    children: t.resume,
                  })
                : null,
              model === "downloading" || model === "paused"
                ? jsx.jsx("button", {
                    type: "button",
                    disabled: !activeOperationId,
                    onClick: () => run("cancelDownload", { operationId: activeOperationId }),
                    children: t.cancel,
                  })
                : null,
            ],
          }),
          operation && totalBytes > 0
            ? jsx.jsxs("div", {
                "data-penglai-model-progress": "moss-tts",
                role: "status",
                "aria-label": t.progress,
                style: { margin: "14px 0", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", background: "var(--dsw-alias-bg-module-platform)" },
                children: [
                  jsx.jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px" }, children: [jsx.jsx("strong", { children: t.progress }), jsx.jsx("span", { children: `${percent.toFixed(1)}%` })] }),
                  jsx.jsx("progress", { max: totalBytes, value: completedBytes, style: { width: "100%", marginTop: "8px", accentColor: "var(--dsw-alias-brand-primary)" } }),
                  jsx.jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "6px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" }, children: [jsx.jsx("span", { children: `${t.downloaded} ${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}` }), jsx.jsx("span", { children: `${t.speed} ${formatBytes(view.bytesPerSecond)}/s` })] }),
                ],
              })
            : null,
          operation?.state === "failed" && operation?.referenceId
            ? jsx.jsxs("p", {
                "data-penglai-tts-reference": "1",
                children: [t.diagnosticReference, ": ", String(operation.referenceId)],
              })
            : null,
          jsx.jsxs("label", {
            children: [
              t.voice,
              " ",
              jsx.jsx("select", {
                value: view.voiceId,
                disabled: !ready || view.busy,
                onChange: (event) =>
                  setView((current) => ({
                    ...current,
                    voiceId: event.target.value,
                  })),
                children: (view.voices || []).map((row) =>
                  jsx.jsx(
                    "option",
                    { value: row.id, children: row.displayName || row.id },
                    row.id,
                  ),
                ),
              }),
            ],
          }),
          jsx.jsx("button", {
            type: "button",
            disabled: !ready || (view.busy && !view.synthesisOperationId),
            onClick: preview,
            children:
              view.synthesisOperationId || view.playing
                ? t.stopPlayback
                : t.preview,
          }),
          view.busy ? jsx.jsx("p", { children: t.busy }) : null,
          view.playing ? jsx.jsx("p", { children: t.playing }) : null,
          view.error
            ? jsx.jsx("p", {
                role: "alert",
                "data-penglai-tts-error": "1",
                children: view.error,
              })
            : null,
        ],
      });
    }

    function MossTtsSettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "moss-tts",
        children: jsx.jsx(MossTtsTab, props),
      });
    }

    function TtsReadButton(props) {
      const api = props.remote?.penglaiMossTtsSettings;
      const t = localeCopy();
      const [view, setView] = React.useState({
        phase: "idle",
        error: "",
        operationId: "",
        requestedAt: 0,
        responseAt: 0,
        playbackStartedAt: 0,
        firstChunkLatencyMs: 0,
        synthesisElapsedMs: 0,
      });
      const generationRef = React.useRef(0);
      const operationRef = React.useRef("");
      const phaseRef = React.useRef("idle");
      const pollTimerRef = React.useRef(null);
      const disposedRef = React.useRef(false);
      phaseRef.current = view.phase;
      const clearOperationPoll = () => {
        if (pollTimerRef.current !== null) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
      const ownsPlayback = () =>
        generationRef.current > 0 &&
        playback.getGeneration() === generationRef.current;
      React.useEffect(() => {
        disposedRef.current = false;
        const unsubscribe = playback.subscribe((state) => {
          if (!ownsPlayback()) {
            setView((current) =>
              ["queued", "synthesizing", "buffering", "playing"].includes(
                current.phase,
              )
                ? { ...current, phase: "stopped", error: "" }
                : current,
            );
            return;
          }
          setView((current) => {
            if (state === "buffering")
              return { ...current, phase: "buffering", error: "" };
            if (state === "playing")
              return {
                ...current,
                phase: "playing",
                error: "",
                playbackStartedAt: Date.now(),
              };
            if (state === "completed")
              return { ...current, phase: "ended", error: "" };
            if (state === "stalled")
              return {
                ...current,
                phase: "stalled",
                error: t.stalledPlayback,
              };
            if (state === "failed")
              return {
                ...current,
                phase: "error",
                error: t.failedPlayback,
              };
            return current;
          });
        });
        return () => {
          disposedRef.current = true;
          clearOperationPoll();
          const operationId = operationRef.current;
          if (
            operationId &&
            ["queued", "synthesizing"].includes(phaseRef.current)
          ) {
            cancelSynthesis(api, operationId);
          }
          if (ownsPlayback()) void playback.stop();
          unsubscribe();
        };
      }, [api, t]);
      const stop = () => {
        const operationId = operationRef.current;
        clearOperationPoll();
        generationRef.current = 0;
        operationRef.current = "";
        setView((current) => ({ ...current, phase: "stopped", error: "" }));
        void playback.stop();
        if (
          operationId &&
          ["queued", "synthesizing"].includes(phaseRef.current)
        ) {
          cancelSynthesis(api, operationId);
        }
      };
      const play = () => {
        const text = String(props.text ?? "").trim();
        if (!api?.readAloud || !text) return;
        if (
          ["queued", "synthesizing", "buffering", "playing"].includes(
            phaseRef.current,
          )
        ) {
          stop();
          return;
        }
        const id = operationId("ttsread");
        claimSynthesis(api, id);
        const token = playback.beginSynthesize();
        generationRef.current = token;
        operationRef.current = id;
        const requestedAt = Date.now();
        setView({
          phase: "queued",
          error: "",
          operationId: id,
          requestedAt,
          responseAt: 0,
          playbackStartedAt: 0,
          firstChunkLatencyMs: 0,
          synthesisElapsedMs: 0,
        });
        if (api.getOperation) {
          const refreshOperation = () => {
            Promise.resolve(api.getOperation({ operationId: id }))
              .then((value) => {
                if (
                  disposedRef.current ||
                  generationRef.current !== token ||
                  operationRef.current !== id
                )
                  return;
                const operation = unwrapRemote(value);
                if (operation?.state === "running") {
                  setView((current) => ({
                    ...current,
                    phase: "synthesizing",
                  }));
                }
              })
              .catch(() => undefined);
          };
          refreshOperation();
          pollTimerRef.current = setInterval(refreshOperation, 250);
        }
        Promise.resolve(
          api.readAloud({
            text,
            operationId: id,
          }),
        )
          .then(async (value) => {
            releaseSynthesis(id);
            if (
              disposedRef.current ||
              generationRef.current !== token ||
              operationRef.current !== id
            )
              return;
            clearOperationPoll();
            const out = unwrapRemote(value);
            setView((current) => ({
              ...current,
              phase: "buffering",
              responseAt: Date.now(),
              firstChunkLatencyMs: Number(out.firstChunkLatencyMs) || 0,
              synthesisElapsedMs: Number(out.synthesisElapsedMs) || 0,
            }));
            const result = await playback.play(wavBlob(out.wavBase64), token);
            if (
              disposedRef.current ||
              generationRef.current !== token ||
              operationRef.current !== id
            )
              return;
            if (result.state === "failed") {
              setView((current) => ({
                ...current,
                phase: "error",
                error: t.failedPlayback,
              }));
            }
          })
          .catch(() => {
            releaseSynthesis(id);
            if (
              disposedRef.current ||
              generationRef.current !== token ||
              operationRef.current !== id
            )
              return;
            clearOperationPoll();
            void playback.stop();
            setView((current) => ({
              ...current,
              phase: "error",
              error: t.failedPlayback,
            }));
          });
      };
      const active = ["queued", "synthesizing", "buffering", "playing"].includes(
        view.phase,
      );
      const label = view.phase === "queued"
        ? t.queuedPlayback
        : view.phase === "synthesizing"
          ? t.synthesizingPlayback
          : view.phase === "buffering"
            ? t.bufferingPlayback
            : view.phase === "playing"
              ? t.stopPlayback
              : view.phase === "ended"
                ? t.endedPlayback
                : view.phase === "stopped"
                  ? t.stoppedPlayback
                  : view.phase === "stalled"
                    ? t.stalledPlayback
                    : view.phase === "error"
                      ? `${t.failedPlayback} · ${t.retry}`
                      : t.readOriginal;
      const accessibleLabel =
        active && view.phase !== "playing"
          ? `${label} · ${t.stopPlayback}`
          : label;
      return jsx.jsxs("button", {
        type: "button",
        "data-penglai-tts-read": "1",
        "data-penglai-tts-read-state": view.phase,
        "data-penglai-tts-read-error": view.error,
        "data-penglai-tts-operation": view.operationId,
        "data-penglai-tts-requested-at": view.requestedAt,
        "data-penglai-tts-response-at": view.responseAt,
        "data-penglai-tts-playback-started-at": view.playbackStartedAt,
        "data-penglai-tts-first-chunk-ms": view.firstChunkLatencyMs,
        "data-penglai-tts-synthesis-ms": view.synthesisElapsedMs,
        title: active ? t.stopPlayback : label,
        "aria-label": accessibleLabel,
        "aria-live": "polite",
        "aria-pressed": view.phase === "playing",
        disabled: !String(props.text ?? "").trim(),
        onClick: active ? stop : play,
        children: [
          jsx.jsx("span", {
            "aria-hidden": "true",
            children: active ? "■" : "▶",
          }),
          " ",
          label,
        ],
      });
    }

    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiMossTtsSettings"],
        (viewCtx) => {
          const pageRemote = {
            penglaiMossTtsSettings: viewCtx.remote.penglaiMossTtsSettings,
          };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-moss-tts",
                order: 18.3,
                label: () => localeCopy().title,
                inject: () => ({ remote: pageRemote }),
              },
              MossTtsSettingsSection,
            ),
          );
          viewCtx.slots.inject("conversation.chat.assistant-actions", () =>
            viewCtx.slots.register(
              {
                name: "conversation.chat.assistant-actions",
                id: "penglai-moss-tts-read",
                order: 1,
                label: () => localeCopy().readOriginal,
                inject: () => ({ remote: pageRemote }),
              },
              TtsReadButton,
            ),
          );
        },
      );
      try {
        await viewFiber;
      } catch (error) {
        await disposeRemote();
        throw error;
      }
      return async () => {
        await viewFiber.dispose();
        await disposeRemote();
      };
    }

    module.exports = { apply, inject };
    return module.exports;
  },
});
