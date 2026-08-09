# Penglai Host Runtime (generated resource)

This directory is an application resource. It is complete and immutable:

- `bin/node` (or `bin/node.exe`) is the target-matching Node runtime;
- `src/cli.js` is the compiled Penglai Host entry;
- `node_modules/` is the exact production dependency closure;
- `manifest.json` records compatibility and SHA-256 for every payload file.

Start it only through the Penglai Desktop shell. The generated manifest carries
the exact platform entry command used by verification and diagnostics.

Python, a system Node installation, npm, and a source checkout are not used.
