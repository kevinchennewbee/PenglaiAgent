# MOSS-TTS on UOS 20 linux-loong64

MOSS-TTS is optional and default-off. ASR WASM remains real. This is not
a required-feature cut.

## Engine availability (actual)

Pinned CPU graph runtime is `onnxruntime-node@1.23.2`. The npm package
declares `os: win32,darwin,linux` and ships `bin/napi-v6` only for:

- `darwin/arm64`, `darwin/x64`
- `win32/x64`, `win32/arm64`
- `linux/x64`, `linux/arm64`

There is no `linux/loong64` (or `linux/loongarch64`) binding. npm `1.29.0`
still has no darwin-x64 and still no loong64, so it is not a substitute.

Microsoft ONNX Runtime 1.23 does not publish an old-world LoongArch
package that matches Electron 31.7.7 / Node 20.18.0 (`NODE_MODULE_VERSION`
125) / glibc 2.28. Building ONNX Runtime plus the N-API node binding for
that ABI is a large C++ port, not a bounded local rebuild of the kind
used for Mnemon (`CGO_ENABLED=0` static Go).

No compatible engine is therefore bundled.

## Product handling

- Catalog still lists `@penglai/moss-tts` (first-party set is closed).
- `platforms` are `darwin-arm64`, `darwin-x64`, `win32-x64` only.
- Plugin Center refuses enable/install on `linux-loong64` and shows
  “Not available on this computer”.
- linux-loong64 packing does not copy `onnxruntime-node` natives or list
  that broken dependency as a packed runtime.
- Profile seed keeps moss disabled.

Do not present MOSS as enableable on UOS 20 until a hashed old-world
ONNX engine exists.
