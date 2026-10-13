/**
 * `robots.txt` y `sitemap.xml` del host público de la carta. PUROS: arman texto a partir de un origen (que sale de la configuración, ver `origenPublicoDeCarta`) y de los slugs públicos que
 * ya devolvió el lector del portal; no leen la base ni el pedido.
 */

/** `robots.txt` del host de la carta: todo permitido y el sitemap. Sin origen público (instalación sin dominio de cartas) no hay nada que anunciar: se pide no rastrear. */
export function textoRobotsDeCarta(origen: string | null): string {
  if (!origen) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\n\nSitemap: ${origen}/sitemap.xml\n`;
}

const ESCAPES_XML: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escaparXml = (texto: string) => texto.replace(/[&<>"']/g, (c) => ESCAPES_XML[c]);

/** `sitemap.xml`: el portal (`/`) y la carta de cada sucursal pública (`/<slug>`), con URL absolutas del host público. */
export function xmlSitemapDeCarta(origen: string, slugsDeSucursales: readonly string[]): string {
  const urls = [`${origen}/`, ...slugsDeSucursales.map((slug) => `${origen}/${slug}`)];
  const filas = urls.map((url) => `  <url><loc>${escaparXml(url)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${filas}\n</urlset>\n`;
}
