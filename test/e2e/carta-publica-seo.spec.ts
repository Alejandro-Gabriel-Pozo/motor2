import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { MARCA_PUBLICA } from "../../src/core/carta/marca";

/**
 * La parte pública de la carta vista por quien comparte el enlace y por un buscador, medida en el artefacto de producción (`next build` + `next start`):
 *  - ni «Motor2» ni «ERP» en el HTML público (título, descripción, Open Graph, Twitter), tampoco en el 404 de la parte pública;
 *  - título, descripción, canónica, robots, Open Graph y Twitter de cada página, con la marca fija y los datos de la sucursal;
 *  - `robots.txt` y `sitemap.xml` en el host de la carta (portal y SOLO las sucursales públicas) y `Disallow: /` en el host de la aplicación, que además sale con `noindex`.
 * playwright.config.ts fija `CARTA_DOMINIO_BASE=carta.localhost` y `CARTA_EMPRESA_UNICA=e2e`: la dirección pública definitiva de la empresa `e2e` es el dominio base pelado
 * (`http://carta.localhost`, sin https por ser localhost). Los pedidos sin navegador van a loopback con otro header Host.
 */
const SIN_NOMBRE_DE_LA_APP = /motor2|\berp\b/i;

function conHost(baseURL: string | undefined, host: string): { url: string; host: string } {
  const { port } = new URL(baseURL ?? "http://localhost");
  return { url: baseURL ?? "", host: `${host}${port ? `:${port}` : ""}` };
}

