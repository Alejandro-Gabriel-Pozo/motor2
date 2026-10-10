import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Seguridad de aplicación en un navegador real, contra el servidor de producción (`next build` + `next start`) y la base E2E descartable:
 *  - XSS ALMACENADO: aunque un texto con HTML llegara a la base (por una carga directa, un import o una validación que se afloje), la carta pública y las
 *    pantallas de administración lo dibujan como TEXTO. Se siembra por Prisma a propósito, saltando los validadores: es el peor caso, la defensa final es el escapado.
 *  - XSS REFLEJADO y redirecciones abiertas por los parámetros de la URL (`aviso`, `volver`, `editar`, filtros de reportes).
 *  - SQL INJECTION por la URL y por las rutas dinámicas: nunca un 500, nunca un detalle interno, y la base queda como estaba.
 *  - Cabeceras de seguridad y endpoints administrativos (cron) cerrados.
 *
 * Los payloads son cadenas inertes: lo único "ejecutable" es una marca (`window.__xss`) que el test busca; no hay secretos ni datos reales.
 */
const EMPRESA = "e2e";
const FILTRACION = /prisma|sqlstate|syntax error|invalid `|\bP20\d\d\b|node_modules|\.ts:\d+|at async|stack trace/i;

const XSS_HTML = [
  "<script>window.__xss=1</script>",
  '<img src=x onerror="window.__xss=1">',
  '"><svg/onload=window.__xss=1>',
  '<iframe srcdoc="<script>parent.__xss=1</script>"></iframe>',
] as const;

/** Nada del payload se convirtió en un elemento o en un manejador de eventos del DOM. */
async function afirmarInerte(page: import("@playwright/test").Page, ruta: string) {
  const resultado = await page.evaluate(() => ({
    ejecutado: (window as unknown as { __xss?: number }).__xss,
    imgRota: document.querySelectorAll('img[src="x"]').length,
    conManejador: document.querySelectorAll("[onerror],[onload],[onclick][data-payload]").length,
    // Los <script> de Next llevan el payload RSC (`self.__next_f.push`) con el texto ESCAPADO dentro de una cadena JSON: eso es dato inerte, no un script del atacante.
    scriptInyectado: [...document.scripts].filter((s) => /__xss/.test(s.textContent ?? "") && !/__next_f/.test(s.textContent ?? "")).length,
    iframes: document.querySelectorAll("iframe[srcdoc]").length,
  }));
  expect(resultado, `${ruta}: el payload se ejecutó o se convirtió en DOM`).toEqual({ ejecutado: undefined, imgRota: 0, conManejador: 0, scriptInyectado: 0, iframes: 0 });
}

test.describe("XSS almacenado: la carta pública y la administración dibujan texto, no HTML", () => {
  test("la carta de una sucursal no ejecuta ni interpreta HTML guardado en producto, descripción, etiquetas, sección ni ítem agrupado", async ({ page, request, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-xss-${marca}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const [a, b, c, d] = XSS_HTML;
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `Sección ${c}`, orden: 1 } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E_XSS_${marca}`, nombre: `Plato ${a}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
    const opcion = await prisma.producto.create({ data: { codigo: `E2E_XSS_B_${marca}`, nombre: `Opción ${b}`, tipo: "PV", precioVenta: 900, unidadStockId: unidad.id } });
    for (const p of [producto, opcion]) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: `Rico ${d} ${b}`, tags: [a, c] } });
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: `Combo ${d}`, seccionCartaId: seccion.id, orden: 2 } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: agrupado.id, productoId: opcion.id, orden: 0 } });
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });

    try {
      const dialogos: string[] = [];
      page.on("dialog", async (dialogo) => {
        dialogos.push(dialogo.message());
        await dialogo.dismiss();
      });

      for (const ruta of [`/carta-publica/${EMPRESA}/${slug}`, `/carta-publica/${EMPRESA}`]) {
        // 1) El HTML crudo del servidor: ninguna marca de etiqueta sin escapar (lo que ve un rastreador o un navegador sin JavaScript).
        const cruda = await request.get(ruta);
        expect(cruda.status(), ruta).toBe(200);
        const html = await cruda.text();
        expect(html, `${ruta}: etiqueta de payload sin escapar en el HTML`).not.toMatch(/<img src=x onerror|<svg\/onload|<iframe srcdoc|<script>window\.__xss/);

        // 2) El navegador real: nada se ejecuta y nada se vuelve DOM.
        await page.goto(ruta);
        await page.waitForLoadState("networkidle");
        await afirmarInerte(page, ruta);
        expect(dialogos, `${ruta}: se abrió un alert/confirm/prompt`).toEqual([]);
      }
      // Sanidad: el texto del producto SÍ está en la página, visible y literal (si no, el test pasaría en vacío sobre una carta que no cargó).
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      await expect(page.getByText(`Plato ${a}`, { exact: false }).first()).toBeVisible();
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: agrupado.id } });
      await prisma.itemAgrupadoCarta.delete({ where: { id: agrupado.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [producto.id, opcion.id] } } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [producto.id, opcion.id] } } });
    }
  });

  test("las pantallas de administración (proveedores, productos, clientes) dibujan los nombres como texto", async ({ paginaAutenticada: page }) => {
    const marca = `${Date.now()}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const [a, b, c] = XSS_HTML;
    const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_XSS_${marca}`, nombre: `Prov ${a}` } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E_XSS_ADM_${marca}`, nombre: `Prod ${b}`, tipo: "MP", unidadStockId: unidad.id } });
    const cliente = await prisma.cliente.create({ data: { nombre: `Cli ${c}`, descuentoPorcentaje: 0 } });
    try {
      const dialogos: string[] = [];
      page.on("dialog", async (dialogo) => {
        dialogos.push(dialogo.message());
        await dialogo.dismiss();
      });
      for (const ruta of ["/catalogo/proveedores", "/catalogo/productos", "/catalogo/clientes", `/catalogo/proveedores?editar=${encodeURIComponent(a)}`]) {
        const r = await page.goto(ruta);
        expect(r?.status(), ruta).toBeLessThan(500);
        await page.waitForLoadState("networkidle");
        await afirmarInerte(page, ruta);
        expect(dialogos, `${ruta}: se abrió un diálogo del navegador`).toEqual([]);
      }
    } finally {
      await prisma.cliente.delete({ where: { id: cliente.id } });
      await prisma.producto.delete({ where: { id: producto.id } });
      await prisma.proveedor.delete({ where: { id: proveedor.id } });
    }
  });
});

