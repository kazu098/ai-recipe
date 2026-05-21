-- ============================================================
-- analytics_events: クライアント側イベントログ
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  anonymous_id TEXT,
  event_name   TEXT NOT NULL,
  properties   JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- 全ユーザー（未認証含む）からの INSERT を許可
CREATE POLICY "analytics_events: allow insert for all"
  ON analytics_events FOR INSERT
  WITH CHECK (true);

-- SELECT は service_role のみ（RLS で明示的な SELECT ポリシーを設けない）

CREATE INDEX analytics_events_name_created ON analytics_events (event_name, created_at DESC);
CREATE INDEX analytics_events_created      ON analytics_events (created_at DESC);
CREATE INDEX analytics_events_user         ON analytics_events (user_id, created_at DESC);

-- ============================================================
-- Admin 用集計ビュー（service_role で参照）
-- ============================================================

-- 直近 N 日のイベント件数サマリー
CREATE OR REPLACE VIEW analytics_event_summary AS
SELECT
  event_name,
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*)                      AS cnt
FROM analytics_events
GROUP BY 1, 2;

-- 直近 30 日のジャンル別選択数
CREATE OR REPLACE VIEW analytics_genre_summary AS
SELECT
  properties->>'genre' AS genre,
  COUNT(*)             AS cnt
FROM analytics_events
WHERE event_name = 'meal_selected'
GROUP BY 1;

-- 直近 30 日のミールパターン利用数
CREATE OR REPLACE VIEW analytics_pattern_summary AS
SELECT
  properties->>'pattern' AS pattern,
  COUNT(*)               AS cnt
FROM analytics_events
WHERE event_name = 'analysis_started'
GROUP BY 1;
