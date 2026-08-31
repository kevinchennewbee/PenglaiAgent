# Penglai 0.5.9 LGPL corresponding-source offer

Penglai 0.5.9 redistributes the official DeepSeek Harness attachment runtime.
On supported native targets that runtime includes separately packaged sharp
and libvips shared-library components. The application does not modify those
components and does not prohibit replacement of the library files in an
unpacked copy made for the user's own use.

The exact upstream identities are:

- sharp 0.35.4, tag `v0.35.4`, commit
  `7f1a0a22cc285fe180766f4935d50b55af6e8432`, Apache-2.0;
- sharp-libvips packaging 1.3.3, tag `v1.3.3`, commit
  `6e5971d333377743163edc3ad9e5d0b897abcbc9`;
- libvips 8.18.6, tag `v8.18.6`, commit
  `426af3f44246fce9cfa8dd51a353aa4dfd48c553`, LGPL-2.1-or-later used under
  the upstream package's LGPL-3.0-or-later distribution choice.

The platform package's `versions.json` records the exact versions of every
prebuilt shared-library component. Its `LICENSE` and upstream
`THIRD-PARTY-NOTICES.md` identify the applicable terms, including other LGPL
libraries. These texts remain next to the packaged component and are also
represented in Penglai's generated third-party notice and SBOM.

Corresponding source and build scripts are available from the immutable tags:

- https://github.com/lovell/sharp/tree/v0.35.4
- https://github.com/lovell/sharp-libvips/tree/v1.3.3
- https://github.com/libvips/libvips/tree/v8.18.6

For each public Penglai 0.5.9 installer, the release readback must verify this
offer is included in the installed resources as `LGPL_SOURCE_OFFER.txt` and
that the packaged library license files are present. Requests for an offline
copy of the exact corresponding source can be filed in the public PenglaiAgent
repository issue tracker for at least three years after the last 0.5.9 binary
is distributed.
