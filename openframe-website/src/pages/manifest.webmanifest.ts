// The web app manifest, with base-aware paths to the app icon.
import type { APIRoute } from "astro";
import { SITE, href } from "../lib/site";

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: SITE.name,
        short_name: SITE.name,
        description: SITE.description,
        start_url: href(),
        scope: href(),
        display: "browser",
        background_color: "#05060a",
        theme_color: "#05060a",
        icons: [
          { src: href("icons/icon-192.png"), sizes: "192x192", type: "image/png" },
          { src: href("icons/icon-512.png"), sizes: "512x512", type: "image/png" },
          { src: href("favicon.svg"), sizes: "any", type: "image/svg+xml" },
        ],
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
