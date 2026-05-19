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

  const { locale = "ja" } = await req.json().catch(() => ({}));
  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://ai-recipe-murex.vercel.app";

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id as string,
    return_url: `${origin}/${locale}`,
  });

  return NextResponse.json({ url: portalSession.url });
}
