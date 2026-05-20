import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Snapmeal",
  description: "Snapmeal のプライバシーポリシーです。",
};

const LAST_UPDATED = "2026年5月20日";
const LAST_UPDATED_EN = "May 20, 2026";
const CONTACT_NAME = "吉永和貴";
const CONTACT_EMAIL = "kazutaka.yoshinaga@gmail.com";

function PolicyJa() {
  return (
    <article className="prose prose-sm max-w-none text-gray-700">
      <p className="text-sm text-gray-400">最終更新日: {LAST_UPDATED}</p>

      <p>
        Snapmeal（以下「本サービス」）は、吉永和貴（以下「運営者」）が提供する
        食材管理・献立提案サービスです。本プライバシーポリシーは、本サービスが収集する
        情報とその利用方法について説明します。
      </p>

      <h2>1. 収集する情報</h2>
      <ul>
        <li>
          <strong>アカウント情報</strong>：メールアドレス（会員登録・ログイン時）
        </li>
        <li>
          <strong>アップロード画像</strong>：冷蔵庫の食材を撮影した写真（献立提案のためにのみ使用し、サーバー上に保存しません）
        </li>
        <li>
          <strong>利用データ</strong>：献立の選択履歴、アレルギー設定、調理器具設定
        </li>
        <li>
          <strong>決済情報</strong>：クレジットカード情報は Stripe が管理し、運営者は取得・保存しません
        </li>
      </ul>

      <h2>2. 情報の利用目的</h2>
      <ul>
        <li>献立提案・レシピ生成サービスの提供</li>
        <li>アカウントの認証・管理</li>
        <li>有料プランの決済処理</li>
        <li>サービスの改善・不具合対応</li>
      </ul>

      <h2>3. 第三者への提供</h2>
      <p>
        運営者は、以下の場合を除き、収集した情報を第三者に販売・提供しません。
      </p>
      <ul>
        <li>法令に基づく開示が必要な場合</li>
        <li>ユーザーの同意がある場合</li>
      </ul>

      <h2>4. 利用する外部サービス</h2>
      <ul>
        <li>
          <strong>Google Gemini API</strong>（Google LLC）：食材解析・献立生成に使用。アップロード画像は API 処理のみに使用されます。
        </li>
        <li>
          <strong>Supabase</strong>：ユーザー認証・データ保存に使用。
        </li>
        <li>
          <strong>Stripe</strong>：決済処理に使用。カード情報は Stripe のサーバーで管理されます。
        </li>
        <li>
          <strong>Vercel</strong>：アプリのホスティングに使用。
        </li>
      </ul>

      <h2>5. データの保管・削除</h2>
      <p>
        アカウントを削除した場合、関連するすべての個人データは速やかに削除されます。
        アップロードされた画像はサーバーに保存されません。
      </p>

      <h2>6. セキュリティ</h2>
      <p>
        本サービスは HTTPS 通信を使用し、パスワードはハッシュ化して保管します。
        ただし、インターネット上での完全な安全性を保証するものではありません。
      </p>

      <h2>7. お子様のプライバシー</h2>
      <p>
        本サービスは 13 歳未満のお子様を対象としていません。
        13 歳未満の方の情報を意図的に収集することはありません。
      </p>

      <h2>8. ポリシーの変更</h2>
      <p>
        本ポリシーを変更する場合は、本ページにて更新日とともに通知します。
        重要な変更がある場合は、メールでもお知らせします。
      </p>

      <h2>9. お問い合わせ</h2>
      <p>
        プライバシーに関するご質問・ご要望は下記までご連絡ください。
      </p>
      <p>
        運営者：{CONTACT_NAME}
        <br />
        メール：
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-emerald-600 underline">
          {CONTACT_EMAIL}
        </a>
      </p>
    </article>
  );
}

function PolicyEn() {
  return (
    <article className="prose prose-sm max-w-none text-gray-700">
      <p className="text-sm text-gray-400">Last updated: {LAST_UPDATED_EN}</p>

      <p>
        Snapmeal (the &ldquo;Service&rdquo;) is a meal-planning service operated by
        Kazuki Yoshinaga (the &ldquo;Operator&rdquo;). This Privacy Policy explains
        what information we collect and how we use it.
      </p>

      <h2>1. Information We Collect</h2>
      <ul>
        <li>
          <strong>Account information</strong>: Email address (used for sign-up and login)
        </li>
        <li>
          <strong>Uploaded images</strong>: Photos of refrigerator contents (used only for meal suggestion; not stored on our servers)
        </li>
        <li>
          <strong>Usage data</strong>: Meal selection history, allergy settings, cooking appliance preferences
        </li>
        <li>
          <strong>Payment information</strong>: Credit card details are managed by Stripe; the Operator does not access or store them
        </li>
      </ul>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To provide meal suggestions and recipe generation</li>
        <li>To authenticate and manage your account</li>
        <li>To process payments for premium plans</li>
        <li>To improve the Service and resolve issues</li>
      </ul>

      <h2>3. Sharing with Third Parties</h2>
      <p>
        We do not sell or share your information with third parties except in the following cases:
      </p>
      <ul>
        <li>When required by law</li>
        <li>With your explicit consent</li>
      </ul>

      <h2>4. Third-Party Services</h2>
      <ul>
        <li>
          <strong>Google Gemini API</strong> (Google LLC): Used for ingredient analysis and meal generation. Uploaded images are used solely for API processing.
        </li>
        <li>
          <strong>Supabase</strong>: Used for user authentication and data storage.
        </li>
        <li>
          <strong>Stripe</strong>: Used for payment processing. Card information is managed on Stripe&apos;s servers.
        </li>
        <li>
          <strong>Vercel</strong>: Used for application hosting.
        </li>
      </ul>

      <h2>5. Data Retention and Deletion</h2>
      <p>
        When you delete your account, all associated personal data is promptly removed.
        Uploaded images are not stored on our servers.
      </p>

      <h2>6. Security</h2>
      <p>
        The Service uses HTTPS and stores passwords in hashed form. However, no method
        of transmission over the internet is 100% secure.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>
        The Service is not directed at children under 13. We do not knowingly collect
        personal information from children under 13.
      </p>

      <h2>8. Changes to This Policy</h2>
      <p>
        We will notify you of any changes by updating this page with a new date.
        For significant changes, we will also send an email notification.
      </p>

      <h2>9. Contact Us</h2>
      <p>
        For questions or requests regarding your privacy, please contact:
      </p>
      <p>
        Operator: {CONTACT_NAME}
        <br />
        Email:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-emerald-600 underline">
          {CONTACT_EMAIL}
        </a>
      </p>
    </article>
  );
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();

  const isJa = locale === "ja";

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="mb-8 text-2xl font-bold text-gray-900">
          {isJa ? "プライバシーポリシー" : "Privacy Policy"}
        </h1>
        {isJa ? <PolicyJa /> : <PolicyEn />}
      </div>
    </main>
  );
}
