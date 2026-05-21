-- ============================================================
-- Admin 用集計 RPC（service_role で呼び出す）
-- ============================================================

-- イベント別合計
CREATE OR REPLACE FUNCTION admin_event_counts(p_since TIMESTAMPTZ)
RETURNS TABLE(event_name TEXT, cnt BIGINT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT event_name, COUNT(*) AS cnt
  FROM analytics_events
  WHERE created_at >= p_since
  GROUP BY event_name
  ORDER BY cnt DESC;
$$;

-- 日別イベント数
CREATE OR REPLACE FUNCTION admin_daily_events(p_since TIMESTAMPTZ)
RETURNS TABLE(day DATE, event_name TEXT, cnt BIGINT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    DATE_TRUNC('day', created_at)::DATE AS day,
    event_name,
    COUNT(*) AS cnt
  FROM analytics_events
  WHERE created_at >= p_since
  GROUP BY 1, 2
  ORDER BY 1 ASC, 3 DESC;
$$;
