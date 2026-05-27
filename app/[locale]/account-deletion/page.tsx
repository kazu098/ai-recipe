import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isJa = locale === "ja";

  return {
    title: isJa ? "アカウント削除 | Snapmeal" : "Delete Account | Snapmeal",
    description: isJa
      ? "Snapmeal アカウントの削除依頼方法"
      : "How to request Snapmeal account deletion",
  };
}

const CONTACT_EMAIL = "support@snap-meal.com";

function AccountDeletionJa() {
  const subject = encodeURIComponent("Snapmeal アカウント削除依頼");
  const body = encodeURIComponent(
    [
      "Snapmeal のアカウント削除を依頼します。",
      "",
      "登録メールアドレス: ",
    ].join("\n"),
  );

  return (
    <div className="space-y-8">
      <p className="text-base text-gray-600 leading-relaxed">
        アカウントを削除するには、下記のメールアドレスへ削除依頼メールをお送りください。
      </p>

      <div className="rounded-2xl bg-gray-50 px-5 py-4 text-center">
        <p className="text-base font-semibold text-gray-800">{CONTACT_EMAIL}</p>
      </div>

      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
        className="flex items-center justify-center gap-2 w-full rounded-2xl bg-emerald-500 py-4 text-base font-bold text-white shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition"
      >
        上記のアドレスにメールを送る
      </a>

      <div className="rounded-2xl bg-gray-50 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">メールに書いてほしいこと</p>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-400" />
            <span>Snapmeal に登録したメールアドレス</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-400" />
            <span>Google ログインを使っている場合は、そのメールアドレス</span>
          </li>
        </ul>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        依頼を受け付け後、通常 30 日以内に削除処理を行います。
      </p>
    </div>
  );
}

function AccountDeletionEn() {
  const subject = encodeURIComponent("Snapmeal account deletion request");
  const body = encodeURIComponent(
    [
      "I would like to request deletion of my Snapmeal account.",
      "",
      "Registered email address: ",
    ].join("\n"),
  );

  return (
    <div className="space-y-8">
      <p className="text-base text-gray-600 leading-relaxed">
        To delete your account, send a deletion request to the email address below.
      </p>

      <div className="rounded-2xl bg-gray-50 px-5 py-4 text-center">
        <p className="text-base font-semibold text-gray-800">{CONTACT_EMAIL}</p>
      </div>

      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
        className="flex items-center justify-center gap-2 w-full rounded-2xl bg-emerald-500 py-4 text-base font-bold text-white shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition"
      >
        Send email to the address above
      </a>

      <div className="rounded-2xl bg-gray-50 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">What to include</p>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-400" />
            <span>The email address registered with Snapmeal</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-400" />
            <span>If you use Google sign-in, the email address of that Google account</span>
          </li>
        </ul>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        After receiving your request, we usually complete deletion within 30 days.
      </p>
    </div>
  );
}

export default async function AccountDeletionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();

  const isJa = locale === "ja";

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto max-w-sm px-5 py-12">
        <h1 className="mb-8 text-2xl font-bold text-gray-900">
          {isJa ? "アカウントを削除する" : "Delete your account"}
        </h1>
        {isJa ? <AccountDeletionJa /> : <AccountDeletionEn />}
      </div>
    </main>
  );
}
