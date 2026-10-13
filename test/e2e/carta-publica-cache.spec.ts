import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Caché de la parte pública de la carta, medido en el artefacto de producción (`next build` + `next start`):
 *  - la carta de una sucursal es ISR: `s-maxage=60, stale-while-revalidate=300` y la segunda visita sale del caché;
 *  - el portal, `robots.txt` y `sitemap.xml` (200) salen con `public, s-maxage=60, stale-while-revalidate=300` para la CDN;
 *  - la respuesta no depende de quién la pide: con cookies y encabezados de sesión es byte a byte la misma, y nunca trae `Set-Cookie`;
 *  - lo que NO es de la carta (login, panel autenticado) no se puede guardar en una CDN;
 *  - un cambio que no pasa por una acción que invalida (aquí, directo en la base) se ve en la carta en el minuto.
 * playwright.config.ts fija `CARTA_DOMINIO_BASE=carta.localhost` y `CARTA_EMPRESA_UNICA=e2e`; los pedidos sin navegador van a loopback con otro header Host.
 */
const CACHE_PUBLICO = "public, s-maxage=60, stale-while-revalidate=300";

function conHost(baseURL: string | undefined, host: string): { url: string; host: string } {
  const { port } = new URL(baseURL ?? "http://localhost");
  return { url: baseURL ?? "", host: `${host}${port ? `:${port}` : ""}` };
}

