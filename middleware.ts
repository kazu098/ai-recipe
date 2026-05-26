import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // /admin は i18n ルーティング対象外
  const isAdmin = request.nextUrl.pathname.startsWith("/admin");

  // next-intl: locale detection + redirect (e.g. / → /ja)
  const intlResponse = isAdmin ? null : handleI18nRouting(request);

  // Use intl response as base (may be a redirect or next())
  let response = intlResponse ?? NextResponse.next({ request });

  // Supabase: refresh session cookie on every request
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Exclude: API routes, Next.js internals, static files, PWA files
    // swe-worker-*.js must be excluded — @ducanh2912/next-pwa generates this filename,
    // and without exclusion the i18n middleware redirects it to /ja/swe-worker-*.js (404),
    // preventing SW updates and causing stale-cache crashes on new deployments.
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|swe-worker-.*|workbox-.*|manifest\\.json|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
