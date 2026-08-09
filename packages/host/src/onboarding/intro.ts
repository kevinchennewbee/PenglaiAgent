/**
 * 身份诞生的文案与名字卫生（纯函数，零依赖）。
 *
 * CLI 向导（cli/identity-ceremony.ts）与桌面首次启动向导共用同一份
 * 自我介绍与起名规则——两端仪式一字不差。本模块不 import 任何东西，
 * 可安全打包进浏览器 bundle。
 */

export const DEFAULT_ASSISTANT_NAME = "蓬莱";

/** 名字卫生：去控制字符/换行，≤24 字；空 → 默认名。 */
export function sanitizeAssistantName(raw: string): string {
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 24);
  return cleaned || DEFAULT_ASSISTANT_NAME;
}

/** 首次自我介绍（≤5 行：单一核心 / 本地陪伴 / 记忆进化）。 */
export function introLines(name: string): string[] {
  return [
    `你好，我是${name}，今天诞生。`,
    "我只有一套核心：平时直接对话，需要做事时把项目文件夹交给我；边界会收紧到该项目，但能力不会换一套。",
    "我能在本机听和说：SenseVoice 负责语音与情绪信号，MOSS-TTS 负责朗读；主动陪伴由你开启，也由你随时关闭。",
    "我记得住事：全局记忆只放身份、偏好与跨项目判断；项目细节写进各项目自己的记忆层。",
    "我会进化：每次干完活复盘，过审计的经验会长进 SOP 技能树。请多指教。",
  ];
}
