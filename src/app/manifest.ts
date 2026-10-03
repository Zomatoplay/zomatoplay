import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_NAME } from "@/constants/app";

/**
 * The web app manifest — what makes Zomato Play installable.
 *
 * `standalone` launches without browser chrome where supported. `start_url`
 * is the home screen, which the app's own gate redirects to sign-in when there
 * is no session — so an installed app opened while signed out lands on the
 * login screen, not a broken page. Colours match the light theme tokens.
 *
 * `id` pins the app's identity to the path, so a future change to
 * `start_url` does not make browsers treat it as a different app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fcfcfd",
    theme_color: "#fcfcfd",
    categories: ["finance"],
    icons: [
      { src: "/pwa-icon/v2-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/v2-512", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/pwa-icon/v2-maskable-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
