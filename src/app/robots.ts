import type { MetadataRoute } from "next";

/**
 * `robots.txt` de la APLICACIÓN (administración, login, POS): no se rastrea nada. Es el que responde en cualquier host que no sea el de la carta; el host de la carta tiene el suyo
 * (`app/(carta-publica)/carta-publica/[empresa]/robots.txt/route.ts`, al que lo lleva el rewrite de `next.config.ts`). Va junto con el `X-Robots-Tag: noindex, nofollow` de toda la aplicación.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
