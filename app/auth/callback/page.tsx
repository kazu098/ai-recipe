"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // implicit フローではクライアントがハッシュフラグメントを自動処理する
    // onAuthStateChange で SIGNED_IN を待つ
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace("/");
      } else if (event === "SIGNED_OUT") {
        router.replace("/?auth_error=signed_out");
      }
    });

    // すでにセッションがある場合はそのまま遷移
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <main className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center">
        <p className="text-4xl mb-4">⏳</p>
        <p className="text-gray-500 text-sm">ログイン中...</p>
      </div>
    </main>
  );
}
