export type HotcookMenu = {
  id: number;
  name: string;
  type: "auto" | "manual";
  category: string[];
  cooking_time_min: number;
  stir_unit: boolean;
  waterless: boolean;
  reservation: boolean;
  servings: string;
  main_ingredients: string[];
  liquid_profile: "none" | "low" | "medium" | "high";
  texture: string[];
  stir_mode?: boolean;
  manual_mode?: string;
  time_after_boil_min?: number;
  notes?: string[];
};

export const AUTO_MENUS: HotcookMenu[] = [
  // ── 煮物・肉 ──────────────────────────────────────────────
  { id: 1, name: "肉じゃが", type: "auto", category: ["煮物", "肉"], cooking_time_min: 35, stir_unit: true, waterless: false, reservation: true, servings: "2〜6人分", main_ingredients: ["じゃがいも", "玉ねぎ", "牛肉", "にんじん"], liquid_profile: "low", texture: ["煮込み", "甘辛"], notes: ["牛肉の代わりに豚肉可", "じゃがいも4個でMAX"] },
  { id: 2, name: "豚の角煮", type: "auto", category: ["煮物", "肉"], cooking_time_min: 90, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["豚バラかたまり"], liquid_profile: "medium", texture: ["とろとろ", "甘辛"], notes: ["事前に手動スープ/まぜないで30分油抜き推奨"] },
  { id: 3, name: "鶏と根菜の煮物", type: "auto", category: ["煮物", "肉"], cooking_time_min: 45, stir_unit: false, waterless: false, reservation: true, servings: "2〜6人分", main_ingredients: ["鶏もも肉", "ごぼう", "にんじん", "れんこん"], liquid_profile: "low", texture: ["煮込み", "和風"] },
  { id: 4, name: "筑前煮", type: "auto", category: ["煮物", "肉"], cooking_time_min: 45, stir_unit: false, waterless: false, reservation: true, servings: "2〜6人分", main_ingredients: ["鶏もも肉", "ごぼう", "にんじん", "れんこん", "こんにゃく", "干し椎茸"], liquid_profile: "low", texture: ["煮込み", "和風"] },
  { id: 5, name: "豚肉と大根の煮物", type: "auto", category: ["煮物", "肉"], cooking_time_min: 45, stir_unit: false, waterless: false, reservation: true, servings: "2〜4人分", main_ingredients: ["豚バラ肉", "大根"], liquid_profile: "medium", texture: ["煮込み", "和風"] },
  { id: 6, name: "豚肉のトマト煮こみ", type: "auto", category: ["煮物", "肉"], cooking_time_min: 65, stir_unit: true, waterless: true, reservation: false, servings: "2〜4人分", main_ingredients: ["豚ロース肉", "玉ねぎ", "トマト水煮"], liquid_profile: "medium", texture: ["ソース", "洋風"] },
  { id: 7, name: "鶏と野菜の炒め煮", type: "auto", category: ["煮物", "肉"], cooking_time_min: 25, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["鶏もも肉", "玉ねぎ", "キャベツ"], liquid_profile: "low", texture: ["炒め煮", "和洋"] },
  { id: 8, name: "回鍋肉", type: "auto", category: ["煮物", "肉"], cooking_time_min: 20, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["豚バラ肉", "キャベツ", "ピーマン"], liquid_profile: "low", texture: ["炒め煮", "中華"] },
  { id: 9, name: "麻婆なす", type: "auto", category: ["煮物", "肉"], cooking_time_min: 25, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["なす", "豚ひき肉"], liquid_profile: "low", texture: ["とろみ", "中華", "辛め"] },
  { id: 10, name: "豚バラ白菜", type: "auto", category: ["煮物", "肉"], cooking_time_min: 30, stir_unit: false, waterless: true, reservation: false, servings: "2〜4人分", main_ingredients: ["豚バラ肉", "白菜"], liquid_profile: "none", texture: ["重ね煮", "和風"], notes: ["白菜から大量の水が出るので追加水不要"] },
  { id: 11, name: "牛すじの煮込み", type: "auto", category: ["煮物", "肉"], cooking_time_min: 120, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["牛すじ"], liquid_profile: "medium", texture: ["とろとろ", "和風"], notes: ["アク抜き下ゆでを先に行うこと"] },
  { id: 12, name: "ロールキャベツ", type: "auto", category: ["煮物", "肉"], cooking_time_min: 50, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["キャベツ", "合い挽き肉"], liquid_profile: "medium", texture: ["洋風", "煮込み"] },
  { id: 13, name: "ひじきの煮物", type: "auto", category: ["煮物", "乾物・豆"], cooking_time_min: 25, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["ひじき", "油揚げ", "にんじん"], liquid_profile: "low", texture: ["甘辛", "和風"] },
  { id: 14, name: "切り干し大根", type: "auto", category: ["煮物", "乾物・豆"], cooking_time_min: 25, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["切り干し大根", "油揚げ"], liquid_profile: "low", texture: ["甘辛", "和風"] },
  { id: 15, name: "大豆の煮物", type: "auto", category: ["煮物", "乾物・豆"], cooking_time_min: 60, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["大豆（乾燥）"], liquid_profile: "medium", texture: ["甘辛", "和風"], notes: ["前日から水戻しが必要"] },
  // ── 煮物・魚介 ─────────────────────────────────────────────
  { id: 20, name: "さばの味噌煮", type: "auto", category: ["煮物", "魚介"], cooking_time_min: 20, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["さば"], liquid_profile: "low", texture: ["和風", "味噌"], notes: ["霜降りで臭み取り推奨"] },
  { id: 21, name: "いわしの生姜煮", type: "auto", category: ["煮物", "魚介"], cooking_time_min: 25, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["いわし"], liquid_profile: "low", texture: ["甘辛", "和風"], notes: ["骨まで食べられる仕上がり"] },
  { id: 22, name: "ぶりの照り焼き風", type: "auto", category: ["煮物", "魚介"], cooking_time_min: 20, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["ぶり"], liquid_profile: "low", texture: ["照り焼き", "甘辛"] },
  { id: 23, name: "あさりの酒蒸し", type: "auto", category: ["蒸し物", "魚介"], cooking_time_min: 15, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["あさり"], liquid_profile: "low", texture: ["あっさり", "和風"] },
  // ── 煮物・野菜 ─────────────────────────────────────────────
  { id: 30, name: "かぼちゃの煮物", type: "auto", category: ["煮物", "野菜"], cooking_time_min: 20, stir_unit: false, waterless: false, reservation: true, servings: "2〜4人分", main_ingredients: ["かぼちゃ"], liquid_profile: "low", texture: ["甘辛", "和風"], notes: ["崩れやすいのでまぜない"] },
  { id: 31, name: "ラタトゥイユ", type: "auto", category: ["煮物", "野菜"], cooking_time_min: 45, stir_unit: false, waterless: true, reservation: false, servings: "2〜4人分", main_ingredients: ["なす", "ズッキーニ", "トマト", "玉ねぎ", "パプリカ"], liquid_profile: "none", texture: ["洋風", "無水煮"] },
  { id: 32, name: "きんぴらごぼう", type: "auto", category: ["煮物", "野菜"], cooking_time_min: 15, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["ごぼう", "にんじん"], liquid_profile: "low", texture: ["甘辛", "和風", "きんぴら"] },
  { id: 33, name: "もやし炒め", type: "auto", category: ["煮物", "野菜"], cooking_time_min: 10, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["もやし"], liquid_profile: "none", texture: ["あっさり", "炒め"] },
  // ── ごはん・リゾット ────────────────────────────────────────
  { id: 40, name: "白ごはん", type: "auto", category: ["ごはん"], cooking_time_min: 40, stir_unit: false, waterless: false, reservation: true, servings: "1〜6人分", main_ingredients: ["米"], liquid_profile: "medium", texture: ["ごはん"] },
  { id: 41, name: "リゾット", type: "auto", category: ["ごはん", "洋食"], cooking_time_min: 35, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["米", "玉ねぎ"], liquid_profile: "high", texture: ["クリーム", "洋風"] },
  { id: 42, name: "炊き込みごはん", type: "auto", category: ["ごはん"], cooking_time_min: 45, stir_unit: false, waterless: false, reservation: true, servings: "2〜4人分", main_ingredients: ["米", "鶏もも肉", "ごぼう", "にんじん"], liquid_profile: "medium", texture: ["和風", "炊き込み"] },
  // ── カレー・シチュー ────────────────────────────────────────
  { id: 50, name: "チキンと野菜のカレー", type: "auto", category: ["カレー・シチュー"], cooking_time_min: 55, stir_unit: true, waterless: false, reservation: false, servings: "2〜6人分", main_ingredients: ["鶏もも肉", "玉ねぎ", "じゃがいも", "にんじん"], liquid_profile: "medium", texture: ["カレー", "スパイシー"] },
  { id: 51, name: "ビーフカレー", type: "auto", category: ["カレー・シチュー"], cooking_time_min: 65, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["牛肉", "玉ねぎ", "じゃがいも", "にんじん"], liquid_profile: "medium", texture: ["カレー", "濃厚"] },
  { id: 52, name: "キーマカレー", type: "auto", category: ["カレー・シチュー"], cooking_time_min: 30, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["合い挽き肉", "玉ねぎ", "トマト"], liquid_profile: "low", texture: ["カレー", "ドライ"] },
  { id: 53, name: "無水カレー", type: "auto", category: ["カレー・シチュー"], cooking_time_min: 60, stir_unit: true, waterless: true, reservation: false, servings: "2〜4人分", main_ingredients: ["鶏もも肉", "玉ねぎ", "トマト"], liquid_profile: "none", texture: ["カレー", "濃厚", "無水"] },
  { id: 54, name: "クリームシチュー", type: "auto", category: ["カレー・シチュー"], cooking_time_min: 50, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["鶏もも肉", "じゃがいも", "にんじん", "玉ねぎ"], liquid_profile: "high", texture: ["クリーム", "洋風"], notes: ["牛乳・生クリームは加熱後に加える"] },
  { id: 55, name: "豚汁", type: "auto", category: ["スープ"], cooking_time_min: 30, stir_unit: false, waterless: false, reservation: false, servings: "2〜6人分", main_ingredients: ["豚バラ肉", "大根", "にんじん", "こんにゃく", "ごぼう"], liquid_profile: "high", texture: ["味噌", "和風", "汁物"] },
  // ── スープ ──────────────────────────────────────────────────
  { id: 60, name: "ポトフ", type: "auto", category: ["スープ"], cooking_time_min: 50, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["鶏肉", "キャベツ", "にんじん", "じゃがいも", "玉ねぎ"], liquid_profile: "high", texture: ["あっさり", "洋風", "コンソメ"] },
  { id: 61, name: "クラムチャウダー", type: "auto", category: ["スープ"], cooking_time_min: 35, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["あさり", "じゃがいも", "玉ねぎ"], liquid_profile: "high", texture: ["クリーム", "洋風"], notes: ["牛乳・生クリームは加熱後に加える"] },
  { id: 62, name: "コーンポタージュ", type: "auto", category: ["スープ"], cooking_time_min: 30, stir_unit: true, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["コーン", "玉ねぎ"], liquid_profile: "high", texture: ["ポタージュ", "洋風"] },
  { id: 63, name: "具だくさん味噌汁", type: "auto", category: ["スープ"], cooking_time_min: 25, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["豆腐", "わかめ", "なす"], liquid_profile: "high", texture: ["味噌", "和風", "汁物"] },
  { id: 64, name: "ミネストローネ", type: "auto", category: ["スープ"], cooking_time_min: 40, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["トマト缶", "玉ねぎ", "セロリ", "にんじん"], liquid_profile: "high", texture: ["洋風", "トマト"] },
  // ── 蒸し物 ──────────────────────────────────────────────────
  { id: 70, name: "茶碗蒸し", type: "auto", category: ["蒸し物"], cooking_time_min: 30, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["卵", "だし"], liquid_profile: "medium", texture: ["なめらか", "和風"], notes: ["蒸し板使用。崩れやすいので丁寧に"] },
  { id: 71, name: "蒸し鶏", type: "auto", category: ["蒸し物"], cooking_time_min: 35, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["鶏むね肉"], liquid_profile: "low", texture: ["あっさり", "ヘルシー"], notes: ["蒸し板使用"] },
  // ── ゆで物 ──────────────────────────────────────────────────
  { id: 80, name: "ブロッコリーゆで", type: "auto", category: ["ゆで物", "野菜"], cooking_time_min: 10, stir_unit: false, waterless: true, reservation: false, servings: "2〜4人分", main_ingredients: ["ブロッコリー"], liquid_profile: "none", texture: ["やわらか", "無水"] },
  { id: 81, name: "じゃがいもゆで", type: "auto", category: ["ゆで物", "野菜"], cooking_time_min: 20, stir_unit: false, waterless: true, reservation: false, servings: "2〜4人分", main_ingredients: ["じゃがいも"], liquid_profile: "none", texture: ["やわらか", "無水"] },
  // ── 発酵・低温調理 ─────────────────────────────────────────
  { id: 90, name: "甘酒", type: "auto", category: ["発酵"], cooking_time_min: 360, stir_unit: false, waterless: false, reservation: false, servings: "4〜6人分", main_ingredients: ["米麹"], liquid_profile: "medium", texture: ["甘酒", "発酵"] },
  { id: 91, name: "ヨーグルト", type: "auto", category: ["発酵"], cooking_time_min: 480, stir_unit: false, waterless: false, reservation: false, servings: "4〜6人分", main_ingredients: ["牛乳", "ヨーグルト菌"], liquid_profile: "high", texture: ["ヨーグルト", "発酵"] },
  { id: 92, name: "低温調理チキン", type: "auto", category: ["発酵・低温調理"], cooking_time_min: 70, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["鶏むね肉"], liquid_profile: "low", texture: ["しっとり", "ヘルシー"], notes: ["中心温度管理が重要。63℃/30分以上"] },
  // ── めん類 ──────────────────────────────────────────────────
  { id: 100, name: "パスタ", type: "auto", category: ["めん類"], cooking_time_min: 30, stir_unit: false, waterless: false, reservation: false, servings: "2〜4人分", main_ingredients: ["パスタ"], liquid_profile: "high", texture: ["洋風"], notes: ["水はパスタが浸かる量"] },
  // ── お菓子・パン ───────────────────────────────────────────
  { id: 110, name: "ケーキ", type: "auto", category: ["お菓子・パン"], cooking_time_min: 60, stir_unit: false, waterless: false, reservation: false, servings: "4〜6人分", main_ingredients: ["薄力粉", "卵", "バター"], liquid_profile: "low", texture: ["スイーツ"] },
  { id: 111, name: "蒸しパン", type: "auto", category: ["お菓子・パン"], cooking_time_min: 45, stir_unit: false, waterless: false, reservation: false, servings: "4〜6人分", main_ingredients: ["薄力粉", "卵", "牛乳"], liquid_profile: "medium", texture: ["スイーツ", "ふわふわ"] },
];

