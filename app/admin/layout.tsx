import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) redirect("/");

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== adminEmail) redirect("/");

  return <>{children}</>;
}
