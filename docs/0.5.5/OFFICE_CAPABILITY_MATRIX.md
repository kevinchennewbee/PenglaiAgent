# Penglai Office capability matrix (0.5.5 source)

| Format | Create | Inspect | Partial edit | Verify | Engine |
|---|---|---|---|---|---|
| DOCX | `docx` 9.7.1 | zip XML + Mammoth 1.12.1 | primary `word/document.xml` splice, extra parts kept | job digest | `@penglai/office` |
| XLSX | ExcelJS 4.4.0 | ExcelJS values/formulas | cell write via ExcelJS | `#REF!` check | `@penglai/office` |
| PPTX | pptfast `generatePptx` when IR validates, otherwise DrawingML zip | zip XML | first slide splice, extra parts kept | job digest | `@liustack/pptfast` 0.20.0 internally |
| PDF | pdf-lib + CJK UTF-16BE incremental stream | pdf-lib page count + text extract | pdf-lib drawText or incremental stream | job digest | pdf-lib 1.17.1 |

Univer Pro is not shipped. Templates are generated IR, not binary black boxes. Preview is a text artifact pending owner receipt; visual installed sampling is not this source gate.
