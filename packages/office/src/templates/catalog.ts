import type { OfficeFormat } from "../formats.js";
import type { OfficeCreateSpec } from "../specs.js";

export interface OfficeTemplate {
  id: string;
  format: OfficeFormat;
  title: { en: string; "zh-CN": string };
  license: "generated-ir";
  /** Closed, locally generated document IR; never an opaque third-party file. */
  spec: OfficeCreateSpec;
}

export const OFFICE_TEMPLATES: readonly OfficeTemplate[] = [
  {
    id: "resume-zh", format: "docx", title: { en: "Chinese resume", "zh-CN": "中文简历" }, license: "generated-ir",
    spec: { format: "docx", title: "个人简历", sections: [
      { heading: "基本信息", table: { rows: [["姓名", "待填写"], ["目标岗位", "待填写"], ["联系方式", "待填写"]] } },
      { heading: "个人简介", paragraphs: ["请概述与目标岗位最相关的经验和优势。"] },
      { heading: "工作经历", bullets: ["公司 / 职位 / 起止时间", "用结果和数据描述主要贡献。"] },
      { heading: "教育背景", bullets: ["学校 / 专业 / 学位 / 起止时间"] },
    ] },
  },
  {
    id: "resume-en", format: "docx", title: { en: "English resume", "zh-CN": "英文简历" }, license: "generated-ir",
    spec: { format: "docx", title: "Resume", sections: [
      { heading: "Contact", table: { rows: [["Name", "To be completed"], ["Target role", "To be completed"], ["Contact", "To be completed"]] } },
      { heading: "Summary", paragraphs: ["Summarize the experience and strengths most relevant to the target role."] },
      { heading: "Experience", bullets: ["Company / Role / Dates", "Describe measurable outcomes and contributions."] },
      { heading: "Education", bullets: ["School / Major / Degree / Dates"] },
    ] },
  },
  {
    id: "report", format: "docx", title: { en: "Project report", "zh-CN": "项目报告" }, license: "generated-ir",
    spec: { format: "docx", title: "项目报告", sections: [
      { heading: "摘要", paragraphs: ["填写项目背景、目标和当前结论。"] },
      { heading: "进展", bullets: ["已完成事项", "关键数据", "未解决问题"] },
      { heading: "风险与计划", table: { headers: ["事项", "负责人", "截止时间", "状态"], rows: [["待填写", "待填写", "待填写", "待填写"]] } },
    ] },
  },
  {
    id: "minutes", format: "docx", title: { en: "Meeting minutes", "zh-CN": "会议纪要" }, license: "generated-ir",
    spec: { format: "docx", title: "会议纪要", sections: [
      { heading: "会议信息", table: { rows: [["时间", "待填写"], ["参会人", "待填写"], ["主题", "待填写"]] } },
      { heading: "讨论要点", bullets: ["议题一", "议题二"] },
      { heading: "行动项", table: { headers: ["行动", "负责人", "截止时间"], rows: [["待填写", "待填写", "待填写"]] } },
    ] },
  },
  {
    id: "contract", format: "docx", title: { en: "Contract draft", "zh-CN": "合同草案" }, license: "generated-ir",
    spec: { format: "docx", title: "合同草案（请经专业人士审核）", sections: [
      { heading: "合同主体", table: { rows: [["甲方", "待填写"], ["乙方", "待填写"]] } },
      { heading: "合作内容", paragraphs: ["填写合作范围、交付物和验收标准。"] },
      { heading: "费用与期限", paragraphs: ["填写金额、付款节点和合同期限。"] },
      { heading: "其他", paragraphs: ["本模板不构成法律意见，签署前请由专业人士审核。"] },
    ] },
  },
  {
    id: "gbt9704", format: "docx", title: { en: "GB/T 9704 notice", "zh-CN": "GB/T 9704 通知" }, license: "generated-ir",
    spec: { format: "docx", title: "关于事项的通知", sections: [
      { paragraphs: ["各有关单位：", "现将有关事项通知如下。"] },
      { heading: "一、工作要求", paragraphs: ["填写具体要求。"] },
      { heading: "二、时间安排", paragraphs: ["填写时间和报送方式。"] },
      { paragraphs: ["特此通知。"] },
    ] },
  },
  {
    id: "budget", format: "xlsx", title: { en: "Budget sheet", "zh-CN": "预算表" }, license: "generated-ir",
    spec: { format: "xlsx", sheets: [{ name: "预算", header: true, columnWidths: [22, 16, 16, 28], rows: [["科目", "预算金额", "实际金额", "备注"], ["研发", 0, 0, ""], ["市场", 0, 0, ""]] }] },
  },
  {
    id: "analysis", format: "xlsx", title: { en: "Data analysis", "zh-CN": "数据分析表" }, license: "generated-ir",
    spec: { format: "xlsx", sheets: [
      { name: "原始数据", header: true, rows: [["日期", "指标", "值"], ["待填写", "待填写", 0]] },
      { name: "结论", header: true, rows: [["发现", "依据", "建议"], ["待填写", "待填写", "待填写"]], columnWidths: [28, 28, 28] },
    ] },
  },
  {
    id: "launch", format: "pptx", title: { en: "Product launch", "zh-CN": "产品发布演示" }, license: "generated-ir",
    spec: { format: "pptx", theme: "tech", slides: [
      { kind: "cover", heading: "产品发布", subheading: "产品名称与发布日期" },
      { kind: "content", heading: "用户问题", bullets: ["核心用户是谁", "现有方案的不足", "问题带来的影响"] },
      { kind: "content", heading: "产品方案", bullets: ["关键能力", "使用流程", "差异化价值"] },
      { kind: "content", heading: "下一步", bullets: ["发布范围", "反馈渠道", "迭代计划"] },
      { kind: "ending", heading: "谢谢" },
    ] },
  },
  {
    id: "quarterly", format: "pptx", title: { en: "Quarterly review", "zh-CN": "季度总结演示" }, license: "generated-ir",
    spec: { format: "pptx", theme: "consulting", slides: [
      { kind: "cover", heading: "季度总结", subheading: "季度 / 团队" },
      { kind: "content", heading: "目标回顾", bullets: ["目标一", "目标二", "目标三"] },
      { kind: "content", heading: "关键成果", bullets: ["结果与数据", "用户价值", "经验沉淀"] },
      { kind: "content", heading: "问题与改进", bullets: ["主要问题", "根因", "改进动作"] },
      { kind: "ending", heading: "下季度计划" },
    ] },
  },
] as const;

export function templateById(id: string): OfficeTemplate {
  const found = OFFICE_TEMPLATES.find((row) => row.id === id);
  if (!found) throw new Error(`unknown office template ${id}`);
  return found;
}
