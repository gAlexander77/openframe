// robots.txt. On a project site this file lives at /openframe/robots.txt;
// crawlers read only the host's root one, so the sitemap is also linked from
// every page's head (docs/Website.md explains).
import type { APIRoute } from "astro";
import { SITE, href } from "../lib/site";

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(href("sitemap-index.xml"), SITE.origin).href}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
