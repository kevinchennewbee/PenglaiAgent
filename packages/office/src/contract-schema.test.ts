import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedJsonSchema, validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import {
  OFFICE_CREATE_PARAMETERS_SCHEMA,
  OFFICE_CREATE_SPEC_SCHEMA,
  OFFICE_OPERATION_SCHEMA,
  OFFICE_PLAN_PARAMETERS_SCHEMA,
  OFFICE_TEMPLATE_IDS,
} from "./contract-schema.js";
import { parseOfficeOperation } from "./operations.js";
import { parseOfficeCreateInput, parseOfficeCreateSpec } from "./specs.js";
import { registerOfficeTools } from "./tools.js";

function schemaErrors(schema: Parameters<typeof validateJsonSchemaValue>[0], value: unknown): string[] {
  return validateJsonSchemaValue(schema, value, "value");
}

function schemaAccepts(schema: Parameters<typeof validateJsonSchemaValue>[0], value: unknown): boolean {
  return schemaErrors(schema, value).length === 0;
}

function advertisedCreateSchema(): unknown {
  const captured: unknown[] = [];
  registerOfficeTools(
    {
      tools: {
        register(def: Record<string, unknown>) {
          if (def.name === "penglai_office_create") captured.push(def.parameters);
        },
      },
      workspaceRegistry: { list: () => [] },
    },
    {} as never,
  );
  return captured[0];
}

const validSpecs = {
  docx: {
    format: "docx",
    title: "Penglai 0.6.1",
    sections: [{ paragraphs: ["Reference JADE-061-A; Total 37"] }],
  },
  xlsx: { format: "xlsx", sheets: [{ name: "Sheet1", rows: [["A", 1, true, null]] }] },
  pptx: {
    format: "pptx",
    theme: "minimal",
    slides: [{ kind: "cover", heading: "Title" }, { kind: "content", heading: "Body", bullets: ["one"] }],
  },
  pdf: { format: "pdf", title: "Notes", paragraphs: ["Hello"] },
} as const;

const validOperations = {
  "docx.replaceParagraph": { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "revised" },
  "docx.insertParagraph": { kind: "docx.insertParagraph", paragraphIndex: 0, position: "after", text: "inserted" },
  "docx.appendParagraph": { kind: "docx.appendParagraph", text: "tail" },
  "docx.replaceTableCell": { kind: "docx.replaceTableCell", tableIndex: 0, rowIndex: 0, cellIndex: 0, text: "cell" },
  "xlsx.setCell": { kind: "xlsx.setCell", cell: "B1", value: 3, sheet: "Sheet1", formula: true },
  "xlsx.setRange": { kind: "xlsx.setRange", startCell: "A1", values: [["a", 1]] },
  "xlsx.appendRows": { kind: "xlsx.appendRows", values: [[false, null]] },
  "pptx.replaceSlideText": { kind: "pptx.replaceSlideText", slideIndex: 0, text: "slide", runIndex: 1 },
  "pdf.watermark": { kind: "pdf.watermark", text: "CONFIDENTIAL" },
  "pdf.rotate": { kind: "pdf.rotate", degrees: 90 },
} as const;

test("advertised office schemas are official DSH JSON Schema subset and match parser exports", () => {
  assertSupportedJsonSchema(OFFICE_CREATE_SPEC_SCHEMA);
  assertSupportedJsonSchema(OFFICE_CREATE_PARAMETERS_SCHEMA);
  assertSupportedJsonSchema(OFFICE_OPERATION_SCHEMA);
  assertSupportedJsonSchema(OFFICE_PLAN_PARAMETERS_SCHEMA);
  assert.equal(advertisedCreateSchema(), OFFICE_CREATE_PARAMETERS_SCHEMA);
});

test("office create schema and parser accept every format pathway", () => {
  for (const spec of Object.values(validSpecs)) {
    assert.equal(schemaAccepts(OFFICE_CREATE_SPEC_SCHEMA, spec), true, JSON.stringify(spec));
    assert.equal(parseOfficeCreateSpec(spec).format, spec.format);
    assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, { spec }), true);
    assert.equal(parseOfficeCreateInput({ spec }).pathway, "spec");
  }
  assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, { format: "docx", text: "hello office" }), true);
  assert.deepEqual(parseOfficeCreateInput({ format: "docx", text: "hello office" }), {
    pathway: "text",
    format: "docx",
    text: "hello office",
  });
  for (const format of ["xlsx", "pptx", "pdf"] as const) {
    const input = { format, text: `hello ${format}` };
    assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, input), true);
    assert.equal(parseOfficeCreateInput(input).pathway, "text");
  }
  for (const templateId of OFFICE_TEMPLATE_IDS) {
    assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, { template_id: templateId }), true);
    assert.deepEqual(parseOfficeCreateInput({ template_id: templateId }), {
      pathway: "template",
      templateId,
    });
  }
  const sibling = { format: "docx", spec: validSpecs.docx };
  assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, sibling), true);
  assert.equal(parseOfficeCreateInput(sibling).pathway, "spec");
});

