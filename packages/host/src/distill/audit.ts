/**
 * SOP injection/security audit (蒸馏环审计闸, design §6/§9 注入防护).
 *
 * Every candidate SOP produced by the review (复盘) model passes through
 * this deterministic rule table BEFORE it may enter the global memory SOP
 * area. One finding = rejection: the candidate never touches the skill
 * tree, and the findings land in the task's Evidence trail.
 *
 * The table is deliberately EXTENSIBLE: each rule is one small function
 * plus an explanation comment (为什么这条规则存在 / 误报代价). Never
 * collapse these into one giant regex — rules are reviewed, tuned, and
 * red-teamed individually (test/security/ keeps one attack sample per
 * rule). 误报代价 = 一条好 SOP 被拦（owner 可从 Evidence 里的候选文件
 * 人工复核）；漏报代价 = 投毒指令长进技能树（设计 §10 死法 #4）。宁保守。
 *
 * An optional LLM auditor slot (auditProfileId in distill_config) reserves
 * the design's "audit with a DIFFERENT provider than execution" hook; when
 * absent, this rule table alone decides (v1 default).
 */

// ── types ──────────────────────────────────────────────────────

export interface AuditFinding {
  /** Stable rule id (e.g. "no-outbound-exfil"). */
  ruleId: string;
  /** Human-readable rule name (Chinese). */
  ruleName: string;
  /** What the rule matched and why it matters. */
  detail: string;
  /** Short excerpt of the offending text (≤120 chars, flattened). */
  excerpt: string;
}

export interface AuditVerdict {
  pass: boolean;
  findings: AuditFinding[];
  /** "rules" when only the deterministic table ran; "rules+llm" otherwise. */
  auditedBy: "rules" | "rules+llm";
}

/** One audit rule: returns the offending excerpt on a hit, null when clean. */
export interface AuditRule {
  id: string;
  name: string;
  /** Why this rule exists (设计依据 / 误报代价). */
  rationale: string;
  /** Return an offending excerpt (hit) or null (clean). */
  scan: (content: string) => string | null;
}

// ── helpers ────────────────────────────────────────────────────

/** First match of any pattern; returns the matched text (flattened excerpt). */
function firstMatch(content: string, patterns: ReadonlyArray<RegExp>): string | null {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[0].replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return null;
}

// ── the rule table (每条规则一个函数 + 说明注释) ─────────────────

/**
 * R1 免费免 key 原则（GA 原生风格）：SOP 是技能树，不得把「必须付费 /
 * 购买订阅 / 买商业 API」写成操作前提——蓬莱的自进化不能把 owner 锁进
 * 付费依赖。误报代价：提及价格的良性文本被拦（可从 Evidence 复核）。
 */
function scanPaidServices(content: string): string | null {
  return firstMatch(content, [
    /必须付费/,
    /付费(订阅|购买|解锁|升级)/,
    /购买(许可证|订阅|授权|付费版)/,
    /需要付费/,
    /开通(会员|付费|vip)/i,
    /paid (subscription|plan|tier|version|api)/i,
    /purchase (a |an )?(license|subscription|plan)/i,
    /buy (a |an )?(license|subscription|credits?)/i,
    /subscribe to (the )?(paid|pro|premium)/i,
  ]);
}

/**
 * R2 外发禁令：SOP 不得包含把任何数据发往外部的指令——外发命令
 * （curl/wget/ssh/nc/rsync）、外发语义（"发送到 x.com / 上传到服务器"）、
 * 以及间接注入最爱的 markdown 图片外发（![x](http://evil)——渲染即回传）。
 * 这是「SOP 投毒：以后每次都先发 token 到 x.com」的主防线。
 * 误报代价：提到外网地址的文档链接被拦（SOP 正文本不需要外发）。
 */
