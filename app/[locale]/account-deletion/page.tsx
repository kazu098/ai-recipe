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
    title: isJa ? "アカウント削除リクエスト | Snapmeal" : "Account Deletion Request | Snapmeal",
    description: isJa
      ? "Snapmeal のアカウントと関連データの削除依頼方法です。"
      : "How to request deletion of your Snapmeal account and associated data.",
  };
}

const CONTACT_EMAIL = "support@snap-meal.com";
const LAST_UPDATED_JA = "2026年5月27日";
const LAST_UPDATED_EN = "May 27, 2026";

function AccountDeletionJa() {
  const subject = encodeURIComponent("Snapmeal アカウント削除依頼");
  const body = encodeURIComponent(
    [
      "Snapmeal のアカウント削除を依頼します。",
      "",
      "登録メールアドレス:",
      "Googleログインを利用している場合のメールアドレス:",
      "",
      "本人確認のため、必要な追加情報があればご連絡ください。",
    ].join("\n"),
  );

  return (
    <article className="prose prose-sm max-w-none text-gray-700">
      <p className="text-sm text-gray-400">最終更新日: {LAST_UPDATED_JA}</p>

      <p>
        このページでは、Snapmeal のアカウントおよび関連データの削除を依頼する方法を説明します。
        Google Play に掲載されている Snapmeal アプリから作成したアカウントも対象です。
      </p>

      <h2>削除依頼の方法</h2>
      <p>
        アカウント削除を希望する場合は、以下のメールアドレスへご連絡ください。
        ご本人確認のため、Snapmeal に登録したメールアドレスから送信してください。
      </p>
      <p>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
          className="text-emerald-600 underline"
        >
          {CONTACT_EMAIL}
        </a>
      </p>

      <h2>メールに記載していただきたい内容</h2>
      <ul>
        <li>件名: Snapmeal アカウント削除依頼</li>
        <li>Snapmeal に登録したメールアドレス</li>
        <li>Google ログインを利用している場合は、そのGoogleアカウントのメールアドレス</li>
      </ul>

      <h2>削除されるデータ</h2>
      <ul>
        <li>アカウント情報（メールアドレス、ユーザーID）</li>
        <li>献立履歴、選択履歴、フィードバック</li>
        <li>お気に入りに保存した献立</li>
        <li>家族設定、アレルギー・NG食材、調理器具などの設定情報</li>
        <li>利用回数など、アカウントに紐づく利用データ</li>
      </ul>

      <h2>保存されないデータ</h2>
      <p>
        冷蔵庫や食材のアップロード画像は、食材認識・献立提案のために処理されますが、
        Snapmeal のサーバー上には保存されません。
      </p>

      <h2>保持される場合があるデータ</h2>
      <p>
        法令遵守、不正利用防止、決済・会計処理、セキュリティ対応のために必要な情報は、
        必要最小限の範囲で一定期間保持される場合があります。決済情報は Stripe などの
        決済サービス側で管理され、Snapmeal はカード番号を保存しません。
      </p>

      <h2>処理期間</h2>
      <p>
        削除依頼を受け付けた後、本人確認が完了してから通常30日以内に削除処理を行います。
        法令上またはセキュリティ上の理由で一部データの保持が必要な場合は、その旨をお知らせします。
      </p>

      <h2>一部データのみの削除について</h2>
      <p>
        現時点では、アカウントを残したまま一部データのみを削除する専用フォームは提供していません。
        個別のご相談がある場合は、上記メールアドレスまでお問い合わせください。
      </p>
    </article>
  );
}

function AccountDeletionEn() {
  const subject = encodeURIComponent("Snapmeal account deletion request");
  const body = encodeURIComponent(
    [
      "I would like to request deletion of my Snapmeal account.",
      "",
      "Registered email address:",
      "Email address used for Google sign-in, if applicable:",
      "",
      "Please contact me if you need additional information to verify my identity.",
    ].join("\n"),
  );

  return (
    <article className="prose prose-sm max-w-none text-gray-700">
      <p className="text-sm text-gray-400">Last updated: {LAST_UPDATED_EN}</p>

      <p>
        This page explains how to request deletion of your Snapmeal account and associated data,
        including accounts created from the Snapmeal app listed on Google Play.
      </p>

      <h2>How to request account deletion</h2>
      <p>
        To request account deletion, please contact us at the email address below.
        For identity verification, please send the request from the email address registered with Snapmeal.
      </p>
      <p>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
          className="text-emerald-600 underline"
        >
          {CONTACT_EMAIL}
        </a>
      </p>

      <h2>What to include in your request</h2>
      <ul>
        <li>Subject: Snapmeal account deletion request</li>
        <li>The email address registered with Snapmeal</li>
        <li>If you use Google sign-in, the email address of that Google account</li>
      </ul>

      <h2>Data that will be deleted</h2>
      <ul>
        <li>Account information, including email address and user ID</li>
        <li>Meal history, selected meals, and feedback</li>
        <li>Saved favorite meals</li>
        <li>Household settings, allergy or avoided-food settings, and appliance preferences</li>
        <li>Usage data associated with your account, such as usage counters</li>
      </ul>

      <h2>Data that is not stored</h2>
      <p>
        Uploaded refrigerator or ingredient images are processed for ingredient recognition and meal suggestions,
        but they are not stored on Snapmeal servers.
      </p>

      <h2>Data that may be retained</h2>
      <p>
        We may retain limited information where necessary for legal compliance, fraud prevention,
        payment and accounting records, or security purposes. Payment information is handled by payment
        providers such as Stripe, and Snapmeal does not store card numbers.
      </p>

      <h2>Processing period</h2>
      <p>
        After receiving your request and verifying your identity, we usually complete deletion within 30 days.
        If we need to retain certain data for legal or security reasons, we will let you know.
      </p>

      <h2>Partial data deletion</h2>
      <p>
        We currently do not provide a dedicated form for deleting only some data while keeping your account.
        If you have a specific request, please contact us at the email address above.
      </p>
    </article>
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
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="mb-8 text-2xl font-bold text-gray-900">
          {isJa ? "アカウント削除リクエスト" : "Account Deletion Request"}
        </h1>
        {isJa ? <AccountDeletionJa /> : <AccountDeletionEn />}
      </div>
    </main>
  );
}
