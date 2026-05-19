import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {} },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { locale = "ja", region = "jp" } = await req.json().catch(() => ({}));
  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://ai-recipe-murex.vercel.app";

  const isLocal = process.env.NODE_ENV === "development";
  const PRICE_IDS: Record<string, string | undefined> = {
    jp: isLocal
      ? (process.env.STRIPE_PRO_PRICE_ID_JP_LOCAL ?? process.env.STRIPE_PRO_PRICE_ID_JP)
      : process.env.STRIPE_PRO_PRICE_ID_JP,
    usd: process.env.STRIPE_PRO_PRICE_ID_USD,
    eur: process.env.STRIPE_PRO_PRICE_ID_EUR,
  };
  const priceId = PRICE_IDS[region] ?? PRICE_IDS.jp ?? "";

  // 既存の stripe_customer_id を取得
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, plan")
    .eq("id", user.id)
    .single();

  if (profile?.plan === "pro" || profile?.plan === "pro_annual") {
    return NextResponse.json({ error: "already_pro" }, { status: 400 });
  }

  // Stripe カスタマーの取得 or 作成
  let customerId = profile?.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/${locale}?upgrade=success`,
    cancel_url: `${origin}/${locale}?upgrade=cancelled`,
    client_reference_id: user.id,
    locale: locale === "ja" ? "ja" : "en",
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  });

  return NextResponse.json({ url: session.url });
}
