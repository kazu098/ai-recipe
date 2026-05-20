import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;

  const type = req.nextUrl.searchParams.get("type");

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
    await supabase.auth.exchangeCodeForSession(code);
  }

  // パスワードリセットの場合は設定画面へ
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/${locale}/auth/reset-password`);
  }

  return NextResponse.redirect(`${origin}/${locale}`);
}
