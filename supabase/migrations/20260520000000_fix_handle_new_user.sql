-- handle_new_user トリガーがエラーで signup を失敗させないよう修正
-- profile 作成失敗時も auth.users への登録は成功させる（アプリ側で upsert する）

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    INSERT INTO profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- profile 作成に失敗しても auth ユーザー作成は止めない
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
