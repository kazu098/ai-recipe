import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// RLS をバイパスするためサービスロールクライアントを使用
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function setPlan(userId: string, plan: string, customerId?: string) {
  const supabase = adminClient();
  const update: Record<string, string> = { plan };
  if (customerId) update.stripe_customer_id = customerId;
  await supabase.from("profiles").update(update).eq("id", userId);
}

async function getUserIdFromCustomer(customerId: string): Promise<string | null> {
  const supabase = adminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();
  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const customerId = session.customer as string;
      if (userId) await setPlan(userId, "pro", customerId);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await getUserIdFromCustomer(sub.customer as string);
      if (userId) await setPlan(userId, "free");
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await getUserIdFromCustomer(sub.customer as string);
      if (!userId) break;
      const active = sub.status === "active" || sub.status === "trialing";
      await setPlan(userId, active ? "pro" : "free");
      break;
    }

    case "invoice.payment_failed": {
      // 支払い失敗: 猶予期間はあるので即ダウングレードしない（Stripe が自動リトライ）
      console.warn("[stripe/webhook] payment_failed for customer:", (event.data.object as Stripe.Invoice).customer);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