test("office create schema and parser reject extra, missing, and mixed discriminator fields", () => {
  const liveSpec = { title: "Penglai 0.6.1", body: ["Reference JADE-061-A; Total 37"] };
  assert.equal(schemaAccepts(OFFICE_CREATE_SPEC_SCHEMA, liveSpec), false);
  assert.throws(() => parseOfficeCreateSpec(liveSpec), /extra fields: body/);
  const liveCreate = { format: "docx", spec: liveSpec };
  assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, liveCreate), false);
  assert.throws(() => parseOfficeCreateInput(liveCreate), /extra fields: body/);

  assert.throws(() => parseOfficeCreateSpec({ format: "docx", title: "x" }), /sections/);
  assert.equal(schemaAccepts(OFFICE_CREATE_SPEC_SCHEMA, { format: "docx", title: "x" }), false);
  assert.throws(
    () => parseOfficeCreateSpec({ format: "docx", sections: [{ paragraphs: ["ok"] }], body: ["no"] }),
    /extra fields: body/,
  );
  assert.throws(() => parseOfficeCreateSpec({ format: "xlsx", sheets: [{ name: "A", rows: [] }], title: "no" }), /extra fields: title/);
  assert.throws(() => parseOfficeCreateInput({ format: "docx", text: "x", spec: validSpecs.docx }), /exactly one/);
  assert.equal(schemaAccepts(OFFICE_CREATE_PARAMETERS_SCHEMA, { format: "docx", text: "x", spec: validSpecs.docx }), false);
  assert.throws(() => parseOfficeCreateInput({ template_id: "report", text: "no" }), /exactly one/);
  assert.throws(
    () => parseOfficeCreateInput({ format: "xlsx", spec: validSpecs.docx }),
    /does not match spec.format/,
  );
  assert.throws(() => parseOfficeCreateInput({ destPath: "/tmp/out.docx", format: "docx", text: "x" }), /extra fields: destPath/);
});

test("office operation schema and parser accept every closed kind and reject extra or missing fields", () => {
  for (const [kind, operation] of Object.entries(validOperations)) {
    assert.equal(schemaAccepts(OFFICE_OPERATION_SCHEMA, operation), true, kind);
    assert.equal(parseOfficeOperation(operation).kind, kind);
    assert.equal(schemaAccepts(OFFICE_PLAN_PARAMETERS_SCHEMA, { job_id: "job-123456", operation }), true);
    assert.equal(schemaAccepts(OFFICE_PLAN_PARAMETERS_SCHEMA, { handle: "handle-1", operation }), true);
  }
  assert.throws(
    () => parseOfficeOperation({ kind: "docx.replaceParagraph", paragraphIndex: 0, text: "x", note: "no" }),
    /extra fields: note/,
  );
  assert.equal(
    schemaAccepts(OFFICE_OPERATION_SCHEMA, {
      kind: "docx.replaceParagraph",
      paragraphIndex: 0,
      text: "x",
      note: "no",
    }),
    false,
  );
  assert.throws(() => parseOfficeOperation({ kind: "docx.replaceParagraph", text: "no-index" }), /paragraphIndex/);
  assert.equal(schemaAccepts(OFFICE_OPERATION_SCHEMA, { kind: "docx.replaceParagraph", text: "no-index" }), false);
  assert.throws(() => parseOfficeOperation({ kind: "docx.magic", text: "x" }), /not in the closed typed set/);
  assert.throws(() => parseOfficeOperation({ paragraphIndex: 0, text: "x" }), /missing required discriminator kind/);
  assert.equal(schemaAccepts(OFFICE_PLAN_PARAMETERS_SCHEMA, { job_id: "job-123456", handle: "h", operation: validOperations["pdf.rotate"] }), false);
});
