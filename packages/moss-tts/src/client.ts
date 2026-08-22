import { t, type PenglaiLocale } from "@penglai/contracts";

export const name = "@penglai/moss-tts/client";

export function contribute(locale: PenglaiLocale = "zh"): { slot: "settings.section"; title: string } {
  return { slot: "settings.section", title: t(locale, "ttsTitle") };
}

export function conversationSlots(locale: PenglaiLocale = "zh"): Array<{ slot: string; title: string }> {
  return [
    contribute(locale),
    { slot: "conversation.chat.assistant-actions", title: locale === "en" ? "Read aloud" : "朗读" },
  ];
}
