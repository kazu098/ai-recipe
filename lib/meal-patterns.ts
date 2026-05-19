export type ComponentRole = "main" | "side" | "soup";

export type LocalizedLabel = {
  ja: string;
  en: string;
};

export type MealComponent = {
  role: ComponentRole;
  label: LocalizedLabel;
  optional: boolean;
};

export type MealPattern = {
  id: string;
  label: LocalizedLabel;
  emoji: string;
  description: LocalizedLabel;
  components: MealComponent[];
};

export const MEAL_PATTERNS: MealPattern[] = [
  {
    id: "japanese",
    label: { ja: "和食", en: "Japanese" },
    emoji: "🍱",
    description: { ja: "主菜・副菜・汁物", en: "Main, Side, Soup" },
    components: [
      { role: "main", label: { ja: "主菜", en: "Main" }, optional: false },
      { role: "side", label: { ja: "副菜", en: "Side" }, optional: true },
      { role: "soup", label: { ja: "汁物", en: "Soup" }, optional: true },
    ],
  },
  {
    id: "western",
    label: { ja: "洋食", en: "Western" },
    emoji: "🍽️",
    description: { ja: "メイン・サイド・スープ", en: "Main, Side, Soup" },
    components: [
      { role: "main", label: { ja: "メイン", en: "Main" }, optional: false },
      { role: "side", label: { ja: "サイド", en: "Side" }, optional: true },
      { role: "soup", label: { ja: "スープ", en: "Soup" }, optional: true },
    ],
  },
  {
    id: "chinese",
    label: { ja: "中華", en: "Chinese" },
    emoji: "🥢",
    description: { ja: "主菜・副菜・スープ", en: "Main, Side, Soup" },
    components: [
      { role: "main", label: { ja: "主菜", en: "Main" }, optional: false },
      { role: "side", label: { ja: "副菜", en: "Side" }, optional: true },
      { role: "soup", label: { ja: "スープ", en: "Soup" }, optional: true },
    ],
  },
  {
    id: "korean",
    label: { ja: "韓国", en: "Korean" },
    emoji: "🫕",
    description: { ja: "メイン・バンチャン・スープ", en: "Main, Banchan, Soup" },
    components: [
      { role: "main", label: { ja: "メイン", en: "Main" }, optional: false },
      { role: "side", label: { ja: "バンチャン", en: "Banchan" }, optional: true },
      { role: "soup", label: { ja: "スープ", en: "Soup" }, optional: true },
    ],
  },
  {
    id: "ethnic",
    label: { ja: "エスニック", en: "Ethnic" },
    emoji: "🌮",
    description: { ja: "メイン・サイド", en: "Main, Side" },
    components: [
      { role: "main", label: { ja: "メイン", en: "Main" }, optional: false },
      { role: "side", label: { ja: "サイド", en: "Side" }, optional: true },
    ],
  },
  {
    id: "oneplate",
    label: { ja: "ワンプレート", en: "One Plate" },
    emoji: "🥗",
    description: { ja: "メインのみ", en: "Main only" },
    components: [
      { role: "main", label: { ja: "メイン", en: "Main" }, optional: false },
    ],
  },
];

export const DEFAULT_PATTERN = MEAL_PATTERNS[0];

export function getComponentLabel(
  pattern: MealPattern,
  role: ComponentRole,
  lang: "ja" | "en" = "ja"
): string {
  const comp = pattern.components.find((c) => c.role === role);
  return comp?.label[lang] ?? role;
}

export type ActiveComponent = {
  role: ComponentRole;
  label: string;
};

export function getActiveComponents(
  pattern: MealPattern,
  enabledRoles: ComponentRole[],
  lang: "ja" | "en" = "ja"
): ActiveComponent[] {
  return pattern.components
    .filter((c) => !c.optional || enabledRoles.includes(c.role))
    .map((c) => ({ role: c.role, label: c.label[lang] }));
}
