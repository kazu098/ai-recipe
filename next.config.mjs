import withPWA from "@ducanh2912/next-pwa";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const pwaConfig = withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    // /api/admin/ は常にネットワークから取得（キャッシュ不使用）
    runtimeCaching: [
      {
        urlPattern: /\/api\/admin\//,
        handler: "NetworkOnly",
      },
    ],
  },
});

export default pwaConfig(withNextIntl({}));
