-- ============================================================
-- Admin 用集計 RPC に p_exclude_user_id パラメータを追加
-- オーナー自身のデータをダッシュボードから除外するため
-- ============================================================

CREATE OR REPLACE FUNCTION admin_event_counts(
  p_since TIMESTAMPTZ,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS TABLE(event_name TEXT, cnt BIGINT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT event_name, COUNT(*) AS cnt
  FROM analytics_events
  WHERE created_at >= p_since
    AND (p_exclude_user_id IS NULL OR user_id IS DISTINCT FROM p_exclude_user_id)
  GROUP BY event_name
  ORDER BY cnt DESC;
$$;

CREATE OR REPLACE FUNCTION admin_daily_events(
  p_since TIMESTAMPTZ,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS TABLE(day DATE, event_name TEXT, cnt BIGINT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    DATE_TRUNC('day', created_at)::DATE AS day,
    event_name,
    COUNT(*) AS cnt
  FROM analytics_events
  WHERE created_at >= p_since
    AND (p_exclude_user_id IS NULL OR user_id IS DISTINCT FROM p_exclude_user_id)
  GROUP BY 1, 2
  ORDER BY 1 ASC, 3 DESC;
$$;
