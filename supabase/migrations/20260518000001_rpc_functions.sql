-- usage_counters の upsert + increment を atomic に行うRPC
CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_user_id UUID,
  p_year_month TEXT
)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO usage_counters (user_id, year_month, count)
  VALUES (p_user_id, p_year_month, 1)
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET count = usage_counters.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;
