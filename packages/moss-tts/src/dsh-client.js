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
        retry: "重试",
        openSettings: "打开语音合成设置",
        loading: "正在读取语音合成状态…",
        unavailable: "语音合成服务暂时不可用。插件仍可通过 Center 查看。",
        busy: "处理中…",
        progress: "模型下载进度",
        speed: "速度",
        downloaded: "已下载",
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
        retry: "Retry",
        openSettings: "Open speech settings",
        loading: "Reading speech synthesis status…",
        unavailable:
          "Speech synthesis is temporarily unavailable. The plugin is still listed in Center.",
        busy: "Working…",
        progress: "Model download progress",
        speed: "Speed",
        downloaded: "Downloaded",
      },
    };

    function createAudioPlaybackController() {
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
          held.audio.pause();
        } catch {
          /* player already closed */
        }
        URL.revokeObjectURL(held.url);
      };
      const finish = (token, next, url) => {
        if (token !== generation) return;
        if (url) URL.revokeObjectURL(url);
        current = undefined;
        emit(next);
        if (next === "completed" || next === "failed") emit("idle");
      };
      return {
        beginSynthesize() {
          generation += 1;
          emit("synthesizing");
          return generation;
        },
        async play(blob, token) {
          const used = token ?? generation;
          if (used !== generation) return { state, generation };
          release();
          emit("buffering");
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          current = { url, audio, generation: used };
          audio.onended = () => finish(used, "completed", url);
          audio.onerror = () => finish(used, "failed", url);
          try {
            emit("playing");
            await audio.play();
            return { state: used === generation ? "playing" : state, generation: used };
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
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    }
    const playback = createAudioPlaybackController();
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
          .catch((error) => {
            setView((current) => ({
              ...current,
              status: "unavailable",
              error: String(error && error.message ? error.message : error),
            }));
          });
      }, [api]);
      React.useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 2000);
        return () => clearInterval(timer);
      }, [refresh]);
      const run = (method, input) => {
        if (!api?.[method]) return;
        setView((current) => ({ ...current, busy: true, error: "" }));
        Promise.resolve(api[method](input))
          .then((value) => {
            unwrapRemote(value);
            refresh();
            setView((current) => ({ ...current, busy: false }));
          })
          .catch((error) => {
            setView((current) => ({
              ...current,
              busy: false,
              error: String(error && error.message ? error.message : error),
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
        if (playback.getState() === "playing") {
          void playback.stop();
          setView((current) => ({ ...current, playing: false, busy: false }));
          return;
        }
        const voice = (view.voices || []).find(
          (row) => row.id === view.voiceId,
        );
        const token = playback.beginSynthesize();
        setView((current) => ({
          ...current,
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
            operationId: operationId("ttsprev"),
          }),
        )
          .then(async (value) => {
            const out = unwrapRemote(value);
            const result = await playback.play(wavBlob(out.wavBase64), token);
            setView((current) => ({
              ...current,
              busy: false,
              playing: result.state === "playing",
              error:
                result.state === "failed"
                  ? result.errorCode || "TTS_PLAY_REJECTED"
                  : "",
            }));
          })
          .catch((error) => {
            void playback.stop();
            setView((current) => ({
              ...current,
              busy: false,
              playing: false,
              error: String(error && error.message ? error.message : error),
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
          children: [t.unavailable, view.error ? ` ${view.error}` : ""],
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
          jsx.jsxs("p", { children: [t.state, ": ", String(model)] }),
          (view.models || []).map((row) =>
            jsx.jsxs(
              "p",
              {
                children: [
                  t.model,
                  ": ",
                  String(row.label ?? row.id ?? ""),
                  " · ",
                  String(row.state ?? ""),
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
            disabled: !ready || view.busy,
            onClick: preview,
            children: t.preview,
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
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      const play = () => {
        const text = String(props.text ?? "").trim();
        if (!api?.readAloud || !text) return;
        if (playback.getState() === "playing") {
          void playback.stop();
          setBusy(false);
          return;
        }
        const token = playback.beginSynthesize();
        setBusy(true);
        setError("");
        Promise.resolve(
          api.readAloud({
            text,
            operationId: operationId("ttsread"),
          }),
        )
          .then(async (value) => {
            const out = unwrapRemote(value);
            const result = await playback.play(wavBlob(out.wavBase64), token);
            if (result.state === "failed") setError(result.errorCode || "TTS_PLAY_REJECTED");
          })
          .catch((err) => {
            void playback.stop();
            setError(String(err && err.message ? err.message : err));
          })
          .finally(() => setBusy(false));
      };
      return jsx.jsx("button", {
        type: "button",
        "data-penglai-tts-read": "1",
        "data-penglai-tts-read-error": error,
        title: t.readOriginal,
        "aria-label": t.readOriginal,
        disabled: busy,
        onClick: play,
        children: error ? t.retry : "read",
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
                label: () => "read-aloud",
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
