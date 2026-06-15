import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Public route renamed /foundation50 → /founders. Keep old links alive
      // with a permanent (308) redirect. The [locale] segment is part of the
      // actual URL path (next-intl always-prefix), so we capture it explicitly.
      {
        source: "/:locale/foundation50",
        destination: "/:locale/founders",
        permanent: true,
      },
      {
        source: "/:locale/foundation50/:path*",
        destination: "/:locale/founders/:path*",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
