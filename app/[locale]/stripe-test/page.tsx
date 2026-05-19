import dynamic from "next/dynamic";

const StripeTestClient = dynamic(() => import("./client"), { ssr: false });

export default async function StripeTestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <StripeTestClient locale={locale} />;
}
