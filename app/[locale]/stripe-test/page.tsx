import StripeTestClient from "./client";

export default async function StripeTestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <StripeTestClient locale={locale} />;
}