export const MANUAL_MENUS: HotcookMenu[] = [
  { id: 200, name: "煮物を作る（まぜる）", type: "manual", category: ["煮物"], cooking_time_min: 0, stir_unit: true, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "low", texture: ["炒め煮", "あんかけ", "カレー系"], time_after_boil_min: 20, stir_mode: true, manual_mode: "煮物を作る → まぜる" },
  { id: 201, name: "煮物を作る（まぜない）", type: "manual", category: ["煮物"], cooking_time_min: 0, stir_unit: false, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "low", texture: ["魚の煮つけ", "かぼちゃ", "豆腐入り"], time_after_boil_min: 20, stir_mode: false, manual_mode: "煮物を作る → まぜない" },
  { id: 202, name: "スープを作る（まぜる）", type: "manual", category: ["スープ"], cooking_time_min: 0, stir_unit: true, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "high", texture: ["ポタージュ", "クリーム系"], time_after_boil_min: 15, stir_mode: true, manual_mode: "スープを作る → まぜる" },
  { id: 203, name: "スープを作る（まぜない）", type: "manual", category: ["スープ"], cooking_time_min: 0, stir_unit: false, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "high", texture: ["具だくさん", "味噌汁", "澄まし汁"], time_after_boil_min: 15, stir_mode: false, manual_mode: "スープを作る → まぜない" },
  { id: 204, name: "炒める", type: "manual", category: ["炒め物"], cooking_time_min: 0, stir_unit: true, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "none", texture: ["炒め", "シャキシャキ"], time_after_boil_min: 5, stir_mode: true, manual_mode: "炒める" },
  { id: 205, name: "無水でゆでる", type: "manual", category: ["ゆで物"], cooking_time_min: 0, stir_unit: false, waterless: true, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "none", texture: ["ゆで野菜", "下処理"], time_after_boil_min: 10, stir_mode: false, manual_mode: "無水でゆでる" },
  { id: 206, name: "蒸し板を使って蒸す", type: "manual", category: ["蒸し物"], cooking_time_min: 0, stir_unit: false, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "low", texture: ["蒸し", "茶碗蒸し", "シュウマイ"], time_after_boil_min: 15, stir_mode: false, manual_mode: "蒸し板を使って蒸す" },
  { id: 207, name: "発酵・低温調理をする", type: "manual", category: ["発酵・低温調理"], cooking_time_min: 0, stir_unit: false, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "low", texture: ["低温", "ヨーグルト", "甘酒"], time_after_boil_min: 60, stir_mode: false, manual_mode: "発酵・低温調理をする" },
  { id: 208, name: "好みの設定加熱", type: "manual", category: ["汎用"], cooking_time_min: 0, stir_unit: false, waterless: false, reservation: false, servings: "任意", main_ingredients: [], liquid_profile: "medium", texture: ["汎用"], time_after_boil_min: 20, stir_mode: false, manual_mode: "好みの設定加熱" },
];

export const ALL_MENUS = [...AUTO_MENUS, ...MANUAL_MENUS];
