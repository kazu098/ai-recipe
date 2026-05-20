-- profiles の作成はアプリ側（auth callback + onAuthStateChange）に移行したため
-- DB トリガーを削除する

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();
