-- ============================================================
-- admin_daily_events: 日別集計をJST基準に変更
-- UTC基準だとJST 00:00〜08:59 のイベントが前日扱いになるため
-- ============================================================

CREATE OR REPLACE FUNCTION admin_daily_events(
  p_since TIMESTAMPTZ,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS TABLE(day DATE, event_name TEXT, cnt BIGINT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Tokyo')::DATE AS day,
    event_name,
    COUNT(*) AS cnt
  FROM analytics_events
  WHERE created_at >= p_since
    AND (p_exclude_user_id IS NULL OR user_id IS DISTINCT FROM p_exclude_user_id)
  GROUP BY 1, 2
  ORDER BY 1 ASC, 3 DESC;
$$;