test.describe("carta pública: caché de la CDN", () => {
  let slug: string;
  test.beforeEach(async ({ sucursalId }) => {
    slug = `cache-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  });
  test.afterEach(async ({ sucursalId }) => {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  });

  test("la carta de una sucursal es ISR (s-maxage=60, stale-while-revalidate=300, segunda visita del caché) por el host de la carta y por la ruta técnica", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    for (const [ruta, headers] of [
      [`${url}/${slug}`, { host }],
      [`${url}/carta-publica/e2e/${slug}`, {}],
    ] as const) {
      const primera = await request.get(ruta, { headers });
      expect(primera.status(), ruta).toBe(200);
      const segunda = await request.get(ruta, { headers });
      const cc = segunda.headers()["cache-control"];
      expect(cc, ruta).toMatch(/s-maxage=60\b/);
      expect(cc, ruta).toMatch(/stale-while-revalidate=300\b/);
      expect(cc, ruta).not.toMatch(/private|no-store|no-cache/);
      expect(segunda.headers()["x-nextjs-cache"], ruta).toBe("HIT");
      expect(segunda.headers()["set-cookie"], ruta).toBeUndefined();
    }
  });

  test("el portal, robots.txt y sitemap.xml salen con el caché público de la CDN", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    for (const ruta of ["/", "/robots.txt", "/sitemap.xml"]) {
      const r = await request.get(`${url}${ruta}`, { headers: { host } });
      expect(r.status(), ruta).toBe(200);
      expect(r.headers()["cache-control"], ruta).toBe(CACHE_PUBLICO);
      expect(r.headers()["set-cookie"], ruta).toBeUndefined();
    }
    const tecnica = await request.get(`${url}/carta-publica/e2e`);
    expect(tecnica.status()).toBe(200);
    expect(tecnica.headers()["cache-control"]).toBe(CACHE_PUBLICO);
  });

  test("la respuesta es la misma para cualquiera: con cookie de sesión y Authorization el portal y la carta salen idénticos al anónimo", async ({ request, baseURL, paginaAutenticada }) => {
    const cookies = await paginaAutenticada.context().cookies();
    const sesion = cookies.find((c) => c.name === "authjs.session-token")!;
    const { url, host } = conHost(baseURL, "carta.localhost");
    for (const ruta of ["/", `/${slug}`, "/sitemap.xml"]) {
      const anonimo = await request.get(`${url}${ruta}`, { headers: { host } });
      const conSesion = await request.get(`${url}${ruta}`, { headers: { host, cookie: `${sesion.name}=${sesion.value}`, authorization: "Bearer cualquiera", "x-forwarded-for": "203.0.113.9" } });
      expect(conSesion.status(), ruta).toBe(anonimo.status());
      // El HTML lleva un nonce/ids de compilación fijos entre pedidos de la misma versión: si la página leyera la sesión, el cuerpo cambiaría.
      // Lo único que cambia entre dos pedidos del portal (que es dinámico) son las dos etiquetas de rastreo de Sentry (`sentry-trace` y `baggage`: ids aleatorios del pedido, sin nada del usuario): se las normaliza.
      const sinRastreo = (html: string) => html.replace(/<meta name="(?:sentry-trace|baggage)" content="[^"]*"\/>/g, "");
      const [a, b] = [sinRastreo(await anonimo.text()), sinRastreo(await conSesion.text())];
      const i = [...a].findIndex((c, k) => c !== b[k]);
      expect(i === -1 && a.length === b.length ? "idéntico" : `difiere en ${i}: «${a.slice(Math.max(0, i - 60), i + 80)}» vs «${b.slice(Math.max(0, i - 60), i + 80)}»`, ruta).toBe("idéntico");
      expect(conSesion.headers()["set-cookie"], ruta).toBeUndefined();
      expect(conSesion.headers()["cache-control"], ruta).toBe(anonimo.headers()["cache-control"]);
    }
  });

  test("el 404 de la parte pública (carta inexistente, empresa inexistente) sigue siendo un 404 y no se guarda más de 60 s", async ({ request, baseURL }) => {
    const { url, host } = conHost(baseURL, "carta.localhost");
    const otro = conHost(baseURL, "otra.carta.localhost").host;
    const respuestas = [
      await request.get(`${url}/no-existe-${slug}`, { headers: { host } }),
      await request.get(`${url}/no-existe-${slug}`, { headers: { host: otro } }),
      await request.get(`${url}/`, { headers: { host: otro } }),
      await request.get(`${url}/robots.txt`, { headers: { host: otro } }),
      await request.get(`${url}/sitemap.xml`, { headers: { host: otro } }),
    ];
    for (const r of respuestas) {
      // Sigue siendo un 404 (nunca se guarda ni se sirve como un 200) y, si la CDN lo guarda, a lo sumo los mismos 60 s; robots.txt y sitemap.xml ni siquiera llevan caché.
      expect(r.status(), r.url()).toBe(404);
      const cc = r.headers()["cache-control"] ?? "";
      const maximo = Number(/s-maxage=(\d+)/.exec(cc)?.[1] ?? 0);
      expect(maximo, `${r.url()} → ${cc}`).toBeLessThanOrEqual(60);
      expect(cc, r.url()).not.toMatch(/immutable|max-age=[1-9]\d{3,}/);
    }
    for (const ruta of ["/robots.txt", "/sitemap.xml"]) {
      expect((await request.get(`${url}${ruta}`, { headers: { host: otro } })).headers()["cache-control"], ruta).toBeUndefined();
    }
  });

  test("lo que no es de la carta (login y panel autenticado) no se puede guardar en una CDN", async ({ request, baseURL, paginaAutenticada }) => {
    const login = await request.get(`${baseURL}/login`);
    expect(login.status()).toBe(200);
    for (const [nombre, cc] of [["/login", login.headers()["cache-control"]]] as const) {
      expect(cc, nombre).toMatch(/private|no-store|no-cache/);
      expect(cc, nombre).not.toMatch(/public|s-maxage/);
    }
    for (const ruta of ["/", "/carta", "/carta/portal", "/catalogo/productos"]) {
      const r = await paginaAutenticada.request.get(`${baseURL}${ruta}`, { maxRedirects: 0 });
      const cc = r.headers()["cache-control"] ?? "";
      expect(cc, `${ruta} (${r.status()}) → ${cc}`).not.toMatch(/public|s-maxage/);
    }
  });

  test("un cambio hecho sin pasar por una acción que invalida (directo en la base) se ve en la carta dentro del minuto", async ({ request, baseURL, sucursalId }) => {
    test.setTimeout(150_000);
    const { url, host } = conHost(baseURL, "carta.localhost");
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E_CACHE_${marca}`, nombre: `Plato Viejo ${marca}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección ${marca}`, orden: 1 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
    try {
      const pedir = async () => (await request.get(`${url}/${slug}`, { headers: { host } })).text();
      expect(await pedir()).toContain(`Plato Viejo ${marca}`);
      expect(await pedir()).toContain(`Plato Viejo ${marca}`);
      // Sin pasar por ninguna acción de la app: ni `revalidarCartasPublicas` ni nada.
      await prisma.producto.update({ where: { id: producto.id }, data: { nombre: `Plato Nuevo ${marca}` } });
      const desde = Date.now();
      let visto = false;
      while (Date.now() - desde < 75_000) {
        if ((await pedir()).includes(`Plato Nuevo ${marca}`)) {
          visto = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
      expect(visto, "el cambio no se vio en 75 s").toBe(true);
      // 60 s de revalidate + la visita que dispara la regeneración + el margen del sondeo.
      expect(Date.now() - desde).toBeLessThanOrEqual(70_000);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.delete({ where: { id: producto.id } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
    }
  });
});
