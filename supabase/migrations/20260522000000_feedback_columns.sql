-- meal_history にフィードバック列を追加
ALTER TABLE meal_history
  ADD COLUMN IF NOT EXISTS family_reaction TEXT CHECK (family_reaction IN ('liked', 'disliked')),
  ADD COLUMN IF NOT EXISTS reaction_memo   TEXT,
  ADD COLUMN IF NOT EXISTS next_time_memo  TEXT;
