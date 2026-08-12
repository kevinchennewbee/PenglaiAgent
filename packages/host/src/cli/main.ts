/**
 * penglai CLI — command dispatch (the Host 全能力薄客户端).
 *
 * Every command composes the Host's JSON-RPC surface; the CLI holds no
 * product state. Connection: localhost + token, auto-starting the local
 * host when it is missing.
 */

import { HostClient, CliError, DEFAULT_PORT } from "./client.js";
import {
  cmdChatList,
  cmdChatRepl,
} from "./chat.js";
import {
  cmdApproval,
  cmdBudget,
  cmdCatalog,
  cmdChannel,
  cmdConfig,
  cmdDistill,
  cmdDoctor,
  cmdContext,
  cmdMemory,
  cmdMode,
  cmdProject,
  cmdSetup,
  cmdStatus,
  cmdTask,
  cmdWork,
  makeContext,
} from "./commands.js";
import { parseArgs, type CliIO } from "./format.js";
import { cmdVoice, productionVoiceDeps, type VoiceReplDeps } from "./voice.js";
import type { WizardPrompter } from "./setup-wizard.js";

export const CLI_HELP = `penglai — 蓬莱 0.4.0 · 住在你机器上的那个它

usage: penglai <command> [args] [--port <n>] [--token <t>]

daily driver
  penglai | chat            交互式 chat（流式；/exit /mode /new /voice /help）
    --new                   开新会话（默认续最近一条）
    --voice                 语音模式进 chat（本地 ASR+TTS，数据不出机）
    --conversation <id>     指定会话
    --list                  列出最近会话后退出
    权限档位（默认 auto_edit；/mode 会话内循环切换）：
      --plan                计划模式（只读研究，不编辑/不跑命令）
      --confirm             变更前确认（每次编辑/命令都问）
      --auto-edit           自动编辑（文件改写自动；L2 命令问；L3 永远问）
      --full                完全访问（减少确认；L3 外发/删除/推送仍问）
  setup                     首次运行向导：选模型 → 填 key → 验活 → 身份诞生（可跳过）→ 进 chat
  voice                     语音能力面板（ASR/TTS 组件级探测）
  voice setup [--tts|--all] 下载语音模型（镜像优先 + 断点续传；ASR 约 230MB，TTS 约 728MB）
  mode                      兼容命令：查看当前项目锚点（不代表另一套能力）
  work <路径> "<目标>"      连接项目并提出任务锚点
  work confirm <提案id> <路径>  Owner 精确确认项目路径并开始
  status                    host 健康 · 当前会话 · 活跃任务 · 用量

tasks
  task list [--project <id>] [--all]
  task show <id>            任务 + runs + checkpoint + 证据
  task start <id> [--profile <id>]   开工（流式；Ctrl+C 中断）
  task pause <id>           暂停（checkpoint 落盘，可 resume）
  task resume <id>          续跑（新开 run，从 checkpoint 续）
  task cancel <id>          取消

approvals（审批四级制：L1 自主 / L2 一键确认 / L3 强制确认 / L4 拒绝）
  approval list [--all]       待审批项（默认 pending；--all 看历史与决定）
  approval approve <id> [--note "…"] [--remember]
                              批准；L2 加 --remember = 本项目同类免问
  approval reject <id> [--note "…"]   拒绝（理由回给模型并留痕）

projects & config
  project list|show <id>|trust <id>|untrust <id>
  config list               模型档案（key 就绪状态）
  config add <id> --base-url <u> --model <m> [--label] [--api-key-env VAR|--api-key K]
  catalog                   目录新鲜度（种子日期 + 各校准记录）
  catalog refresh           目录自校准：对有 key 的档案实拉 /models 刷新覆盖层

channels（IM：飞书先行，远程监视+审批器）
  channel list              渠道状态 + 白名单
  channel setup feishu --app-id <id> --app-secret <secret> [--domain <url>]
  channel allow feishu <open_id> [--name <称呼>] [--note <备注>]
  channel deny feishu <open_id> · channel disable feishu

migrate（0.3 → 0.4 数据迁移：模型配置 / 记忆 / 飞书渠道）
  migrate [--from <0.3目录>] [--dry-run] [--yes]
                            默认探测 ~/.penglai 与常见 0.3 路径；--dry-run 只出计划；
                            写入前自动备份（每步可回滚）；重复执行幂等跳过
  migrate rollback [--backup <目录>]   按备份 manifest 回滚一次迁移

budget（成本熔断：80% 预警 / 撞线降级审批模式）
  budget                    今日预算状态（用量/上限/熔断）
  budget set --daily-tokens <n|off> [--project-daily-tokens <n|off>]
  budget lift [--dimension <day|project:<id>>] [--note "…"]   撞线后 owner 放行

memory（只读；防污染铁律无后门）
  memory list [--project <id>]
  memory read <name | projectId/name>
  memory sop list|show <name>|remove <name>   SOP 技能树（蒸馏环入树的产物）

context（个人上下文 V1：Owner 显式授权目录 · 本地 FTS · 不改原文件）
  context status
  context source add <path> --scope global
  context source add <path> --scope project --project <id>
  context source list [--scope global|project] [--project <id>]
  context source reindex <source-id>
  context source remove <source-id>     只删索引，原文件保留
  context search "<query>" [--project <id>] [--global-only]
  context read <context-ref>

distill（蒸馏环：复盘 → 候选 SOP → 审计 → 入树）
  distill                   蒸馏环配置（开关 / 复盘模型档位 / 审计模型位）
  distill set [--enable|--disable] [--review-profile <id|off>] [--audit-profile <id|off>]

host
  serve [--port <n>]        前台运行 host（默认 14169）
  doctor [--export]         环境自检；可导出脱敏诊断包
  help                      本帮助
`;

