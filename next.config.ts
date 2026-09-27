import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        /*
         * The service worker script is re-checked on every navigation rather
         * than cached by the browser or a CDN: a stale worker is how an old
         * caching policy outlives the deploy that replaced it.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
