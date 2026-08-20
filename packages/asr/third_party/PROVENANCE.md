# ASR third-party provenance

- `sherpa-onnx@1.13.5`: Apache-2.0; npm integrity `sha512-kq3HgrXdbYCgK44U0gd2Cpnahf7qa59caPnROI7dy1+nKou8KdAsV9yUsCScZqTewvRyR/khUS97X26KE4JRMw==`; packaged runtime reports git `3dc7c569`, ONNX Runtime `1.27.1`; upstream compatibility probe commit `3e409338959097c6518998c9b72757db257f5f6f`.
- `SenseVoiceSmall` converted int8 weights: `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` revision `2365baeacb507f821a0c8120fcee3d484dba7a07`; FunASR Model Open Source License Agreement 1.1; attribution retained as “SenseVoiceSmall by FunAudioLLM and Alibaba Group”. The pinned license text comes from `modelscope/FunASR@58830eca4012644aac0c3218c3ccc7d98f003fda` and has SHA-256 `7dba975a2069691db4992b0592d70828b330d2f8a30a71450f4e152a554e84f8`.
- Licensed recognition fixture used by the real-engine verifier: `test_wavs/zh.wav` from the same immutable SenseVoice conversion revision; expected bytes `178988`, SHA-256 `b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373`. The fixture is fetched only by an explicit verifier run and is not bundled in the installer or evidence.

The model weights and fixture remain on-demand inputs. They are never embedded in the Penglai installer, plugin tarball, logs, or evidence bundle.
