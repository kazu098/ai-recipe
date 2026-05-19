"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type PlanInfo = { plan: string; stripe_customer_id: string | null } | null;

export default function StripeTestClient({ locale }: { locale: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [planInfo, setPlanInfo] = useState<PlanInfo>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        supabase
          .from("profiles")
          .select("plan, stripe_customer_id")
          .eq("id", user.id)
          .single()
          .then(({ data }) => setPlanInfo(data));
      }
    });
  }, []);

  const handleCheckout = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, region: locale === "ja" ? "jp" : "usd" }),
      });
      const data = await res.json();
      if (data.error === "already_pro") {
        setMessage("すでに Pro プランです");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setMessage("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const data = await res.json();
      if (data.error === "no_subscription") {
        setMessage("Stripe の顧客情報がありません。先にアップグレードしてください。");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setMessage("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const refreshPlan = async () => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("plan, stripe_customer_id")
      .eq("id", user.id)
      .single();
    setPlanInfo(data);
    setMessage("プラン情報を更新しました");
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Stripe テスト画面</h1>
        <p className="text-sm text-red-500 font-medium">⚠️ 開発・テスト専用</p>
      </div>

      {/* ユーザー情報 */}
      <div className="bg-white rounded-2xl p-5 mb-4 border border-gray-200 space-y-2">
        <h2 className="font-semibold text-gray-700 text-sm">ユーザー情報</h2>
        {user ? (
          <>
            <p className="text-sm text-gray-600">メール: <span className="font-mono">{user.email}</span></p>
            <p className="text-sm text-gray-600">
              プラン:{" "}
              <span className={`font-bold ${planInfo?.plan === "pro" ? "text-green-600" : "text-gray-800"}`}>
                {planInfo?.plan ?? "取得中..."}
              </span>
            </p>
            <p className="text-sm text-gray-600">
              Stripe Customer ID:{" "}
              <span className="font-mono text-xs">{planInfo?.stripe_customer_id ?? "なし"}</span>
            </p>
            <button onClick={refreshPlan} className="text-xs text-blue-500 hover:underline">
              プラン情報を再取得
            </button>
          </>
        ) : (
          <p className="text-sm text-red-500">ログインしていません。テストにはログインが必要です。</p>
        )}
      </div>

      {/* 操作ボタン */}
      <div className="bg-white rounded-2xl p-5 mb-4 border border-gray-200 space-y-3">
        <h2 className="font-semibold text-gray-700 text-sm">操作</h2>
        <button
          onClick={handleCheckout}
          disabled={loading || !user}
          className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-sm hover:opacity-90 transition disabled:opacity-40"
        >
          {loading ? "処理中..." : "① Stripe Checkout を開く（アップグレード）"}
        </button>
        <button
          onClick={handlePortal}
          disabled={loading || !user}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-sm hover:opacity-90 transition disabled:opacity-40"
        >
          {loading ? "処理中..." : "② Stripe カスタマーポータルを開く（解約・カード変更）"}
        </button>
      </div>

      {/* テストカード情報 */}
      <div className="bg-yellow-50 rounded-2xl p-5 mb-4 border border-yellow-200">
        <h2 className="font-semibold text-yellow-800 text-sm mb-3">テストカード番号</h2>
        <div className="space-y-2 text-sm font-mono">
          <div className="flex justify-between">
            <span className="text-gray-600">決済成功:</span>
            <span className="font-bold">4242 4242 4242 4242</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">認証必要:</span>
            <span className="font-bold">4000 0025 0000 3155</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">決済失敗:</span>
            <span className="font-bold">4000 0000 0000 0002</span>
          </div>
        </div>
        <p className="text-xs text-yellow-700 mt-3">有効期限: 未来の日付（例: 12/34）/ CVC: 任意の3桁</p>
      </div>

      {/* Webhook 確認手順 */}
      <div className="bg-gray-100 rounded-2xl p-5 mb-4 border border-gray-200">
        <h2 className="font-semibold text-gray-700 text-sm mb-2">Webhook ローカル転送（Stripe CLI）</h2>
        <pre className="text-xs bg-gray-800 text-green-400 rounded-xl p-3 overflow-x-auto">
{`stripe listen \\
  --forward-to localhost:3000/api/stripe/webhook`}
        </pre>
        <p className="text-xs text-gray-500 mt-2">表示された whsec_xxx を .env.local の STRIPE_WEBHOOK_SECRET_LOCAL に設定</p>
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
          {message}
        </div>
      )}
    </main>
  );
}
