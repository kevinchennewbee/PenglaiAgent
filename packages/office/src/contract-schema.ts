import type { JsonSchemaNode } from "@deepseek-ai/dsh-tools";
import { OFFICE_TEMPLATES } from "./templates/catalog.js";

export const OFFICE_FORMATS = ["docx", "xlsx", "pptx", "pdf"] as const;
export const OFFICE_TEMPLATE_IDS = OFFICE_TEMPLATES.map((row) => row.id);

export const DOCX_CREATE_SPEC_KEYS = ["format", "title", "sections"] as const;
export const XLSX_CREATE_SPEC_KEYS = ["format", "sheets"] as const;
export const PPTX_CREATE_SPEC_KEYS = ["format", "title", "theme", "slides"] as const;
export const PDF_CREATE_SPEC_KEYS = ["format", "title", "paragraphs"] as const;
export const OFFICE_CREATE_SPEC_KEYS = [
  "format",
  "title",
  "theme",
  "sections",
  "sheets",
  "slides",
  "paragraphs",
] as const;
export const OFFICE_CREATE_INPUT_KEYS = ["format", "text", "template_id", "spec"] as const;

export const OFFICE_OPERATION_KIND_KEYS = {
  "docx.replaceParagraph": ["kind", "paragraphIndex", "text"],
  "docx.insertParagraph": ["kind", "paragraphIndex", "position", "text"],
  "docx.appendParagraph": ["kind", "text"],
  "docx.replaceTableCell": ["kind", "tableIndex", "rowIndex", "cellIndex", "text"],
  "xlsx.setCell": ["kind", "sheet", "cell", "value", "formula"],
  "xlsx.setRange": ["kind", "sheet", "startCell", "values"],
  "xlsx.appendRows": ["kind", "sheet", "values"],
  "pptx.replaceSlideText": ["kind", "slideIndex", "runIndex", "text"],
  "pdf.watermark": ["kind", "text"],
  "pdf.rotate": ["kind", "degrees"],
} as const;

const formatSchema: JsonSchemaNode = {
  type: "string",
  enum: [...OFFICE_FORMATS],
  description: "Office format discriminator. Required inside structured spec.",
};

const nonEmptyString: JsonSchemaNode = {
  type: "string",
  description: "Non-empty string; runtime parser enforces length bounds.",
};

const indexInteger: JsonSchemaNode = {
  type: "integer",
  description: "Non-negative integer index; runtime parser enforces bounds.",
};

const officeScalar: JsonSchemaNode = {
  description: "Spreadsheet cell scalar.",
  oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
};

const stringList: JsonSchemaNode = {
  type: "array",
  items: nonEmptyString,
};

const docxTable: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    headers: stringList,
    rows: { type: "array", items: stringList },
  },
};

const docxSection: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  properties: {
    heading: nonEmptyString,
    paragraphs: stringList,
    bullets: stringList,
    table: docxTable,
  },
};

const xlsxSheet: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  required: ["name", "rows"],
  properties: {
    name: nonEmptyString,
    rows: { type: "array", items: { type: "array", items: officeScalar } },
    header: { type: "boolean" },
    columnWidths: { type: "array", items: { type: "number" } },
  },
};

const pptxSlide: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "heading"],
  properties: {
    kind: { type: "string", enum: ["cover", "content", "ending"] },
    heading: nonEmptyString,
    subheading: nonEmptyString,
    bullets: stringList,
    notes: nonEmptyString,
  },
};

export const OFFICE_CREATE_SPEC_SCHEMA: JsonSchemaNode = {
  description:
    "Closed typed create spec. format is required inside spec and selects the remaining fields. Unknown fields are rejected.",
  oneOf: [
    {
      title: "DOCX spec",
      type: "object",
      additionalProperties: false,
      required: ["format", "sections"],
      properties: {
        format: { type: "string", const: "docx" },
        title: nonEmptyString,
        sections: { type: "array", items: docxSection, description: "1-40 sections; each needs heading, paragraphs, bullets, or table." },
      },
    },
    {
      title: "XLSX spec",
      type: "object",
      additionalProperties: false,
      required: ["format", "sheets"],
      properties: {
        format: { type: "string", const: "xlsx" },
        sheets: { type: "array", items: xlsxSheet, description: "1-20 uniquely named sheets." },
      },
    },
    {
      title: "PPTX spec",
      type: "object",
      additionalProperties: false,
      required: ["format", "slides"],
      properties: {
        format: { type: "string", const: "pptx" },
        title: nonEmptyString,
        theme: { type: "string", enum: ["consulting", "tech", "minimal"] },
        slides: { type: "array", items: pptxSlide, description: "1-80 slides. bullets are valid only on content slides." },
      },
    },
    {
      title: "PDF spec",
      type: "object",
      additionalProperties: false,
      required: ["format", "paragraphs"],
      properties: {
        format: { type: "string", const: "pdf" },
        title: nonEmptyString,
        paragraphs: { type: "array", items: nonEmptyString, description: "1-200 paragraphs." },
      },
    },
  ],
};

