import type { OfficeFormat } from "../formats.js";

export interface OfficeTemplate {
  id: string;
  format: OfficeFormat;
  title: { en: string; "zh-CN": string };
  license: "OFL-adjacent-system-fallback" | "generated-ir";
  body: string;
}

export const OFFICE_TEMPLATES: readonly OfficeTemplate[] = [
  { id: "resume-zh", format: "docx", title: { en: "Chinese resume", "zh-CN": "中文简历" }, license: "generated-ir", body: "姓名：示例用户\n岗位：产品工程师" },
  { id: "resume-en", format: "docx", title: { en: "English resume", "zh-CN": "英文简历" }, license: "generated-ir", body: "Name: Example User\nRole: Product engineer" },
  { id: "report", format: "docx", title: { en: "Project report", "zh-CN": "项目报告" }, license: "generated-ir", body: "项目报告\n结论：Penglai 0.5.7 只发一次。" },
  { id: "minutes", format: "docx", title: { en: "Meeting minutes", "zh-CN": "会议纪要" }, license: "generated-ir", body: "会议纪要\n决议：办公与记忆为 required-builtin。" },
  { id: "contract", format: "docx", title: { en: "Contract draft", "zh-CN": "合同草案" }, license: "generated-ir", body: "合同草案\n双方确认本地优先交付。" },
  { id: "gbt9704", format: "docx", title: { en: "GB/T 9704 notice", "zh-CN": "GB/T 9704 通知" }, license: "generated-ir", body: "通知\n各有关单位：" },
  { id: "budget", format: "xlsx", title: { en: "Budget sheet", "zh-CN": "预算表" }, license: "generated-ir", body: "科目,金额\n研发,100" },
  { id: "analysis", format: "xlsx", title: { en: "Data analysis", "zh-CN": "数据分析表" }, license: "generated-ir", body: "指标,值\n覆盖率,0.92" },
  { id: "launch", format: "pptx", title: { en: "Product launch", "zh-CN": "产品发布演示" }, license: "generated-ir", body: "蓬莱 0.5.7" },
  { id: "quarterly", format: "pptx", title: { en: "Quarterly review", "zh-CN": "季度总结演示" }, license: "generated-ir", body: "季度总结" },
];

export function templateById(id: string): OfficeTemplate {
  const found = OFFICE_TEMPLATES.find((row) => row.id === id);
  if (!found) throw new Error(`unknown office template ${id}`);
  return found;
}
