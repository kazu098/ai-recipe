import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ja", "en"],
  defaultLocale: "ja",
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
