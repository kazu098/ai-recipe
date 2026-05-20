// ─────────────────────────────────────────────────────────────────────────────
// HotCook（および類似の自動調理器具）対応カテゴリ体系
//
// 公式メニュー番号には依存しない。概念ベースで「どの料理タイプが対応可能か」
// 「どのカテゴリのメニューを選べばよいか」「手動モードならどう設定するか」を判定する。
//
// 設計原則:
// - 公式番号、正確な分量、機種固有情報は持たない
// - カテゴリ × トリガー × 操作モードの3点で判定する
// - 失敗しやすい料理タイプは UNSUPPORTED_PATTERNS で明確に除外する
// ─────────────────────────────────────────────────────────────────────────────

export type ManualTimeRule = {
  condition: string;
  min_min: number;
  max_min: number;
};

export type HotcookCategory = {
  id: string;
  name: string;
  description: string;
  /** 実機での自動メニュー選択経路 */
  auto_menu_path: string;
  /** このカテゴリで典型的な自動メニュー例（参考表示用） */
  auto_menu_examples: string[];
  /** 自動メニューに該当しない場合の手動モード */
  manual_mode: string;
  manual_stir: boolean;
  manual_time_rules: ManualTimeRule[];
  /** デフォルトの水分プロファイル */
  liquid_profile: "none" | "low" | "medium" | "high";
  /** カテゴリ判定のトリガー */
  triggers: {
    cooking_method?: string[];
    name_keywords?: string[];
    ingredients?: string[];
  };
  fragile_ingredients?: string[];
  /** 必須下処理（食材→処理内容のマッピング） */
  required_prep?: { ingredients: string[]; prep: string }[];
  notes?: string[];
};

