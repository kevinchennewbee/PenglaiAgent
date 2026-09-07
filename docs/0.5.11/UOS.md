# UOS / LoongArch feasibility

Decision: **not a fourth official 0.5.11 release target**.

This environment did not provide UOS or LoongArch hardware, a signed UOS
runtime, or Landlock-equivalent sandbox evidence for that OS.

Recorded limitations:

- Official DSH npm cohort and Electron desktop packaging are proven for
  Apple Silicon, Intel Mac and Windows x64 only.
- No native helper, installer, or sandbox mapping was executed for UOS.
- Any later prototype must record runtime, native helper, sandbox, asset and
  available-device evidence separately and must not be advertised as a
  supported Penglai platform.
