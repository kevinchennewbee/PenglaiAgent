import { t, type PenglaiLocale } from "@penglai/contracts";

export const name = "@penglai/asr/client";

export function contribute(locale: PenglaiLocale = "zh"): { slot: "settings.section"; title: string } {
  return { slot: "settings.section", title: t(locale, "asrTitle") };
}

export function conversationSlots(locale: PenglaiLocale = "zh"): Array<{ slot: string; title: string }> {
  return [
    contribute(locale),
    { slot: "conversation.input.right", title: locale === "en" ? "Voice input" : "语音输入" },
  ];
}