export const HOTCOOK_CATEGORIES: HotcookCategory[] = [
  {
    id: "stew_meat",
    name: "煮物（肉）",
    description: "肉と野菜を煮る系統。肉じゃが・筑前煮・角煮・豚バラ大根など。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 煮物 → 肉",
    auto_menu_examples: ["肉じゃが", "筑前煮", "豚バラ大根", "豚の角煮", "豚肉のトマト煮こみ"],
    manual_mode: "手動で作る → 煮物を作る → まぜる",
    manual_stir: true,
    manual_time_rules: [
      { condition: "薄切り肉＋葉物・きのこ", min_min: 10, max_min: 20 },
      { condition: "鶏もも・豚こま＋根菜", min_min: 20, max_min: 35 },
      { condition: "大根・じゃがいも・里芋", min_min: 25, max_min: 45 },
      { condition: "かたまり肉（角煮など）", min_min: 60, max_min: 90 },
    ],
    liquid_profile: "low",
    triggers: {
      cooking_method: ["煮込み", "煮物"],
      name_keywords: ["煮", "煮込み", "肉じゃが", "筑前煮", "角煮"],
      ingredients: ["豚肉", "鶏肉", "牛肉", "ひき肉", "豚バラ", "鶏もも", "鶏むね"],
    },
    required_prep: [
      {
        ingredients: ["豚バラかたまり", "牛すじ"],
        prep: "事前に下ゆでで油・アクを抜く（手動スープ・まぜないで30分推奨）",
      },
    ],
  },
  {
    id: "stew_fish",
    name: "煮物（魚）",
    description: "魚の煮つけ・味噌煮など。崩れやすいのでまぜない。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 煮物 → 魚介",
    auto_menu_examples: ["さばの味噌煮", "ぶり大根", "いわしの生姜煮", "金目鯛の煮つけ"],
    manual_mode: "手動で作る → 煮物を作る → まぜない",
    manual_stir: false,
    manual_time_rules: [
      { condition: "魚の切り身", min_min: 10, max_min: 15 },
      { condition: "骨まで柔らかくしたい魚", min_min: 120, max_min: 150 },
    ],
    liquid_profile: "low",
    triggers: {
      cooking_method: ["煮込み", "煮物"],
      name_keywords: ["煮", "煮つけ", "味噌煮"],
      ingredients: ["さば", "ぶり", "いわし", "たら", "鮭", "金目鯛", "白身魚"],
    },
    fragile_ingredients: ["魚", "切り身"],
    required_prep: [
      {
        ingredients: ["さば", "ぶり", "いわし", "白身魚"],
        prep: "霜降りまたは塩ふりで臭み取りを行う",
      },
    ],
  },
  {
    id: "stew_vegetables",
    name: "煮物（野菜・乾物）",
    description: "かぼちゃ煮・ひじき・切り干し大根・ラタトゥイユ・きんぴらなど。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 煮物 → 野菜",
    auto_menu_examples: ["かぼちゃの煮物", "ラタトゥイユ", "ひじきの煮物", "切り干し大根", "きんぴらごぼう"],
    manual_mode: "手動で作る → 煮物を作る → まぜない（崩れる場合）／まぜる（炒め煮系）",
    manual_stir: false,
    manual_time_rules: [
      { condition: "かぼちゃ・なす", min_min: 15, max_min: 20 },
      { condition: "乾物（ひじき・切り干し大根）", min_min: 15, max_min: 25 },
      { condition: "根菜きんぴら", min_min: 10, max_min: 15 },
    ],
    liquid_profile: "low",
    triggers: {
      cooking_method: ["煮込み", "煮物"],
      name_keywords: ["きんぴら", "ひじき", "切り干し", "ラタトゥイユ", "野菜煮"],
      ingredients: ["かぼちゃ", "ひじき", "切り干し大根", "なす", "里芋", "高野豆腐"],
    },
    fragile_ingredients: ["かぼちゃ", "豆腐"],
  },
  {
    id: "curry_stew",
    name: "カレー・シチュー",
    description: "カレー・シチュー・ハヤシ。まぜ技ユニットで均一に。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → カレー・シチュー",
    auto_menu_examples: ["チキンと野菜のカレー", "ビーフカレー", "キーマカレー", "無水カレー", "クリームシチュー"],
    manual_mode: "手動で作る → 煮物を作る → まぜる",
    manual_stir: true,
    manual_time_rules: [
      { condition: "鶏もも・豚こま＋野菜", min_min: 25, max_min: 40 },
      { condition: "牛肉＋根菜", min_min: 40, max_min: 60 },
      { condition: "ひき肉キーマ", min_min: 20, max_min: 30 },
    ],
    liquid_profile: "medium",
    triggers: {
      cooking_method: ["煮込み"],
      name_keywords: ["カレー", "シチュー", "ハヤシ"],
    },
    notes: ["牛乳・生クリームは加熱終了後に加えること（分離防止）"],
  },
  {
    id: "soup_clear",
    name: "スープ（具だくさん）",
    description: "豚汁・味噌汁・ポトフ・コンソメスープなど。まぜない。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → スープ",
    auto_menu_examples: ["豚汁", "具だくさん味噌汁", "ポトフ", "ミネストローネ"],
    manual_mode: "手動で作る → スープを作る → まぜない",
    manual_stir: false,
    manual_time_rules: [
      { condition: "葉物・薄切り肉中心", min_min: 10, max_min: 15 },
      { condition: "根菜中心", min_min: 20, max_min: 30 },
    ],
    liquid_profile: "high",
    triggers: {
      cooking_method: ["スープ", "汁物"],
      name_keywords: ["スープ", "味噌汁", "汁", "ポトフ", "ミネストローネ", "豚汁"],
    },
  },
  {
    id: "soup_creamy",
    name: "ポタージュ・クリームスープ",
    description: "ポタージュ系のなめらかなスープ。まぜる。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → スープ",
    auto_menu_examples: ["コーンポタージュ", "かぼちゃのポタージュ", "クラムチャウダー"],
    manual_mode: "手動で作る → スープを作る → まぜる",
    manual_stir: true,
    manual_time_rules: [{ condition: "ポタージュ用野菜", min_min: 20, max_min: 30 }],
    liquid_profile: "high",
    triggers: {
      name_keywords: ["ポタージュ", "チャウダー", "ビスク"],
    },
    notes: ["牛乳・生クリームは加熱後に加えること"],
  },
  {
    id: "steamed",
    name: "蒸し物",
    description: "茶碗蒸し・蒸し鶏・シュウマイなど。蒸し板使用。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 蒸し物",
    auto_menu_examples: ["茶碗蒸し", "蒸し鶏", "蒸し野菜", "シュウマイ"],
    manual_mode: "手動で作る → 蒸し板を使って蒸す",
    manual_stir: false,
    manual_time_rules: [
      { condition: "茶碗蒸し・卵料理", min_min: 20, max_min: 30 },
      { condition: "蒸し鶏（むね）", min_min: 25, max_min: 35 },
      { condition: "シュウマイ・中華まん", min_min: 15, max_min: 20 },
    ],
    liquid_profile: "low",
    triggers: {
      cooking_method: ["蒸し"],
      name_keywords: ["蒸し", "茶碗蒸し", "シュウマイ", "肉まん"],
    },
    notes: ["蒸し板が必要"],
  },
  {
    id: "boiled_waterless",
    name: "無水ゆで（野菜）",
    description: "ブロッコリー・じゃがいも・とうもろこしなどの下処理に。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → ゆで物",
    auto_menu_examples: ["ブロッコリーゆで", "じゃがいもゆで", "とうもろこし"],
    manual_mode: "手動で作る → 無水でゆでる",
    manual_stir: false,
    manual_time_rules: [
      { condition: "葉物・ブロッコリー", min_min: 5, max_min: 8 },
      { condition: "じゃがいも・さつまいも", min_min: 15, max_min: 25 },
    ],
    liquid_profile: "none",
    triggers: {
      cooking_method: ["ゆで"],
      name_keywords: ["ゆで", "茹で", "下ゆで"],
    },
  },
  {
    id: "fermented_lowtemp",
    name: "発酵・低温調理",
    description: "ヨーグルト・甘酒・サラダチキン・ローストビーフ風など。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 発酵・低温調理",
    auto_menu_examples: ["ヨーグルト", "甘酒", "サラダチキン", "ローストビーフ風"],
    manual_mode: "手動で作る → 発酵・低温調理をする",
    manual_stir: false,
    manual_time_rules: [
      { condition: "ヨーグルト・甘酒", min_min: 360, max_min: 480 },
      { condition: "鶏むね低温調理（63℃）", min_min: 60, max_min: 90 },
      { condition: "ローストビーフ風（57℃）", min_min: 90, max_min: 120 },
    ],
    liquid_profile: "low",
    triggers: {
      name_keywords: ["サラダチキン", "ヨーグルト", "甘酒", "ローストビーフ", "低温"],
    },
    notes: ["温度・時間管理が重要。食材の厚みと衛生管理に注意"],
  },
  {
    id: "rice",
    name: "ごはん・リゾット",
    description: "白ごはん・炊き込みごはん・リゾット。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → ごはん",
    auto_menu_examples: ["白ごはん", "炊き込みごはん", "リゾット"],
    manual_mode: "手動で作る → ごはんを炊く",
    manual_stir: false,
    manual_time_rules: [
      { condition: "白ごはん・炊き込み", min_min: 30, max_min: 45 },
      { condition: "リゾット", min_min: 25, max_min: 35 },
    ],
    liquid_profile: "medium",
    triggers: {
      name_keywords: ["ごはん", "炊き込み", "リゾット", "ピラフ", "おこわ"],
    },
  },
  {
    id: "stir_braised",
    name: "炒め煮（しっとり系）",
    description: "麻婆豆腐・回鍋肉・ミートソースなど、シャキッとさせない炒め系。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 煮物 → 肉 または 野菜",
    auto_menu_examples: ["麻婆なす", "回鍋肉", "ミートソース", "ガパオ風"],
    manual_mode: "手動で作る → 煮物を作る → まぜる",
    manual_stir: true,
    manual_time_rules: [{ condition: "薄切り肉＋野菜", min_min: 10, max_min: 20 }],
    liquid_profile: "low",
    triggers: {
      name_keywords: ["麻婆", "回鍋肉", "ミートソース", "炒め煮", "ガパオ", "プルコギ"],
    },
    notes: ["シャキッと感は出ない。しっとり仕上がりが好きな料理向け"],
  },
  {
    id: "pasta_sauce",
    name: "パスタソース・パスタ",
    description: "ミートソース・トマトソース等のソース作り。具材を煮込んで作る。",
    auto_menu_path: "メニューを選ぶ → カテゴリーで探す → 煮物 → 肉 または 麺類",
    auto_menu_examples: ["ミートソース", "ナポリタンソース", "パスタソース"],
    manual_mode: "手動で作る → 煮物を作る → まぜる",
    manual_stir: true,
    manual_time_rules: [{ condition: "ひき肉＋トマト＋玉ねぎ", min_min: 20, max_min: 35 }],
    liquid_profile: "medium",
    triggers: {
      name_keywords: ["パスタソース", "ミートソース", "ボロネーゼ", "ナポリタン"],
    },
    notes: ["麺は鍋で別茹でする（パスタの茹では別調理を推奨）"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HotCook で対応できない料理パターン
// 揚げ物・焼き目が必要な料理・シャキッと炒めなどは絶対に提案しないこと
// ─────────────────────────────────────────────────────────────────────────────
export const UNSUPPORTED_PATTERNS = {
  cooking_methods: ["揚げ", "焼き"],
  name_keywords: [
    // 揚げ物
    "唐揚げ", "から揚げ", "竜田揚げ", "天ぷら", "フライ", "コロッケ",
    "メンチカツ", "とんかつ", "ハムカツ", "エビフライ", "唐揚",
    // 焼き物（焦げ目が必要）
    "ステーキ", "ハンバーグ", "焼き魚", "塩焼き", "照り焼き", "ムニエル",
    "餃子", "焼き餃子", "お好み焼き", "もんじゃ",
    // 卵料理（焼き系）
    "卵焼き", "だし巻き", "目玉焼き", "オムレツ", "オムライス", "スクランブル",
    // シャキッと炒め
    "チャーハン", "焼きそば", "焼きうどん", "野菜炒め", "ペペロンチーノ",
    "焼き飯", "炒飯", "回鍋肉風（シャキシャキ）",
    // パン・グリル
    "トースト", "サンドイッチ", "ホットサンド", "パニーニ", "ピザ",
    "グラタン", "ドリア",
    // その他
    "刺身", "寿司", "握り",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 提案テンプレート（プロンプト挿入用）
// analyze API で AI に「これは作れる/作れない」を明示的に伝えるための文字列
// ─────────────────────────────────────────────────────────────────────────────
export const HOTCOOK_SUPPORTED_EXAMPLES = HOTCOOK_CATEGORIES.flatMap((c) =>
  c.auto_menu_examples.slice(0, 3)
);

export const HOTCOOK_UNSUPPORTED_EXAMPLES = UNSUPPORTED_PATTERNS.name_keywords.slice(0, 20);
