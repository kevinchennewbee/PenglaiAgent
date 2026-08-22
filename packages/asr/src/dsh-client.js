window.__ModuleLoader__.load({
  id: "@penglai/asr",
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
        throw new TypeError("ASR Remote requires bounded JSON");
      if (seen.has(value))
        throw new TypeError("ASR Remote rejects cyclic JSON");
      seen.add(value);
      const entries = Array.isArray(value) ? value : Object.entries(value);
      if (entries.length > 4096)
        throw new TypeError("ASR Remote JSON is too large");
      if (Array.isArray(value))
        value.forEach((item) => strictJson(item, depth + 1, seen));
      else
        for (const [key, item] of entries) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new TypeError("ASR Remote rejects unsafe fields");
          strictJson(item, depth + 1, seen);
        }
      seen.delete(value);
      return value;
    }
    const remoteCodec = (kind) => ({
      mode: "strict",
      typeSymbol: `@penglai/asr/client#${kind}`,
      schema: {
        parse(value) {
          if (
            kind === "input" &&
            (!value || typeof value !== "object" || Array.isArray(value))
          )
            throw new TypeError("ASR Remote input must be an object");
          return value === undefined ? value : strictJson(value);
        },
      },
    });
    const remoteDescriptor = (method, hasInput = false) => ({
      id: `@penglai/asr#penglaiAsrSettings/${method}`,
      service: "penglaiAsrSettings",
      namespace: "penglaiAsrSettings",
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
      package: "@penglai/asr",
      descriptors: [
        "describe",
        "describeModels",
        "prepareModel",
        "pauseDownload",
        "resumeDownload",
        "cancelDownload",
        "getOperation",
        "testTranscribe",
      ].map((method) =>
        remoteDescriptor(
          method,
          !["describe", "describeModels"].includes(method),
        ),
      ),
    };

    const COPY = {
      zh: {
        title: "蓬莱语音识别",
        hint: "本地 SenseVoice。先下载模型，再选一段短 WAV 试转写。转写不会自动进入对话。",
        model: "模型",
        state: "状态",
        download: "下载并校验模型",
        pause: "暂停下载",
        resume: "继续下载",
        cancel: "取消下载",
        chooseWav: "选择 WAV 试转写",
        transcribe: "转写所选音频",
        result: "转写结果",
        noSpeech: "无语音",
        language: "语言",
        emotion: "情绪",
        chars: "字数",
        loading: "正在读取语音识别状态…",
        unavailable: "语音识别服务暂时不可用。插件仍可通过 Center 查看。",
        busy: "处理中…",
        progress: "模型下载进度",
        speed: "速度",
        remaining: "已下载",
      },
      en: {
        title: "Penglai Speech Recognition",
        hint: "Local SenseVoice. Download the model first, then pick a short WAV to test. Transcription does not enter a conversation.",
        model: "Model",
        state: "State",
        download: "Download and verify model",
        pause: "Pause download",
        resume: "Resume download",
        cancel: "Cancel download",
        chooseWav: "Choose a WAV to transcribe",
        transcribe: "Transcribe selected audio",
        result: "Transcript",
        noSpeech: "No speech",
        language: "Language",
        emotion: "Emotion",
        chars: "Characters",
        loading: "Reading speech recognition status…",
        unavailable:
          "Speech recognition is temporarily unavailable. The plugin is still listed in Center.",
        busy: "Working…",
        progress: "Model download progress",
        speed: "Speed",
        remaining: "Downloaded",
      },
    };

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

    function AsrTab({ remote }) {
      const t = localeCopy();
      const api = remote?.penglaiAsrSettings;
      const [view, setView] = React.useState({
        status: "loading",
        capability: null,
        models: [],
        wavBase64: "",
        result: null,
        busy: false,
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
        Promise.all([api.describe(), api.describeModels()])
          .then(([capability, models]) => {
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
        const id = operationId("asrdl");
        setView((current) => ({ ...current, operationId: id }));
        run("prepareModel", { operationId: id });
      };
      const onFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result ?? "");
          const base64 = text.includes(",")
            ? text.slice(text.indexOf(",") + 1)
            : text;
          setView((current) => ({
            ...current,
            wavBase64: base64,
            result: null,
            error: "",
          }));
        };
        reader.readAsDataURL(file);
      };
      const transcribe = () => {
        if (!api?.testTranscribe || !view.wavBase64) return;
        setView((current) => ({
          ...current,
          busy: true,
          error: "",
          result: null,
        }));
        Promise.resolve(
          api.testTranscribe({
            wavBase64: view.wavBase64,
            operationId: operationId("asrtest"),
          }),
        )
          .then((value) => {
            setView((current) => ({
              ...current,
              busy: false,
              result: unwrapRemote(value),
            }));
          })
          .catch((error) => {
            setView((current) => ({
              ...current,
              busy: false,
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
          "data-penglai-asr": "1",
          "data-penglai-asr-status": "loading",
          children: t.loading,
        });
      }
      if (view.status === "unavailable") {
        return jsx.jsxs("section", {
          "data-penglai-asr": "1",
          "data-penglai-asr-status": "unavailable",
          children: [t.unavailable, view.error ? ` ${view.error}` : ""],
        });
      }
      return jsx.jsxs("section", {
        "data-penglai-asr": "1",
        "data-penglai-asr-status": model,
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
                "data-penglai-model-progress": "asr",
                role: "status",
                "aria-label": t.progress,
                style: { margin: "14px 0", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", background: "var(--dsw-alias-bg-module-platform)" },
                children: [
                  jsx.jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px" }, children: [jsx.jsx("strong", { children: t.progress }), jsx.jsx("span", { children: `${percent.toFixed(1)}%` })] }),
                  jsx.jsx("progress", { max: totalBytes, value: completedBytes, style: { width: "100%", marginTop: "8px", accentColor: "var(--dsw-alias-brand-primary)" } }),
                  jsx.jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "6px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" }, children: [jsx.jsx("span", { children: `${t.remaining} ${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}` }), jsx.jsx("span", { children: `${t.speed} ${formatBytes(view.bytesPerSecond)}/s` })] }),
                ],
              })
            : null,
          jsx.jsxs("label", {
            children: [
              t.chooseWav,
              " ",
              jsx.jsx("input", {
                type: "file",
                accept: "audio/wav,.wav",
                onChange: onFile,
                disabled: !ready || view.busy,
              }),
            ],
          }),
          jsx.jsx("button", {
            type: "button",
            disabled: !ready || !view.wavBase64 || view.busy,
            onClick: transcribe,
            children: t.transcribe,
          }),
          view.busy ? jsx.jsx("p", { children: t.busy }) : null,
          view.error
            ? jsx.jsx("p", {
                role: "alert",
                "data-penglai-asr-error": "1",
                children: view.error,
              })
            : null,
          view.result
            ? jsx.jsxs("div", {
                "data-penglai-asr-result": "1",
                children: [
                  jsx.jsx("h4", { children: t.result }),
                  jsx.jsx("p", {
                    children: view.result.noSpeech
                      ? t.noSpeech
                      : String(view.result.text ?? ""),
                  }),
                  jsx.jsxs("p", {
                    children: [
                      t.language,
                      ": ",
                      String(view.result.language ?? "—"),
                    ],
                  }),
                  jsx.jsxs("p", {
                    children: [
                      t.emotion,
                      ": ",
                      String(view.result.emotion ?? "—"),
                    ],
                  }),
                  jsx.jsxs("p", {
                    children: [
                      t.chars,
                      ": ",
                      String(view.result.charCount ?? 0),
                    ],
                  }),
                ],
              })
            : null,
        ],
      });
    }

    function AsrSettingsSection(props) {
      return jsx.jsx("div", {
        className: "penglai-settings-page",
        "data-penglai-settings": "asr",
        children: jsx.jsx(AsrTab, props),
      });
    }

    function writeComposerDraft(text, props) {
      if (typeof props?.inputActions?.setDraft === "function") {
        props.inputActions.setDraft(text);
        return;
      }
      const area =
        typeof document !== "undefined"
          ? document.querySelector("textarea:not([disabled])")
          : null;
      if (!area) return;
      const proto = window.HTMLTextAreaElement?.prototype;
      const setter = proto
        ? Object.getOwnPropertyDescriptor(proto, "value")?.set
        : undefined;
      if (setter) setter.call(area, text);
      else area.value = text;
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function blobToBytes(blob) {
      if (typeof blob.arrayBuffer === "function") {
        return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1)
            bytes[i] = binary.charCodeAt(i);
          resolve(bytes);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    function asciiAt(bytes, offset, length) {
      let out = "";
      for (let i = 0; i < length; i += 1)
        out += String.fromCharCode(bytes[offset + i] ?? 0);
      return out;
    }

    function isRiffWave(bytes) {
      return bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WAVE";
    }

    function u16at(bytes, offset) {
      return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
    }

    function u32at(bytes, offset) {
      return (
        (bytes[offset] |
          (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) |
          (bytes[offset + 3] << 24)) >>>
        0
      );
    }

    function isPcm16Mono16k(bytes) {
      return (
        isRiffWave(bytes) &&
        bytes.length >= 44 &&
        u16at(bytes, 20) === 1 &&
        u16at(bytes, 22) === 1 &&
        u32at(bytes, 24) === 16000 &&
        u16at(bytes, 34) === 16
      );
    }

    function u16le(n) {
      return [n & 255, (n >> 8) & 255];
    }

    function u32le(n) {
      return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    }

    function encodePcm16Wav(pcm, sampleRate) {
      const dataBytes = pcm.length * 2;
      const bytes = new Uint8Array(44 + dataBytes);
      bytes.set(
        [
          82, 73, 70, 70,
          ...u32le(36 + dataBytes),
          87, 65, 86, 69,
          102, 109, 116, 32,
          ...u32le(16),
          ...u16le(1),
          ...u16le(1),
          ...u32le(sampleRate),
          ...u32le(sampleRate * 2),
          ...u16le(2),
          ...u16le(16),
          100, 97, 116, 97,
          ...u32le(dataBytes),
        ],
        0,
      );
      for (let i = 0; i < pcm.length; i += 1) {
        const sample = Math.max(-32768, Math.min(32767, pcm[i] | 0));
        bytes[44 + i * 2] = sample & 255;
        bytes[45 + i * 2] = (sample >> 8) & 255;
      }
      return bytes;
    }

    function mixToMono(buffer) {
      const channels = Math.max(1, buffer.numberOfChannels || 1);
      const length = buffer.length;
      const mix = new Float32Array(length);
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i += 1) mix[i] += data[i] / channels;
      }
      return { samples: mix, sampleRate: buffer.sampleRate };
    }

    function resample(samples, fromRate, toRate) {
      if (fromRate === toRate) return samples;
      const outLen = Math.max(1, Math.round((samples.length * toRate) / fromRate));
      const out = new Float32Array(outLen);
      const ratio = fromRate / toRate;
      for (let i = 0; i < outLen; i += 1) {
        const src = i * ratio;
        const i0 = Math.floor(src);
        const i1 = Math.min(samples.length - 1, i0 + 1);
        const t = src - i0;
        out[i] = samples[i0] * (1 - t) + samples[i1] * t;
      }
      return out;
    }

    function floatToPcm16(samples) {
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) {
        const x = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      }
      return pcm;
    }

    function bytesToBase64(bytes) {
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1)
        binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    function decodeToPcm16Wav(bytes) {
      if (isPcm16Mono16k(bytes)) return Promise.resolve(bytes);
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (typeof Ctx !== "function") {
        return Promise.reject(new Error("AudioContext unavailable for microphone conversion"));
      }
      const ctx = new Ctx();
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return Promise.resolve(ctx.decodeAudioData(copy))
        .then((audio) => {
          const mixed = mixToMono(audio);
          const resampled = resample(mixed.samples, mixed.sampleRate, 16000);
          return encodePcm16Wav(floatToPcm16(resampled), 16000);
        })
        .finally(() => {
          if (typeof ctx.close === "function") return ctx.close();
        });
    }

    function blobToPcm16WavBase64(blob) {
      return blobToBytes(blob).then((bytes) => decodeToPcm16Wav(bytes)).then(bytesToBase64);
    }

    function AsrMicButton(props) {
      const api = props.remote?.penglaiAsrSettings;
      const [view, setView] = React.useState({
        recording: false,
        error: "",
        draft: "",
        model: "",
      });
      React.useEffect(() => {
        if (!api?.describe) {
          setView((current) => ({ ...current, error: "asr plugin unavailable", model: "unavailable" }));
          return;
        }
        Promise.resolve(api.describe())
          .then((value) => {
            const cap = unwrapRemote(value) || {};
            const model = String(cap.model ?? "not_installed");
            setView((current) => ({
              ...current,
              model,
              error:
                model === "ready"
                  ? ""
                  : model === "downloading" || model === "verifying"
                    ? "asr model downloading"
                    : model === "corrupt" || model === "failed"
                      ? "asr model failed checksum or load"
                      : "asr model not installed",
            }));
          })
          .catch((error) => {
            setView((current) => ({
              ...current,
              model: "unavailable",
              error: String(error && error.message ? error.message : error),
            }));
          });
      }, [api]);
      const recorderRef = React.useRef(null);
      const chunksRef = React.useRef([]);
      const stopRecording = () => {
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (recorder && recorder.state !== "inactive") recorder.stop();
      };
      const transcribeBlob = (blob) => {
        if (!api?.testTranscribe) return;
        blobToPcm16WavBase64(blob)
          .then((wavBase64) =>
            api.testTranscribe({
              wavBase64,
              operationId: operationId("asrmic"),
            }),
          )
          .then((value) => {
            const out = unwrapRemote(value);
            const text = String(out.text ?? "");
            writeComposerDraft(text, props);
            setView({ recording: false, error: "", draft: text });
          })
          .catch((error) => {
            setView({
              recording: false,
              error: String(error && error.message ? error.message : error),
              draft: "",
            });
          });
      };
      const toggle = () => {
        if (view.recording) {
          stopRecording();
          return;
        }
        if (view.model && view.model !== "ready") {
          setView((current) => ({
            ...current,
            error: current.error || "asr model not installed",
          }));
          return;
        }
        if (!navigator?.mediaDevices?.getUserMedia) {
          setView((current) => ({
            ...current,
            error: "microphone unavailable",
          }));
          return;
        }
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (event) => {
              if (event.data && event.data.size > 0)
                chunksRef.current.push(event.data);
            };
            recorder.onstop = () => {
              stream.getTracks().forEach((track) => track.stop());
              const blob = new Blob(chunksRef.current, {
                type: recorder.mimeType || "audio/webm",
              });
              transcribeBlob(blob);
            };
            recorderRef.current = recorder;
            recorder.start();
            setView({ recording: true, error: "", draft: "" });
          })
          .catch((error) => {
            setView({
              recording: false,
              error: String(error && error.message ? error.message : error),
              draft: "",
            });
          });
      };
      return jsx.jsx("button", {
        type: "button",
        "data-penglai-asr-mic": view.recording ? "recording" : "1",
        "data-penglai-asr-model": view.model || "unknown",
        "data-penglai-asr-draft": view.draft,
        "data-penglai-asr-mic-error": view.error || "",
        disabled: Boolean(view.model && view.model !== "ready"),
        onClick: toggle,
        children: view.error && view.model && view.model !== "ready" ? view.error : view.recording ? "stop" : "mic",
      });
    }

    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(REMOTE);
      const viewFiber = ctx.inject(
        ["slots", "remote.penglaiAsrSettings"],
        (viewCtx) => {
          const pageRemote = {
            penglaiAsrSettings: viewCtx.remote.penglaiAsrSettings,
          };
          viewCtx.slots.inject("settings.section", () =>
            viewCtx.slots.register(
              {
                name: "settings.section",
                id: "penglai-asr",
                order: 18.2,
                label: () => localeCopy().title,
                inject: () => ({ remote: pageRemote }),
              },
              AsrSettingsSection,
            ),
          );
          viewCtx.slots.inject("conversation.input.right", () =>
            viewCtx.slots.register(
              {
                name: "conversation.input.right",
                id: "penglai-asr-mic",
                order: 1,
                label: () => "mic",
                inject: () => ({ remote: pageRemote }),
              },
              AsrMicButton,
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
