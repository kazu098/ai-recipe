# Snapmeal — 技術仕様書

> ビジネス・プロダクト仕様は SPEC.md を参照。
> 本ドキュメントは実装・インフラ・アーキテクチャに関する技術詳細をまとめる。

---

## 1. 技術スタック

| レイヤー | 採用技術 | 理由 |
|---|---|---|
| フロント | **Next.js 14+（App Router）** | PWA・SSR・Vercelとの親和性 |
| スタイル | **Tailwind CSS** | モバイルファースト・単一ページ内で高速開発 |
| PWA | **@ducanh2912/next-pwa** | manifest・Service Worker |
| 認証 | **Supabase Auth（メール+パスワード / Google OAuth）** | ユーザーに馴染みがあり、復帰導線と課金ユーザー管理がしやすい |
| DB | **Supabase PostgreSQL** | 無料500MB・RLS・型安全 |
| ストレージ | **MVPでは未使用（将来Supabase Storage）** | 現行はクライアント圧縮後のdata URL送信。保存/optin実装時にStorageへ移行 |
| AI/Vision | **Gemini 2.5 Flash-Lite Primary / GPT-4o Fallback** | 実機検証で速度・コスト最良。障害時のみOpenAIへ切替 |
| 決済 | **Stripe Checkout + Billing** | Checkout Sessionsで月額サブスク。Webhookでplan同期 |
| 分析 | **PostHog**（無料 1M event/月） | プロダクト分析・A/Bテスト |
| メール | **Supabase Authメール / Resend（将来）** | 現行はメール確認・パスワードリセット。再エンゲージは将来Resend |
| デプロイ | **Vercel**（Pro $20/月 + 追加使用量） | 商用利用・高速CI/CD・Preview/Production自動デプロイ |
| ドメイン | **Cloudflare Registrar** | 安価・WHOIS保護 |

**Vercel Pro 前提の理由:** 商用運用、Preview/Production自動デプロイ、チーム運用、$20/月の利用クレジット、使用量上限管理。2026-05-20時点の公式価格は Pro $20/月 + 追加使用量。

---

## 2. データモデル（Supabase）

```sql
-- ユーザー（Supabase Authに紐づく）
profiles (
  id UUID PRIMARY KEY,             -- auth.users.id
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  household_settings JSONB,         -- 家庭設定をまとめて
  plan TEXT DEFAULT 'free',         -- 'free' / 'pro' / 'pro_annual'
  stripe_customer_id TEXT,
  locale TEXT DEFAULT 'ja',
  photo_optin BOOLEAN DEFAULT false -- 品質改善に画像提供OK
);

-- セッション（1回の解析リクエスト）
sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ,
  tired_mode BOOLEAN,               -- 「疲れた」選択フラグ
  detected_ingredients JSONB,
  meals JSONB,                      -- 3案（phase_a: 1案, phase_b: 2案）
  selected_meal_id TEXT,            -- どれを選んだか
  cooked BOOLEAN DEFAULT false,     -- 「作った！」フィードバック
  storage_paths TEXT[]              -- 画像（optin時のみ）
);

-- マンネリ回避用：提案された料理の履歴（MVPから必須）
meal_history (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  session_id UUID REFERENCES sessions(id),
  meal_name TEXT NOT NULL,
  genre TEXT,                       -- 和食/洋食/中華/エスニック
  main_ingredient TEXT,             -- 肉/魚/卵/野菜/麺/米
  cooking_method TEXT,              -- 炒め/煮込み/焼き/揚げ/蒸し/サラダ
  was_selected BOOLEAN DEFAULT false, -- 「この献立で作る」されたか
  was_cooked BOOLEAN DEFAULT false,   -- 「作った！」されたか
  created_at TIMESTAMPTZ
);
-- INDEX: (user_id, created_at DESC) で直近の履歴を高速取得

-- 月次使用量
usage_counters (
  user_id UUID REFERENCES profiles(id),
  year_month TEXT,                  -- '2026-05'
  count INT DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);
```

**RLS（Row Level Security）**: 各テーブルで `auth.uid() = user_id` のみ閲覧可。

---

## 3. API設計