export interface CliRunOptions {
  /** Default io writes to process stdout/stderr with TTY detection. */
  io?: CliIO;
  /** Skip host auto-start (status/doctor tolerate a missing host). */
  noAutoStart?: boolean;
  /** Test seam: scripted prompter for the setup wizard. */
  wizardPrompter?: WizardPrompter;
  /** Test seam: a prepared stdin replacement for the chat REPL. */
  stdin?: NodeJS.ReadableStream;
  /** Test seam: fake voice I/O (record/play/engine RPCs) for the chat REPL. */
  voiceIO?: VoiceReplDeps;
}

function defaultIO(): CliIO {
  return {
    out: (text) => process.stdout.write(text),
    line: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    tty: process.stdout.isTTY === true,
  };
}

/** Global flags that may appear anywhere in argv (--port / --token). */
function extractGlobalFlags(argv: string[]): {
  rest: string[];
  port: number;
  token?: string;
} {
  const rest: string[] = [];
  let port = DEFAULT_PORT;
  let token: string | undefined;
  let afterDoubleDash = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // Guard holes from callers that accidentally push undefined into argv.
    if (typeof arg !== "string") continue;
    if (afterDoubleDash) {
      rest.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDoubleDash = true;
      rest.push(arg);
      continue;
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      const raw = arg === "--port" ? argv[++i] : arg.slice("--port=".length);
      if (typeof raw !== "string") {
        throw new CliError("missing value for --port");
      }
      port = Number(raw);
      if (!Number.isInteger(port) || port <= 0) {
        throw new CliError(`invalid --port: ${String(raw)}`);
      }
      continue;
    }
    if (arg === "--token" || arg.startsWith("--token=")) {
      const raw = arg === "--token" ? argv[++i] : arg.slice("--token=".length);
      if (typeof raw !== "string") {
        throw new CliError("missing value for --token");
      }
      token = raw;
      continue;
    }
    rest.push(arg);
  }
  return { rest, port, token };
}

/**
 * The CLI entry. Returns the process exit code (never calls process.exit
 * itself — the bin wrapper owns the process).
 */
