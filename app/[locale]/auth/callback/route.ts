import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  const code = req.nextUrl.searchParams.get("code");
  const type = req.nextUrl.searchParams.get("type");
  const origin = req.nextUrl.origin;

  const redirectTo =
    type === "recovery"
      ? `${origin}/${locale}/auth/reset-password`
      : `${origin}/${locale}`;

  // リダイレクトレスポンスを先に生成し、Cookieをこのレスポンスに直接設定する。
  // cookies() from next/headers + cookieStore.set() では NextResponse.redirect() に
  // Cookieが引き継がれないため、セッションがクライアントに届かない。
  const response = NextResponse.redirect(redirectTo);

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              // リクエストCookieにも反映（後続の同一リクエスト内処理のため）
              req.cookies.set(name, value);
              // レスポンスにSet-Cookieヘッダーとして付与
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[auth/callback] exchangeCodeForSession error:", error.message);
    }

    // profiles 行がなければ作成（RLS 回避のため admin クライアントを使用）
    if (data?.user) {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const { error: profileError } = await admin
        .from("profiles")
        .upsert(
          { id: data.user.id, email: data.user.email ?? "" },
          { onConflict: "id", ignoreDuplicates: true }
        );
      if (profileError) {
        console.error("[auth/callback] profiles upsert error:", profileError.message);
      }
    }
  }

  return response;
}
