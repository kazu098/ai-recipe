"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const t = useTranslations("login");
  const locale = useLocale();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("reset_weak"));
      return;
    }
    if (password !== confirm) {
      setError(t("reset_mismatch"));
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(t("error_generic"));
    } else {
      setDone(true);
      setTimeout(() => router.replace(`/${locale}`), 2000);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center max-w-lg mx-auto px-6">
      <div className="w-full bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
        <div className="text-center mb-8">
          <p className="text-5xl mb-4">🔑</p>
          <h1 className="text-xl font-bold text-gray-900">{t("reset_title")}</h1>
        </div>

        {done ? (
          <p className="text-center text-green-600 text-sm font-medium bg-green-50 py-3 px-4 rounded-2xl">
            {t("reset_success")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("reset_new_password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8文字以上"
                required
                autoFocus
                className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 placeholder-gray-300 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("reset_confirm_password")}
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="もう一度入力"
                required
                className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 placeholder-gray-300 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition text-base"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 py-2 px-4 rounded-xl text-center">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password || !confirm}
              className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition disabled:opacity-40"
            >
              {loading ? t("loading") : t("reset_cta")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
