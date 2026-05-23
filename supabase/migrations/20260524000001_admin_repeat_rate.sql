-- ============================================================
-- admin_repeat_rate: 7日以内リピート率 RPC
-- 対象期間内に analysis_started を発火したログイン済みユーザーのうち
-- 最初のイベントから7日以内に再度 analysis_started を発火した割合
-- ============================================================

CREATE OR REPLACE FUNCTION admin_repeat_rate(
  p_since TIMESTAMPTZ,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS TABLE(
  total_users BIGINT,
  repeat_users BIGINT,
  repeat_rate NUMERIC
)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH user_first_use AS (
    SELECT
      user_id,
      MIN(created_at) AS first_used
    FROM analytics_events
    WHERE event_name = 'analysis_started'
      AND created_at >= p_since
      AND user_id IS NOT NULL
      AND (p_exclude_user_id IS NULL OR user_id IS DISTINCT FROM p_exclude_user_id)
    GROUP BY user_id
  ),
  repeat_check AS (
    SELECT
      u.user_id,
      EXISTS (
        SELECT 1 FROM analytics_events e
        WHERE e.user_id = u.user_id
          AND e.event_name = 'analysis_started'
          AND e.created_at > u.first_used
          AND e.created_at <= u.first_used + INTERVAL '7 days'
      ) AS is_repeat
    FROM user_first_use u
  )
  SELECT
    COUNT(*)::BIGINT AS total_users,
    COUNT(*) FILTER (WHERE is_repeat)::BIGINT AS repeat_users,
    CASE WHEN COUNT(*) = 0 THEN 0::NUMERIC
         ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE is_repeat) / COUNT(*), 1)
    END AS repeat_rate
  FROM repeat_check;
$$;
