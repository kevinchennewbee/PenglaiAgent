import { t, type PenglaiLocale } from "@penglai/contracts";

export const name = "@penglai/plugin-center/client";

export function contribute(locale: PenglaiLocale = "zh"): { slot: "settings.section"; title: string } {
  return { slot: "settings.section", title: locale === "en" ? "Penglai" : "蓬莱" };
}