test.describe("parámetros de la URL: sin XSS reflejado, sin redirecciones abiertas, sin SQL injection", () => {
  test("/login no refleja el parámetro `aviso` ni sigue un `volver` externo (anónimo)", async ({ page, request }) => {
    const dialogos: string[] = [];
    page.on("dialog", async (dialogo) => {
      dialogos.push(dialogo.message());
      await dialogo.dismiss();
    });
    for (const payload of XSS_HTML) {
      const ruta = `/login?aviso=${encodeURIComponent(payload)}&volver=${encodeURIComponent("https://evil.example/robo")}`;
      const cruda = await request.get(ruta);
      expect(cruda.status(), ruta).toBeLessThan(500);
      expect(await cruda.text(), ruta).not.toContain(payload);
      await page.goto(ruta);
      await afirmarInerte(page, ruta);
    }
    expect(dialogos).toEqual([]);
  });

  test("con sesión, `volver` solo acepta rutas internas (no `//host`, no `https://host`, no `/\\host`, no `javascript:`)", async ({ paginaAutenticada: page, baseURL }) => {
    const origen = new URL(baseURL ?? "http://localhost").origin;
    for (const volver of ["//evil.example/robo", "https://evil.example/robo", "/\\evil.example/robo", "javascript:alert(1)", "\\\\evil.example", "/%2f%2fevil.example"]) {
      await page.goto(`/login?volver=${encodeURIComponent(volver)}`);
      await page.waitForLoadState("domcontentloaded");
      expect(new URL(page.url()).origin, `volver=${volver}: terminó en otro origen`).toBe(origen);
    }
  });

  test("rutas dinámicas de la carta con payloads de SQL y de HTML: 404 limpio, nunca 500, y la base queda igual", async ({ request }) => {
    const antes = await Promise.all([prisma.producto.count(), prisma.sucursalPublica.count(), prisma.cliente.count()]);
    const slugs = ["' OR '1'='1", "'; DROP TABLE \"Producto\"; --", "<script>alert(1)</script>", "..%2f..%2f..%2fetc%2fpasswd", "%00", "a".repeat(4000)];
    for (const slug of slugs) {
      for (const ruta of [`/carta-publica/${EMPRESA}/${encodeURIComponent(slug)}`, `/carta-publica/${encodeURIComponent(slug)}`, `/carta-publica/${encodeURIComponent(slug)}/${encodeURIComponent(slug)}`]) {
        const r = await request.get(ruta, { failOnStatusCode: false });
        expect([400, 404, 414, 431], `${ruta.slice(0, 80)}: esperaba 4xx limpio`).toContain(r.status());
        expect(await r.text(), `${ruta.slice(0, 80)}: filtra detalles internos`).not.toMatch(FILTRACION);
      }
    }
    expect(await Promise.all([prisma.producto.count(), prisma.sucursalPublica.count(), prisma.cliente.count()])).toEqual(antes);
  });

  /**
   * BRECHA CONOCIDA (hallazgo de este trabajo, sin arreglar a propósito: el arreglo va en `src/proxy.ts` o en la página, fuera del alcance de «solo controles»; ver docs/seguridad-pipeline.md §Hallazgos).
   * Un `%` que no es un escape válido en el segmento de la sucursal (`/carta-publica/e2e/%25`, `/carta-publica/e2e/abc%25zz`) hace que Next falle al decodificar el parámetro de la ruta ISR y
   * responda 500 en vez de 404. No filtra nada (el cuerpo es «Internal Server Error») ni toca la base, pero un anónimo puede provocar 500 a voluntad (ruido en Sentry y en las métricas).
   * `test.fail()` mantiene el spec en verde mientras la brecha exista y lo pone ROJO cuando alguien la arregla: ahí se quita la anotación y este comentario.
   */
  test("brecha conocida: un `%` suelto en el slug de la sucursal da 500 en vez de 404", async ({ request }) => {
    test.fail();
    for (const slug of ["%25", "abc%25zz", "%25E0%25A4%25A"]) {
      const r = await request.get(`/carta-publica/${EMPRESA}/${slug}`, { failOnStatusCode: false });
      expect(r.status(), `/carta-publica/${EMPRESA}/${slug}`).toBe(404);
    }
  });

  test("reportes con filtros maliciosos en la URL: la pantalla responde sin 500, sin filtrar y sin tocar la base", async ({ paginaAutenticada: page }) => {
    const antes = await Promise.all([prisma.producto.count(), prisma.movimientoStock.count(), prisma.operacion.count()]);
    const filtros = ["' OR '1'='1", "'; DROP TABLE \"MovimientoStock\"; --", "1; SELECT pg_sleep(5)", "<script>window.__xss=1</script>", "x".repeat(5000), "%00"];
    const rutas = (f: string) => [
      `/reportes/historial?productoId=${encodeURIComponent(f)}&seccionId=${encodeURIComponent(f)}&desde=${encodeURIComponent(f)}&hasta=${encodeURIComponent(f)}&rango=${encodeURIComponent(f)}`,
      `/reportes/compras?desde=${encodeURIComponent(f)}&hasta=${encodeURIComponent(f)}&factura=${encodeURIComponent(f)}`,
      `/reportes/trazabilidad?q=${encodeURIComponent(f)}`,
      `/reportes/periodo?desde=${encodeURIComponent(f)}&hasta=${encodeURIComponent(f)}`,
    ];
    for (const f of filtros) {
      for (const ruta of rutas(f)) {
        const t0 = Date.now();
        const r = await page.goto(ruta);
        expect(r?.status(), ruta.slice(0, 90)).toBeLessThan(500);
        expect(Date.now() - t0, `${ruta.slice(0, 90)}: ¿se ejecutó un pg_sleep?`).toBeLessThan(4500);
        expect(await page.content(), ruta.slice(0, 90)).not.toMatch(FILTRACION);
        await afirmarInerte(page, ruta.slice(0, 90));
      }
    }
    expect(await Promise.all([prisma.producto.count(), prisma.movimientoStock.count(), prisma.operacion.count()])).toEqual(antes);
  });
});

