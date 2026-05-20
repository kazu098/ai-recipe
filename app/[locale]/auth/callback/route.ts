import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  const code = req.nextUrl.searchParams.get("code");
  const type = req.nextUrl.searchParams.get("type");
  const origin = req.nextUrl.origin;

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (c) => {
            try {
              c.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    // profiles 行がなければ作成（RLS 回避のため admin クライアントを使用）
    if (data.user) {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      await admin
        .from("profiles")
        .upsert(
          { id: data.user.id, email: data.user.email ?? "" },
          { onConflict: "id", ignoreDuplicates: true }
        );
    }
  }

  // パスワードリセットの場合は設定画面へ
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/${locale}/auth/reset-password`);
  }

  return NextResponse.redirect(`${origin}/${locale}`);
}
