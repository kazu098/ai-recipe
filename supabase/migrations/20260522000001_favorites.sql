-- favorites: ユーザーがお気に入りに登録した献立
CREATE TABLE IF NOT EXISTS favorites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  meal_name    text NOT NULL,
  genre        text,
  reason       text,
  time_minutes integer,
  difficulty   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, meal_name)
);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites: own rows only"
  ON favorites FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX favorites_user_created ON favorites (user_id, created_at DESC);
