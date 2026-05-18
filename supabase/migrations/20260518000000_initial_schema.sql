-- ============================================================
-- Snapmeal initial schema
-- ============================================================

-- profiles: Supabase Auth に紐づくユーザー情報
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  household_settings JSONB,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  locale TEXT DEFAULT 'ja',
  photo_optin BOOLEAN DEFAULT false
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: own row only"
  ON profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ログイン時に自動でprofileを作成するトリガー
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- sessions: 1回の解析セッション
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  tired_mode BOOLEAN DEFAULT false,
  detected_ingredients JSONB,
  meals JSONB,
  selected_meal_id TEXT,
  cooked BOOLEAN DEFAULT false,
  storage_paths TEXT[]
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: own rows only"
  ON sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX sessions_user_created ON sessions (user_id, created_at DESC);

-- meal_history: マンネリ回避用の提案履歴
CREATE TABLE IF NOT EXISTS meal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  meal_name TEXT NOT NULL,
  genre TEXT,
  main_ingredient TEXT,
  cooking_method TEXT,
  was_selected BOOLEAN DEFAULT false,
  was_cooked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE meal_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_history: own rows only"
  ON meal_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX meal_history_user_created ON meal_history (user_id, created_at DESC);

-- usage_counters: 月次利用回数
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  count INT DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_counters: own rows only"
  ON usage_counters FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