/** El contenido de un `<meta>` por su `name` o `property`. */
function meta(html: string, clave: string): string | undefined {
  const m = new RegExp(`<meta[^>]+(?:name|property)="${clave}"[^>]+content="([^"]*)"`).exec(html) ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="${clave}"`).exec(html);
  return m?.[1];
}
const head = (html: string) => /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
const canonica = (html: string) => /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/.exec(html)?.[1];

test.describe("carta pública: marca, metadatos y buscadores", () => {
  let slug: string;
  let slugBorrador: string;
  test.beforeEach(async ({ sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    slug = `seo-${marca}`;
    slugBorrador = `seo-borrador-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true, etiqueta: `Sucursal SEO ${marca}` } });
  });
  test.afterEach(async ({ sucursalId }) => {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  });

  test("la carta de una sucursal: título con la marca, descripción, canónica, robots, Open Graph y Twitter; sin el nombre de la aplicación", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    const r = await request.get(`${url}/${slug}`, { headers: { host } });
    expect(r.status()).toBe(200);
    const html = await r.text();
    const cabeza = head(html);
    expect(cabeza).toMatch(/<title>[^<]*· Carta · Hoteles del Neuquén<\/title>/);
    expect(MARCA_PUBLICA).toBe("Hoteles del Neuquén");
    expect(meta(html, "description")).toMatch(/^Carta de .+ — Hoteles del Neuquén\./);
    expect(canonica(html)).toBe(`http://carta.localhost/${slug}`);
    expect(meta(html, "robots")).toBe("index, follow");
    expect(meta(html, "og:title")).toBe(/<title>([^<]*)<\/title>/.exec(cabeza)?.[1]);
    expect(meta(html, "og:description")).toBe(meta(html, "description"));
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "og:locale")).toBe("es_AR");
    expect(meta(html, "og:site_name")).toBe(MARCA_PUBLICA);
    expect(meta(html, "og:url")).toBe(`http://carta.localhost/${slug}`);
    expect(meta(html, "og:image"), "sin imagen cargada por el comercio no se inventa ninguna").toBeUndefined();
    expect(meta(html, "twitter:card")).toBe("summary");
    expect(meta(html, "twitter:title")).toBe(meta(html, "og:title"));
    expect(meta(html, "twitter:description")).toBe(meta(html, "description"));
    expect(cabeza).not.toMatch(SIN_NOMBRE_DE_LA_APP);
    // El título y la descripción entran en lo que muestran los buscadores sin cortar.
    expect(/<title>([^<]*)<\/title>/.exec(cabeza)![1].length).toBeLessThanOrEqual(60);
    expect(meta(html, "description")!.length).toBeLessThanOrEqual(160);
  });

  test("el portal: título, descripción con las sucursales, canónica en la raíz del host público; sin el nombre de la aplicación", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    const r = await request.get(`${url}/`, { headers: { host } });
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(head(html)).toContain(`<title>${MARCA_PUBLICA} · Cartas</title>`);
    expect(meta(html, "description")).toMatch(/^Cartas? de Hoteles del Neuquén: Sucursal SEO /);
    expect(canonica(html)).toMatch(/^http:\/\/carta.localhost\/?$/);
    expect(meta(html, "robots")).toBe("index, follow");
    expect(meta(html, "og:url")).toMatch(/^http:\/\/carta.localhost\/?$/);
    expect(meta(html, "og:site_name")).toBe(MARCA_PUBLICA);
    expect(meta(html, "twitter:card")).toBe("summary");
    expect(head(html)).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });

  test("el 404 de la parte pública (carta inexistente, empresa inexistente) tampoco nombra la aplicación", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    for (const [ruta, h] of [
      [`/no-existe-${slug}`, host],
      [`/no-existe-${slug}`, conHost(baseURL, "otra.carta.localhost").host],
      ["/", conHost(baseURL, "otra.carta.localhost").host],
    ] as const) {
      const r = await request.get(`${url}${ruta}`, { headers: { host: h } });
      expect(r.status(), `${h}${ruta}`).toBe(404);
      const html = await r.text();
      expect(html, `${h}${ruta}`).toContain("No encontramos esta carta");
      expect(head(html), `${h}${ruta}`).toContain("<title>Carta</title>");
      expect(html, `${h}${ruta}`).not.toMatch(SIN_NOMBRE_DE_LA_APP);
      expect(meta(html, "robots"), `${h}${ruta}`).toMatch(/noindex/);
    }
  });

  test("robots.txt y sitemap.xml del host de la carta: permite todo y lista el portal y SOLO las sucursales públicas", async ({ request, baseURL }) => {
    // Una sucursal NO publicada y otra inactiva no pueden aparecer.
    const borrador = await prisma.sucursal.create({ data: { nombre: `Borrador ${slugBorrador}` } });
    await prisma.sucursalPublica.create({ data: { sucursalId: borrador.id, slug: slugBorrador, publicada: false } });
    const inactiva = await prisma.sucursal.create({ data: { nombre: `Inactiva ${slugBorrador}`, activo: false } });
    await prisma.sucursalPublica.create({ data: { sucursalId: inactiva.id, slug: `${slugBorrador}-i`, publicada: true } });
    try {
      for (const nombreHost of ["carta.localhost", "e2e.carta.localhost"]) {
        const { url, host } = conHost(baseURL, nombreHost);
        const robots = await request.get(`${url}/robots.txt`, { headers: { host } });
        expect(robots.status(), nombreHost).toBe(200);
        expect(robots.headers()["content-type"]).toContain("text/plain");
        expect(await robots.text()).toBe("User-agent: *\nAllow: /\n\nSitemap: http://carta.localhost/sitemap.xml\n");

        const mapa = await request.get(`${url}/sitemap.xml`, { headers: { host } });
        expect(mapa.status(), nombreHost).toBe(200);
        expect(mapa.headers()["content-type"]).toContain("xml");
        const xml = await mapa.text();
        expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort()).toEqual(["http://carta.localhost/", `http://carta.localhost/${slug}`].sort());
        expect(xml).not.toContain(slugBorrador);
        expect(xml).not.toMatch(SIN_NOMBRE_DE_LA_APP);
      }
      // Otra empresa (que no existe) no recibe nada del e2e.
      const { url, host } = conHost(baseURL, "otra.carta.localhost");
      expect((await request.get(`${url}/robots.txt`, { headers: { host } })).status()).toBe(404);
      expect((await request.get(`${url}/sitemap.xml`, { headers: { host } })).status()).toBe(404);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [borrador.id, inactiva.id] } } });
      await prisma.sucursal.deleteMany({ where: { id: { in: [borrador.id, inactiva.id] } } });
    }
  });

  test("el host de la aplicación: robots.txt prohíbe todo y sus respuestas salen con noindex; la ruta técnica de la carta también", async ({ request, baseURL }) => {
    const robots = await request.get(`${baseURL}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/i);
    for (const ruta of ["/login", "/robots.txt", `/carta-publica/e2e/${slug}`, "/carta-publica/e2e"]) {
      const r = await request.get(`${baseURL}${ruta}`);
      expect(r.headers()["x-robots-tag"], ruta).toBe("noindex, nofollow");
    }
  });

  test("en el host de la carta las respuestas son indexables (X-Robots-Tag: index, follow) y los archivos que no son de la carta siguen en 404", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    for (const ruta of ["/", `/${slug}`, "/robots.txt", "/sitemap.xml"]) {
      const r = await request.get(`${url}${ruta}`, { headers: { host } });
      expect(r.status(), ruta).toBe(200);
      expect(r.headers()["x-robots-tag"], ruta).toBe("index, follow");
    }
    for (const ruta of ["/humans.txt", "/sitemap.txt", "/robots.txt/x", "/login"]) {
      expect((await request.get(`${url}${ruta}`, { headers: { host } })).status(), ruta).toBe(404);
    }
  });
});