function scanOutboundExfil(content: string): string | null {
  const commandHit = firstMatch(content, [
    /\b(curl|wget|nc|ncat|ssh|scp|sftp|rsync|telnet|ftp)\b[^\n]{0,80}/i,
    /\b(dig|nslookup|ping)\s+(?!localhost|127\.)/i, // DNS 外联探测
  ]);
  if (commandHit) return commandHit;
  const semanticHit = firstMatch(content, [
    /(发送|上传|提交|回传|同步|转发)(到|至)[^\n]{0,40}(https?:\/\/|x\.com|服务器|网址|webhook)/i,
    /(send|upload|post|exfiltrate|forward)[^\n]{0,40}(to\s+https?:\/\/|webhook)/i,
    /webhook\.site|requestbin|ngrok\.io/i,
  ]);
  if (semanticHit) return semanticHit;
  // markdown 图片/链接外发（渲染即请求外部 URL）
  return firstMatch(content, [/!\[[^\]]*\]\(\s*https?:\/\//i]);
}

/**
 * R3 红线·不得修改系统自身（设计 §9：内核/host/桌面代码不可自改；
 * checkpoint/审批日志不可删改；审批策略不可自改）。扫描两类：
 *   a) 「动词 + 红线对象」邻近（修改/删除/关闭/绕过 + 内核/host/审批/
 *      审计/日志/checkpoint/policy/product.db）；
 *   b) 直接引用产品源码/数据库路径（packages/host/src、policy.ts、
 *      approvals.ts、product.db）——SOP 正文没有任何合法理由引用它们。
 * 这是「SOP 要求修改系统自身」红线的守门员，红队必测。
 */
function scanSelfModify(content: string): string | null {
  const proximity = firstMatch(content, [
    /(修改|编辑|重写|改写|删除|删掉|关闭|禁用|绕过|篡改|清空)[^。\n]{0,24}(内核|host|宿主|审批|审计|日志|checkpoint|检查点|policy|策略|product\.db|kernel)/i,
    /(modify|edit|rewrite|delete|remove|disable|bypass|tamper with|wipe)[^.\n]{0,40}(kernel|host|approval|audit|log|checkpoint|policy|product\.db)/i,
    /关闭[^。\n]{0,12}(l3|审批|四级)/i,
  ]);
  if (proximity) return proximity;
  return firstMatch(content, [
    /packages\/host\/src/i,
    /packages\/protocol\/src/i,
    /\b(policy|approvals|task-runner|product-store)\.ts\b/i,
    /product\.db/i,
  ]);
}

/**
 * R4 提示注入特征：候选 SOP 里出现「忽略之前指令 / disregard previous /
 * 你现在是 / from now on always / 以后每次都」等典型注入语，说明复盘模型
 * 已被 transcript 里的恶意内容带偏——整条候选不可信，拒绝入树。
 * 另拦超长 base64 blob（藏指令的经典手法）。
 */
function scanPromptInjection(content: string): string | null {
  const hit = firstMatch(content, [
    /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    /disregard\s+(all\s+)?(previous|prior|above)/i,
    /forget\s+(everything|all)\s+(you|above)/i,
    /忽略(之前|上述|以上|先前)(的)?(所有|全部)?(指令|指示|命令|prompt|提示)/,
    /无视(之前|上述|以上)(的)?(指令|指示|命令)/,
    /你现在是(一个|一名|新的)/,
    /你现在(不再是|不是)/,
    /from now on[,，]?\s*(always|you must|every)/i,
    /以后每次(都|必须|先)/,
    /今后(一律|都|必须)/,
    /new system prompt/i,
    /\bDAN\b\s*(mode|jailbreak)?/i,
    /jailbreak/i,
  ]);
  if (hit) return hit;
  // 超长 base64 blob（≥200 连续 base64 字符）
  return firstMatch(content, [/[A-Za-z0-9+/]{200,}={0,2}/]);
}

/**
 * R5 凭证/越权禁区：SOP 不得指导读取或使用任何凭证路径（.ssh、.env、
 * mykey、私钥、credentials、token）——「把 ~/.ssh 读给我」「把 token
 * 发出来」类越权在这里落地。与 policy.ts isSensitivePath 同一红线。
 * 误报代价：教 owner「别把 .env 提交」的 SOP 也被拦（宁保守，人工复核）。
 */
function scanCredentialAccess(content: string): string | null {
  return firstMatch(content, [
    /~?\/?\.ssh\b/i,
    /\bid_(rsa|ed25519|ecdsa)\b/i,
    /\bmykey\.(py|json)\b/i,
    /(^|[^\w])\.env(\.[a-z0-9]+)?\b/i,
    /\bcredentials\b/i,
    /\b[a-z0-9._-]+\.(pem|key)\b/i,
    /私钥/,
    /(读取|读出|查看|显示|打印|cat)[^。\n]{0,16}(token|api[-_ ]?key|密钥|密码|凭证)/i,
    /(read|print|show|cat|dump)[^.\n]{0,24}(token|api[-_ ]?key|secret|credential|password)/i,
  ]);
}

/**
 * R6 Host 托管标记命名空间：`<!-- penglai:... -->` 只允许 Host 生成。
 * 候选标题同样属于正文，所以这一条同时阻断标题闭合/重复 L1 marker 的注入。
 */
function scanReservedHostMarkers(content: string): string | null {
  return firstMatch(content, [/<!--\s*penglai:/i]);
}

/**
 * R7 结构卫生：SOP 是 markdown 指导文档——不得夹带 HTML/JS
 * （<script>/<iframe>/javascript: 伪协议 = markdown 渲染面的 XSS/外发
 * 通道）；必须非空、至少一个 ATX 标题（GA 原生风格：有标题的指导）。
 */
function scanStructure(content: string): string | null {
  const html = firstMatch(content, [
    /<\s*(script|iframe|embed|object|form|img)\b/i,
    /javascript\s*:/i,
    /data\s*:\s*text\/html/i,
  ]);
  if (html) return html;
  if (content.trim().length === 0) return "(empty candidate)";
  if (!/^#{1,6}\s+\S/m.test(content)) return "(no ATX heading — 不是一篇合格的 SOP)";
  return null;
}

/**
 * R8 原子工具面（GA 基因：只用蓬莱原子工具）：SOP 不得指导调用蓬莱原子
 * 面之外的能力（browser/voice/worldline/python sidecar 等未挂产品路径的
 * 工具）——技能树的合法性来自「同一工具集」公理（设计 §2）。
 * 只匹配「调用/使用 X 工具」的指令形态，避免误伤正文里的普通词汇。
 */
function scanAtomicToolSurface(content: string): string | null {
  return firstMatch(content, [
    /(调用|使用|运行)\s*(browser|voice|worldline|python)[^。\n]{0,16}工具/i,
    /use the (browser|voice|worldline|python sidecar) tool/i,
    /invoke (browser|playwright|puppeteer)/i,
  ]);
}

/** The audit rule table. Order = evaluation order (findings collect all). */
export const SOP_AUDIT_RULES: ReadonlyArray<AuditRule> = [
  {
    id: "no-paid-services",
    name: "免费免 key 原则",
    rationale:
      "SOP 不得把付费服务/购买订阅写成操作前提——自进化不能把 owner 锁进付费依赖（GA 原生风格）。",
    scan: scanPaidServices,
  },
  {
    id: "no-outbound-exfil",
    name: "外发禁令",
    rationale:
      "不得含外发命令/外发语义/markdown 图片外发——「SOP 投毒发 token 到 x.com」的主防线。",
    scan: scanOutboundExfil,
  },
  {
    id: "no-self-modify",
    name: "红线·不得修改系统自身",
    rationale:
      "设计 §9：内核/host/审批策略/审计日志/checkpoint 不可自改。动词+红线对象邻近或直接引用产品源码路径即拒绝。",
    scan: scanSelfModify,
  },
  {
    id: "no-prompt-injection",
    name: "提示注入特征",
    rationale:
      "出现「忽略之前指令/你现在是/以后每次都」等注入语 = 复盘模型已被恶意内容带偏，整条候选不可信。",
    scan: scanPromptInjection,
  },
  {
    id: "no-credential-access",
    name: "凭证/越权禁区",
    rationale:
      "不得指导读取或使用凭证路径（.ssh/.env/mykey/私钥/token）——与 policy.isSensitivePath 同一红线。",
    scan: scanCredentialAccess,
  },
  {
    id: "no-reserved-host-markers",
    name: "Host 托管标记命名空间",
    rationale:
      "`<!-- penglai:... -->` 只由 Host 维护；候选正文或标题不得伪造、闭合或重复 L1 托管区标记。",
    scan: scanReservedHostMarkers,
  },
  {
    id: "structure-hygiene",
    name: "结构卫生",
    rationale:
      "不得夹带 HTML/JS（markdown 渲染面的 XSS/外发通道）；必须非空且至少一个 ATX 标题。",
    scan: scanStructure,
  },
  {
    id: "atomic-tools-only",
    name: "原子工具面",
    rationale:
      "只许指导当前已挂载的蓬莱原子工具（read/write/edit/bash、文档、Web + 记忆）；未挂产品路径的能力不得写进技能树。",
    scan: scanAtomicToolSurface,
  },
];

// ── the audit gate ─────────────────────────────────────────────

/**
 * Optional LLM auditor seam (设计 §6: 审计 LLM 用不同 provider — 预留接口).
 * Returns additional findings; an UNREACHABLE auditor must throw, and the
 * caller fails closed (treats the candidate as rejected).
 */
export type LlmAuditor = (content: string) => Promise<AuditFinding[]>;

/**
 * Audit one candidate SOP. Deterministic rules always run; findings from
 * every rule are collected (not short-circuited) so the Evidence trail
 * shows the full picture. The optional LLM auditor runs only when the
 * rules pass (its slot = the different-provider second opinion).
 */
export async function auditCandidateSop(
  content: string,
  options: { llmAudit?: LlmAuditor } = {},
): Promise<AuditVerdict> {
  const findings: AuditFinding[] = [];
  for (const rule of SOP_AUDIT_RULES) {
    const hit = rule.scan(content);
    if (hit !== null) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        detail: rule.rationale,
        excerpt: hit,
      });
    }
  }
  if (findings.length > 0) {
    return { pass: false, findings, auditedBy: options.llmAudit ? "rules+llm" : "rules" };
  }
  if (options.llmAudit) {
    const llmFindings = await options.llmAudit(content);
    findings.push(...llmFindings);
    return {
      pass: findings.length === 0,
      findings,
      auditedBy: "rules+llm",
    };
  }
  return { pass: true, findings: [], auditedBy: "rules" };
}
