# Penglai Office capability matrix (0.5.5 source)

| Format | Create | Inspect | Typed edit | Independent verify | Honest limits |
|---|---|---|---|---|---|
| DOCX | `docx` 9.7.1 | paragraph XML + Mammoth 1.12.1 | `docx.replaceParagraph` by index | LibreOffice headless when present | Macros, content-controls, and unsafe XML rewrite are refused |
| XLSX | ExcelJS 4.4.0 | sheet/cell/formula values | `xlsx.setCell` `{sheet?, cell, value}` | LibreOffice headless when present | Macros, external links, protected workbooks refused. No A999 dump |
| PPTX | `@liustack/pptfast` 0.20.0 only | slide XML text runs | `pptx.replaceSlideText` first `a:t` on a numbered slide | LibreOffice headless when present | Homemade OOXML zip is not shipped. Complex decks may be inspect-only |
| PDF | pdf-lib latin Helvetica | metadata + page count + latin literals | `pdf.watermark` / rotate / merge | Poppler `pdfinfo`/`pdftotext` | CJK body text is **not** embedded. No Word-style paragraph edit |

Univer Pro is not shipped. Capability receipts are HMAC-bound to jobId, source digest, operation digest, workspace, and expiry. Preview is a structured inventory/diff from staged bytes, not a 2000-character slice. LibreOffice is an external verifier, not a runtime dependency.