test.describe("cabeceras y endpoints administrativos", () => {
  test("la aplicación y la carta salen con las cabeceras de seguridad y sin anunciar el framework", async ({ request }) => {
    for (const ruta of ["/login", `/carta-publica/${EMPRESA}/no-existe`, "/api/cron/sincronizar-dolar"]) {
      const r = await request.get(ruta, { failOnStatusCode: false });
      const h = r.headers();
      expect(h["x-powered-by"], `${ruta}: anuncia el framework`).toBeUndefined();
      expect(h["x-content-type-options"], ruta).toBe("nosniff");
      expect(h["x-frame-options"], ruta).toBe("DENY");
      expect(h["referrer-policy"], ruta).toBeTruthy();
      expect(h["strict-transport-security"], ruta).toBeTruthy();
    }
    const login = await request.get("/login");
    const csp = login.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp, "la CSP de la aplicación no puede permitir scripts en línea ni eval").not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval')/);
  });

  test("los endpoints de cron rechazan un pedido sin secreto o con un secreto de ataque (401, sin cuerpo con detalles)", async ({ request }) => {
    for (const ruta of ["/api/cron/sincronizar-dolar", "/api/cron/sincronizar-ipc"]) {
      for (const autorizacion of [undefined, "", "Bearer ", "Bearer ' OR '1'='1", "Bearer <script>alert(1)</script>", "Basic YWRtaW46YWRtaW4="]) {
        const r = await request.get(ruta, { headers: autorizacion === undefined ? {} : { authorization: autorizacion }, failOnStatusCode: false });
        expect(r.status(), `${ruta} con ${JSON.stringify(autorizacion)}`).toBe(401);
        expect(await r.text()).not.toMatch(FILTRACION);
      }
      // Un POST/PUT/DELETE no tiene nada que hacer ahí.
      for (const metodo of ["post", "put", "delete"] as const) {
        const r = await request[metodo](ruta, { failOnStatusCode: false });
        expect([404, 405], `${metodo.toUpperCase()} ${ruta}`).toContain(r.status());
      }
    }
  });
});