export const OFFICE_CREATE_PARAMETERS_SCHEMA: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  description:
    "Provider-facing object root. Exactly one create pathway is valid at runtime: format+text, template_id, or structured spec. Do not send body aliases. spec.format is the discriminator for structured create. Nested spec remains a closed typed union.",
  properties: {
    format: formatSchema,
    text: { type: "string", description: "1-4000 characters of document text. Valid only with format, without template_id or spec." },
    template_id: {
      type: "string",
      enum: [...OFFICE_TEMPLATE_IDS],
      description: "Built-in template id. Valid alone, without format, text, or spec.",
    },
    spec: OFFICE_CREATE_SPEC_SCHEMA,
  },
};

const operationBranches: JsonSchemaNode[] = [
  {
    title: "docx.replaceParagraph",
    type: "object",
    additionalProperties: false,
    required: ["kind", "paragraphIndex", "text"],
    properties: {
      kind: { type: "string", const: "docx.replaceParagraph" },
      paragraphIndex: indexInteger,
      text: nonEmptyString,
    },
  },
  {
    title: "docx.insertParagraph",
    type: "object",
    additionalProperties: false,
    required: ["kind", "paragraphIndex", "position", "text"],
    properties: {
      kind: { type: "string", const: "docx.insertParagraph" },
      paragraphIndex: indexInteger,
      position: { type: "string", enum: ["before", "after"] },
      text: nonEmptyString,
    },
  },
  {
    title: "docx.appendParagraph",
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: {
      kind: { type: "string", const: "docx.appendParagraph" },
      text: nonEmptyString,
    },
  },
  {
    title: "docx.replaceTableCell",
    type: "object",
    additionalProperties: false,
    required: ["kind", "tableIndex", "rowIndex", "cellIndex", "text"],
    properties: {
      kind: { type: "string", const: "docx.replaceTableCell" },
      tableIndex: indexInteger,
      rowIndex: indexInteger,
      cellIndex: indexInteger,
      text: nonEmptyString,
    },
  },
  {
    title: "xlsx.setCell",
    type: "object",
    additionalProperties: false,
    required: ["kind", "cell", "value"],
    properties: {
      kind: { type: "string", const: "xlsx.setCell" },
      sheet: { type: "string" },
      cell: { type: "string", description: "A1-style cell such as B12." },
      value: officeScalar,
      formula: { type: "boolean" },
    },
  },
  {
    title: "xlsx.setRange",
    type: "object",
    additionalProperties: false,
    required: ["kind", "startCell", "values"],
    properties: {
      kind: { type: "string", const: "xlsx.setRange" },
      sheet: { type: "string" },
      startCell: { type: "string", description: "A1-style start cell." },
      values: { type: "array", items: { type: "array", items: officeScalar } },
    },
  },
  {
    title: "xlsx.appendRows",
    type: "object",
    additionalProperties: false,
    required: ["kind", "values"],
    properties: {
      kind: { type: "string", const: "xlsx.appendRows" },
      sheet: { type: "string" },
      values: { type: "array", items: { type: "array", items: officeScalar } },
    },
  },
  {
    title: "pptx.replaceSlideText",
    type: "object",
    additionalProperties: false,
    required: ["kind", "slideIndex", "text"],
    properties: {
      kind: { type: "string", const: "pptx.replaceSlideText" },
      slideIndex: indexInteger,
      runIndex: indexInteger,
      text: nonEmptyString,
    },
  },
  {
    title: "pdf.watermark",
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: {
      kind: { type: "string", const: "pdf.watermark" },
      text: nonEmptyString,
    },
  },
  {
    title: "pdf.rotate",
    type: "object",
    additionalProperties: false,
    required: ["kind", "degrees"],
    properties: {
      kind: { type: "string", const: "pdf.rotate" },
      degrees: { type: "integer", enum: [90, 180, 270] },
    },
  },
];

export const OFFICE_OPERATION_SCHEMA: JsonSchemaNode = {
  description: "Closed typed office operation. kind is required and selects the remaining fields. Unknown fields are rejected.",
  oneOf: [operationBranches[0]!, operationBranches[1]!, ...operationBranches.slice(2)],
};

const jobId: JsonSchemaNode = { type: "string", description: "Session-bound office job id." };
const handle: JsonSchemaNode = { type: "string", description: "Session-bound office handle." };

export const OFFICE_PLAN_INPUT_KEYS = ["job_id", "handle", "operation"] as const;

export const OFFICE_PLAN_PARAMETERS_SCHEMA: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  required: ["operation"],
  description:
    "Provider-facing object root. Apply one closed typed operation to exactly one of job_id or handle. operation.kind selects the remaining operation fields.",
  properties: {
    job_id: jobId,
    handle,
    operation: OFFICE_OPERATION_SCHEMA,
  },
};

export function extraFieldNames(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

export function extraFieldsError(label: string, extra: readonly string[], allowed: readonly string[]): string {
  return `${label} has extra fields: ${extra.join(", ")} (allowed: ${allowed.join(", ")})`;
}