```
── Phase A: 画像解析 + 1案目即時生成 ──────────────────────────

POST /api/analyze
  body: {
    imageDataUrls: string[],
    tired_mode: boolean,
    meal_time: string,
    meal_components: { role, label }[],
    locale: 'ja'|'en',
    appliances: string[],
    user_request?: string,
    priority_ingredients?: string[]  ← 食材確認画面でタップした食材
  }
  → Server-Sent Events
     1. { event: 'ingredient', data: { item } }          ← 食材を逐次表示
     2. { event: 'meal', data: { meal, ingredients } }   ← 1案目完成 → 即画面遷移
     3. { event: 'session', data: { session_id } }       ← 認証済みユーザーのみ
     4. { event: 'done' }
  認証: ゲスト可。認証済みユーザーは usage_counters をチェック/加算
  目標レスポンス: 食材表示まで3秒 / 1案目表示まで8秒

── Phase B: テキストのみで残り2案をバックグラウンド生成 ─────────

POST /api/alternatives
  body: {
    ingredients: string[],
    tired_mode: boolean,
    meal_1_name: string,
    meal_1_type: string,
    session_id?: string,
    meal_components: { role, label }[],
    locale: 'ja'|'en',
    appliances: string[],
    user_request?: string
  }
  → Server-Sent Events
     1. { event: 'meal', data: { meal } }
     2. { event: 'meal', data: { meal } }
     3. { event: 'done' }
  タイミング: Phase Aの 'session' イベント受信直後にクライアントが自動呼び出し
  目標: ユーザーが1案目を読んでいる間（3〜5秒）に完了

── 共通 ────────────────────────────────────────────────────────

POST /api/sessions/{id}/select
  body: { meal_name }
  → meal_history.was_selected = true

POST /api/recipe
  body: { mealName, matchedIngredients, genre, cookingMethod, servings, appliances, ngFoods, side?, soup?, locale }
  → レシピ詳細（材料・調味料・作り方・ホットクック操作）をオンデマンド生成

POST /api/stripe/checkout
  → Stripe Checkout Session URLを返す

POST /api/stripe/webhook
  → 課金状態の同期

POST /api/stripe/portal
  → Stripe Billing Portal URLを返す
```

**B2B提携前提のAPI設計（将来）:**
- `POST /api/v1/partner/analyze` — APIキー認証・パートナー用
- 食材リストを直接受け取るエンドポイント（Oisix連携想定）

---

## 4. 画像処理（Vercel上限対策）

**想定枚数: 推奨3枚**（冷蔵庫の正面・野菜室・冷凍庫を想定）。最大5枚まで許容。

問題: Vercel Serverless関数のペイロード上限 4.5MB → 5枚×1MB で超過リスク

**MVPの現行解決策:**
1. クライアントで画像を圧縮（長辺1280px、JPEG品質0.7）
2. 圧縮後の `imageDataUrls` を `/api/analyze` に送信
3. サーバー側で画像を1枚ずつGemini APIに並列送信（per-image認識）
4. 画像はDB/Storageに保存しない

これにより：
- 推奨3枚の圧縮済み画像はペイロード約1.5MB → Vercel上限の余裕あり
- 1枚ずつ送信するため、枚数が増えてもAPI側の処理は安定

**将来方針:** 画像改善オプトインを実装する段階で、Supabase Storageへの直接アップロードに移行する。

---

## 5. ストリーミング設計（3フェーズ）

**Phase A-1（画像認識・並列）→ Phase A-2（献立生成・テキスト）→ Phase B（代替案・バックグラウンド）**

```typescript
// Phase A-1: 画像を1枚ずつ並列認識
const lists = await Promise.all(images.map(recognizeIngredientsOneImage));
const ingredients = mergeIngredients(lists);
// → ingredient イベントを逐次配信

// Phase A-2: 認識済み食材リスト（テキスト）のみで献立生成
const meal = await generateMealFromIngredients(ingredients, ...settings);
// → meal イベントを配信
```

**Phase A-1（画像認識・並列）- ユーザー体験:**
- 0〜5秒: 画像を1枚ずつ並列認識（3枚なら3並列）
- 食材名が次々ストリーミング表示（`ingredient` イベント）
- 各画像の認識結果をマージ・重複除去して確定

**Phase A-2（献立生成・テキストのみ）:**
- 認識済み食材リストのみをGeminiへ送信（画像は再送しない）
- 目標: A-1完了から2〜3秒で献立完成（合計目標8秒以内）

**Phase B（代替案・バックグラウンド）:**
- Phase Aの `session` イベント受信と同時にクライアントが自動呼び出し
- 食材リスト（テキスト）のみをGeminiへ送信 → Vision処理不要で高速・安価
- 目標: 3〜5秒で完了（ユーザーが1案目を読んでいる間に準備完了）
- 「別の献立を見る」タップ時に即表示（待ち時間ゼロ）

