# MOSS-TTS-Nano provenance

- Runtime source: `OpenMOSS/MOSS-TTS-Nano-Reader`, commit `c3b2333b88e0f062ca49d403540a169609354d93`, `extension/browser_onnx_runtime.js`.
- Model/runtime algorithm source pin: `OpenMOSS/MOSS-TTS-Nano`, commit `cc7bdf19c7639c0870dab22045a33b442760f6be`.
- Penglai Node adaptation source: public PenglaiAgent `v0.4.1` (`4f24d0bb84c385ed474e70cfdf89db32b4c49f33`). The v2 hardening replaces Node's unsupported `file:` fetch with verified-root-confined `node:fs` reads, including the official manifest's sibling codec path; final runtime SHA-256 is `b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c`.
- Modifications: `onnxruntime-node` CPU sessions replace browser WASM; verified filesystem-backed external-data paths and manifest reads replace browser byte loading; `sentencepiece-js` replaces the browser tokenizer sandbox.
- Source/runtime/model license: Apache-2.0. The pinned upstream license payload SHA-256 is `1dc6904a1959e039b44569c6a726a611f75287051284de1b6cc0dc7712b14d11`; the adjacent text adds only a terminal newline for source-tree portability.
- TTS weights: `OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX` revision `f52645cb467506d8e18e746ddd59482685b74e58`.
- Codec weights: `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX` revision `ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`.
- The model weights are downloaded only on explicit user action and are not stored in Git or bundled in installers.