export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const io = options.io ?? defaultIO();
  try {
    const { rest, port, token } = extractGlobalFlags(argv);
    const args = parseArgs(rest);
    const command = args.positionals[0] ?? "chat";
    // Sub-command handlers see their own argv (the command word removed).
    const subArgs = { flags: args.flags, positionals: args.positionals.slice(1) };

    switch (command) {
      case "help":
      case "--help":
      case "-h":
        io.line(CLI_HELP);
        return 0;

      case "doctor": {
        // Doctor must work with the host down: probe, never auto-start.
        const client = await HostClient.connect({
          port,
          token,
          autoStart: false,
        }).catch(() => null);
        const ctx = makeContext(client as HostClient, io);
        return await cmdDoctor(ctx, port, { exportBundle: subArgs.flags.export === true });
      }

      case "status": {
        const client = await HostClient.connect({
          port,
          token,
          autoStart: options.noAutoStart ? false : true,
        });
        return await cmdStatus(makeContext(client, io));
      }

      case "chat": {
        if (args.flags.list === true) {
          const client = await HostClient.connect({ port, token });
          return await cmdChatList(client, io);
        }
        const client = await HostClient.connect({ port, token });
        // 0.3.x 传统「裸跑即聊」：已有 key 就绪的模型档案 → 直接进 chat；
        // 没有 → 首次运行向导（非 tty 降级为一行引导文案，不挂起）。
        const bareRun = args.positionals.length === 0;
        if (bareRun) {
          const resolved = (await client.rpc("config.resolveProfile", {})) as {
            profile: { id: string } | null;
            hasKey: boolean;
          };
          if (!resolved.profile || !resolved.hasKey) {
            const profileId = await cmdSetup(makeContext(client, io), options.wizardPrompter);
            if (!profileId) return 0; // 降级路径已打印引导
            io.line("");
          }
        }
        return await cmdChatRepl(
          client,
          subArgs,
          io,
          options.stdin,
          options.voiceIO ?? productionVoiceDeps(client),
        );
      }

      case "setup": {
        const client = await HostClient.connect({ port, token });
        const profileId = await cmdSetup(makeContext(client, io), options.wizardPrompter);
        if (profileId) io.line("现在可以 `penglai` 开聊了。");
        return 0;
      }

      case "mode": {
        const client = await HostClient.connect({ port, token });
        return await cmdMode(makeContext(client, io), subArgs);
      }

      case "work": {
        const client = await HostClient.connect({ port, token });
        return await cmdWork(makeContext(client, io), subArgs);
      }

      case "task": {
        const client = await HostClient.connect({ port, token });
        return await cmdTask(makeContext(client, io), subArgs);
      }

      case "approval": {
        const client = await HostClient.connect({ port, token });
        return await cmdApproval(makeContext(client, io), subArgs);
      }

      case "project": {
        const client = await HostClient.connect({ port, token });
        return await cmdProject(makeContext(client, io), subArgs);
      }

      case "memory": {
        const client = await HostClient.connect({ port, token });
        return await cmdMemory(makeContext(client, io), subArgs);
      }

      case "context": {
        const client = await HostClient.connect({ port, token });
        return await cmdContext(makeContext(client, io), subArgs);
      }

      case "budget": {
        const client = await HostClient.connect({ port, token });
        return await cmdBudget(makeContext(client, io), subArgs);
      }

      case "distill": {
        const client = await HostClient.connect({ port, token });
        return await cmdDistill(makeContext(client, io), subArgs);
      }

      case "config": {
        const client = await HostClient.connect({ port, token });
        return await cmdConfig(makeContext(client, io), subArgs);
      }

      case "voice": {
        const client = await HostClient.connect({ port, token });
        return await cmdVoice(makeContext(client, io), subArgs);
      }

      case "catalog": {
        const client = await HostClient.connect({ port, token });
        return await cmdCatalog(makeContext(client, io), subArgs);
      }

      case "channel": {
        const client = await HostClient.connect({ port, token });
        return await cmdChannel(makeContext(client, io), subArgs);
      }

      case "migrate": {
        // 0.3 → 0.4 离线迁移工具：直写数据目录文件，不依赖也不启动 host。
        const { cmdMigrate } = await import("./migrate-cmd.js");
        return await cmdMigrate(io, subArgs, { prompter: options.wizardPrompter });
      }

      default:
        io.err(`unknown command: ${command} (see \`penglai help\`)`);
        return 2;
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`error: ${error.message}`);
      return error.code === "invalid_params" ? 2 : 1;
    }
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? `
${error.stack}` : "";
    io.err(`fatal: ${msg}${stack}`);
    return 1;
  }
}