**コスト削減効果:**
Phase A-1 で軽量なJSON配列（食材名のみ）を返すため出力トークンが最小。
Phase A-2 以降は画像不要のテキスト処理のみ。**セッション全体を通じて画像トークンは3回分のみ**（従来の全一括送信と同等コスト・精度は大幅向上）。

---

## 6. ディレクトリ構成

```
ai-recipe/
├── app/
│   ├── [locale]/
│   │   ├── page.tsx                # ホーム/オンボーディング/結果/レシピ/設定/ログインを統合
│   │   ├── layout.tsx              # next-intl provider
│   │   ├── auth/
│   │   │   ├── callback/route.ts   # Supabase OAuth/メール確認 callback
│   │   │   └── reset-password/page.tsx
│   │   └── stripe-test/            # Stripe疎通テスト
│   ├── api/
│   │   ├── analyze/route.ts        # Phase A-1: per-image並列認識 / A-2: テキスト1案生成（SSE）
│   │   ├── alternatives/route.ts   # Phase B: テキストのみ2案生成（SSE）
│   │   ├── recipe/route.ts         # Phase C: レシピ詳細生成
│   │   ├── sessions/[id]/select/route.ts
│   │   ├── stripe/checkout/route.ts
│   │   ├── stripe/portal/route.ts
│   │   └── stripe/webhook/route.ts
│   └── layout.tsx                  # PWA・i18nプロバイダ
├── lib/
│   ├── hotcook/                    # ホットクックカテゴリ/原理エンジン
│   ├── supabase/                   # クライアント・DB helper
│   ├── meal-patterns.ts            # 主菜/副菜/汁物の構成
│   └── stripe.ts
├── messages/                       # i18n（日本語/英語）
│   ├── ja.json
│   └── en.json
├── public/
│   ├── manifest.json
│   └── icons/
├── SPEC.md                         # ビジネス・プロダクト仕様
└── TECH.md                         # 技術仕様（本ドキュメント）
```

---

## 7. AI / プロンプト設計（3フェーズ）

**3フェーズ戦略:**
- Phase A-1: 画像1枚ずつ並列 → 食材認識のみ（軽量・高精度）
- Phase A-2: 認識済み食材リスト（テキスト）→ 最優先の1案を生成
- Phase B: 食材リスト（テキスト）のみ → 残り2案を生成（バックグラウンド）

---

**Phase A-1 プロンプト（画像1枚・食材認識のみ）:**

```
冷蔵庫の写真を1枚見て、見えている食材をリストアップしてください。
ルール:
- 調味料・ドレッシング・ソース類は含めない
- 食材名は日本語で簡潔に
- 商品パッケージが見える場合は中の食材名に変換する
- 確認できない・不明なものは含めない
JSON配列のみ出力: ["食材1", "食材2", ...]

[画像: 1枚]  ※ 3枚並列呼び出し → 結果をマージ・重複除去
```

---

**Phase A-2 プロンプト（テキストのみ・1案目）:**

```
【冷蔵庫にある食材】（画像認識済み）:
{ingredients_merged}  ← A-1のマージ結果

ユーザー設定:
- 大人: {adults}人 / 子ども: {kids_ages}
- アレルギー: {allergies}
- NG食材: {ng_foods}
- 調理器具: {appliances}
- 味の好み: {taste}
- 料理方針: {policy_memo}
- 言語: {locale}

今日の状況:
- 食事: {meal_time}
- 余力: {tired_mode ? "疲れている。15分以内で作れるものを優先" : "通常"}

【優先使用食材】（ユーザーがタップ指定した場合）:
{priority_ingredients}  ← 必ずこの食材を使うこと

【マンネリ回避指示・最重要】
以下は過去14日に提案した献立です。同じ料理名・主食材・調理法・ジャンルは避けてください:
{recent_meals_json}

上記の食材で作れる、最も家族に喜ばれる献立を**1案だけ**提案してください。

出力スキーマ（JSON）:
{
  "ingredients": ["食材1", "食材2", ...],  ← A-1のマージ結果をそのまま使用
  "meal": {
    "id": "uuid",
    "type": "{priority_type}",
    "name": "料理名",
    "reason": "なぜこの料理か（1文）",
    "time_minutes": 20,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["玉ねぎ", "豚肉"],
    "missing_ingredients": ["ケチャップ"],
    "genre": "和食|洋食|中華|エスニック",
    "main_ingredient": "肉|魚|卵|野菜|麺|米",
    "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"
  }
}
```

---

**Phase B プロンプト（テキストのみ・残り2案）:**

