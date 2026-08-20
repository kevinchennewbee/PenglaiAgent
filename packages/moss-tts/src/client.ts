import { t, type PenglaiLocale } from "@penglai/contracts";

export const name = "@penglai/moss-tts/client";

export function contribute(locale: PenglaiLocale = "zh"): { slot: "settings.section"; title: string } {
  return { slot: "settings.section", title: t(locale, "ttsTitle") };
}