```
System Prompt:
あなたは家庭料理の専門家です。共働き家庭向けに献立を提案してください。

ユーザー設定:（Phase Aと同一）

今日の状況:（Phase Aと同一）

【除外済み献立】
Phase A で既に提案した料理: {phase_a_meal_name}
過去14日の履歴: {recent_meals_json}

冷蔵庫にある食材（Phase Aの認識結果）:
{ingredients_list}

上記の食材を使って、**残り2案**を提案してください。
- type: {type_2} と {type_3}（Phase Aで使ったタイプと重複しないもの）
- Phase Aとは異なる料理ジャンル・主食材・調理法を選ぶこと

出力スキーマ（JSON）: meals配列で2つ（Phase Aと同構造）
```

---

**マンネリ回避のロジック:**
1. `/api/analyze` 受信時、直前14日の `meal_history` を user_id で取得
2. プロンプトに `recent_meals_json` として注入
3. Phase A完了後、1案目を `meal_history` に保存
4. Phase B完了後、2・3案目を `meal_history` に保存
5. ユーザーが「この献立で作る」をタップしたら `was_selected = true`
6. 「作った！」フィードバック時に `was_cooked = true`

**透明性UI:** 献立カードに小さく「過去2週間と違う提案です」バッジを表示し、システムが配慮していることを伝える（信頼形成）。

**モデル戦略（実機検証済み・確定）:**

> **検証結果（2026-05-18）:** モデル比較プレイグラウンドで冷蔵庫写真（複数枚）を使い4モデルを実機比較。
> Gemini 2.5 Flash-Lite が**速度・コストともに最良**と判定（精度も実用水準を確認）。

| モデル | 応答時間（実測） | 精度評価 | 採用判断 |
|---|---|---|---|
| GPT-4o | 11.9秒 | 良好（一部誤認識あり） | **フォールバック**（Flash-Lite障害時のみ） |
| Gemini 2.5 Flash（Thinking ON） | 16.8秒 | 最良 | ❌ 廃止（Flash-Liteで十分） |
| Gemini 2.5 Flash（Thinking OFF） | 〜10秒 | 良好 | ❌ 廃止（Flash-Liteで十分） |
| **Gemini 2.5 Flash-Lite** | **〜5秒** | **実用水準** | ✅ **Primary採用** |
| Gemini 2.5 Pro | 22.4秒 | — | ❌ 廃止（遅すぎ・コスト優位なし） |

**確定構成:**
- **Primary: Gemini 2.5 Flash-Lite** — 最速・最安。レシピ生成（テキストのみ）にも適用。SSEストリーミングで体感速度を確保。
- **Fallback: GPT-4o** — Flash-Lite がエラー・タイムアウトの場合に自動切替。

---

## 8. API価格・コスト構造（2026-05-21更新）

**3フェーズコスト構造（推奨3枚想定）:**

| フェーズ | 内容 | Vision | テキスト |
|---|---|---|---|
| Phase A-1 | 画像認識×3並列（各1枚・食材JSON配列のみ出力） | あり（1枚×3回） | 最小（出力~50token/回） |
| Phase A-2 | 献立生成（テキストのみ・食材リスト入力） | なし | あり |
| Phase B | 代替案2件生成（テキストのみ） | なし | あり |
| Phase C | レシピ詳細生成（テキストのみ・オンデマンド） | なし | あり |

| モデル | 公式価格（抜粋） | A-1（認識×3） | A-2（献立生成） | B（代替2案） | 合計/セッション | 30回/月 | 採用 |
|---|---|---|---|---|---|---|---|
| **Gemini 2.5 Flash-Lite** | 入力$0.10 / 100万token、出力$0.40 / 100万token | $0.001 | $0.001 | $0.001 | **$0.003** | $0.09 | ✅ **Primary** |
| **GPT-4o** | 公式価格はリリース/モデル更新に追随して確認 | $0.015 | $0.010 | $0.008 | **$0.033** | $0.99 | ✅ **Fallback** |
| ~~Gemini 2.5 Flash~~ | — | — | — | — | ~~$0.010~~ | — | ❌ 廃止 |
| ~~Gemini 2.5 Pro~~ | — | — | — | — | ~~$0.030~~ | — | ❌ 廃止 |

**Phase C（レシピ詳細・テキストのみ）の追加コスト:**

| 用途 | 入力 | 出力 | 1回あたり |
|---|---|---|---|
| レシピ生成（Flash-Lite） | 約400トークン | 約600トークン | **≒$0.0003（約0.04円）** |

⚠️ **コストの正確な現行価格は公式で確認すること:**
- OpenAI: `platform.openai.com/docs/pricing`
- Google Gemini: `ai.google.dev/gemini-api/docs/pricing`

---

## 9. ホットクック対応方針

ホットクックは公式メニュー番号の完全DBではなく、**カテゴリ + 調理原理エンジン**で扱う。目的は「実機で再現しやすい料理だけを提案し、メニューの探し方と手動フォールバックを提示する」こと。

**対応カテゴリ:**
- 煮物（肉/魚/野菜/乾物）
- カレー・シチュー
- スープ
- 蒸し物
- 無水ゆで
- 発酵・低温調理
- ごはん/リゾット
- 炒め煮（しっとり系）

**非対応として避ける料理:**
- 揚げ物、焦げ目が必要な焼き物、シャキッと炒め、焼き卵料理、パン/グリル、生もの
- ユーザーが非対応料理をリクエストした場合は、近い対応料理に置換する

**レシピ詳細で表示する内容:**
- 推奨カテゴリ名と説明
- 実機での操作経路
- 自動メニュー例
- 手動フォールバック（モード/沸とう後時間）
- 水分、まぜ技、時間、容量、下処理、安全注意

---

## 10. 実装フェーズ

### Phase 0: 基盤（2日）
- [x] **Next.js プロジェクト初期化（TS・Tailwind・App Router）** ← 完了
- [x] **モデル比較プレイグラウンド構築・実機検証** ← 完了（Flash Primary確定）
- [x] Supabase Auth/DB helper 実装
- [x] PWA設定（manifest・アイコン・Service Worker）
- [x] Vercel Production/Preview デプロイ連携
- [ ] Supabase RLS/SQLスキーマの最終監査
- [ ] PostHog セットアップ
- [ ] Vercel Pro契約・本番環境変数の最終確認

### Phase 1: 認証・オンボーディング（1日）
- [x] Supabase Auth（メール+パスワード）
- [x] Google OAuth
- [x] パスワードリセット
- [x] オンボーディング画面（人数・調理器具・NG食材）
- [x] 設定画面
- [ ] Resend連携（再エンゲージ用・将来）

### Phase 2: 写真アップロード・解析（2日）
- [x] 画像アップロードUI・圧縮
- [x] **Phase A: `/api/analyze` SSE実装**（Gemini 2.5 Flash-Lite Primary + GPT-4o Fallback）
- [x] **Phase B: `/api/alternatives` SSE実装**（テキストのみ2案生成）
- [x] プロンプト実装（家庭設定・余力・献立構成・リクエスト）
- [x] ローディング画面（ストリーミング表示）
- [x] Phase A完了後にPhase Bを自動呼び出しするクライアントロジック
- [ ] Supabase Storage連携（画像保存/optin導入時）

### Phase 3: 献立提案・詳細・マンネリ回避（1.5日）
- [x] 献立カード（タイプ別表示）
- [x] 3案の表示順ロジック（Phase A: 1案即表示 / Phase B: 残り2案即表示）
- [x] 「別の献立」即時切替（Phase B完了済みなら待ち時間ゼロ）
- [x] レシピ詳細生成
- [x] ホットクックカテゴリ/原理エンジン
- [x] **`meal_history` への記録ロジック**（提案時・選択時）
- [x] **過去14日の履歴をプロンプトに注入**
- [ ] 「作った！」フィードバックUI/DB更新
- [ ] **「過去2週間と違う提案です」バッジ表示**

### Phase 4: 課金・計測（1日）
- [x] Stripe Checkout 連携
- [x] Stripe Billing Portal
- [x] Stripe webhook（checkout/session/subscription）
- [x] usage_counters 実装
- [x] ゲスト上限/Free上限/Proアップグレード導線
- [ ] PostHog イベント全配線

### Phase 5: 品質保証・リリース（1日）
- [ ] iOS Safari・Android Chrome 実機テスト
- [ ] 利用規約・プライバシーポリシー設置
- [ ] OGP・SEO設定
- [ ] 初回ベータユーザー10名でドッグフーディング

**合計: 約8営業日**

---

## 11. 実装開始前の残タスク

- [x] `snap-meal.com` ドメイン取得（snapmeal.appは不要・snap-meal.comで進行）
- [x] Supabase プロジェクト作成
- [ ] PostHog プロジェクト作成
- [x] Gemini API キー取得
- [x] Stripe アカウント/Checkout疎通
- [ ] Gemini API規約確認（特に画像のデータ利用）
- [ ] Resend アカウント作成（再エンゲージ用）
- [ ] Vercel Pro 契約
- [ ] 利用規約・プライバシーポリシー作成
- [x] アプリアイコン作成（512×512px）
- [ ] OGP画像作成
