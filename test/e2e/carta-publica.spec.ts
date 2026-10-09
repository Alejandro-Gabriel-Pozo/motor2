import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Carta pública nueva (ADR-006, Fase 3): `/carta-publica/<empresa>/...`, sin sesión. La empresa `e2e` es la de
 * la base (fixtures/auth.ts, `asegurarBaseSeed`) y se resuelve por slug (src/server/lecturas/carta/empresa.ts).
 */
const EMPRESA = "e2e";

test.describe("portal de sucursales", () => {
  test("lista una sucursal publicada y activa; oculta una no publicada y una inactiva", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const otra = await prisma.sucursal.create({ data: { nombre: `E2E Portal Otra ${marca}` } });
    const inactiva = await prisma.sucursal.create({ data: { nombre: `E2E Portal Inactiva ${marca}`, activo: false } });
    try {
      await prisma.sucursalPublica.createMany({
        data: [
          { sucursalId, slug: `e2e-central-${marca}`, publicada: true, etiqueta: `Central ${marca}` },
          { sucursalId: otra.id, slug: `e2e-otra-${marca}`, publicada: false, etiqueta: `Otra ${marca}` },
          { sucursalId: inactiva.id, slug: `e2e-inactiva-${marca}`, publicada: true, etiqueta: `Inactiva ${marca}` },
        ],
      });
      await page.goto(`/carta-publica/${EMPRESA}`);
      await expect(page.getByRole("link", { name: new RegExp(`Central ${marca}`) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`Otra ${marca}`) })).toHaveCount(0);
      await expect(page.getByRole("link", { name: new RegExp(`Inactiva ${marca}`) })).toHaveCount(0);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [sucursalId, otra.id, inactiva.id] } } });
      await prisma.sucursal.deleteMany({ where: { id: { in: [otra.id, inactiva.id] } } });
    }
  });

  test("una empresa que no resuelve da 404", async ({ page }) => {
    const r = await page.goto("/carta-publica/no-existe-esta-empresa");
    expect(r?.status()).toBe(404);
  });
});

const IMAGEN_MAPA = "https://cdn.example.com/e2e-mapa.svg";
const SVG_MAPA = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1533"><rect width="100%" height="100%" fill="#5a7d5a"/></svg>';

test.describe("portal con mapa (ADR-006)", () => {
  test("con imagen y posiciones: las tarjetas van sobre el mapa en su lugar, las sin posición en una grilla debajo; sin imagen, todo es lista", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const otra = await prisma.sucursal.create({ data: { nombre: `E2E Mapa Otra ${marca}` } });
    await page.route(IMAGEN_MAPA, (route) => route.fulfill({ contentType: "image/svg+xml", body: SVG_MAPA }));
    try {
      await prisma.sucursalPublica.createMany({
        data: [
          { sucursalId, slug: `e2e-mapa-a-${marca}`, publicada: true, etiqueta: `En mapa ${marca}`, subtituloPortal: "Sobre la imagen", posX: 30, posY: 40, posW: 30, posH: 10 },
          { sucursalId: otra.id, slug: `e2e-mapa-b-${marca}`, publicada: true, etiqueta: `Sin posición ${marca}` },
        ],
      });
      await prisma.portalCartaEmpresa.deleteMany();
      await prisma.portalCartaEmpresa.create({ data: { valores: { portal_bg_image_url: IMAGEN_MAPA, portal_bg_proporcion: "1080/1533", portal_titulo: `Portal ${marca}`, portal_card_bg: "#112233" } } });

      await page.goto(`/carta-publica/${EMPRESA}`);
      await expect(page.getByRole("heading", { name: `Portal ${marca}`, level: 1 })).toBeVisible();
      const mapa = page.locator(".portal-mapa");
      await expect(mapa).toBeVisible();
      const enMapa = mapa.getByRole("link", { name: new RegExp(`En mapa ${marca}`) });
      await expect(enMapa).toBeVisible();
      await expect(mapa.getByRole("link", { name: new RegExp(`Sin posición ${marca}`) })).toHaveCount(0);
      const enGrilla = page.locator("main").getByRole("link", { name: new RegExp(`Sin posición ${marca}`) });
      await expect(enGrilla).toBeVisible();

      // La tarjeta está centrada en (30%, 40%) del mapa y la grilla queda debajo del mapa.
      const cajaMapa = await mapa.boundingBox();
      const cajaTarjeta = await enMapa.boundingBox();
      const cajaGrilla = await enGrilla.boundingBox();
      if (!cajaMapa || !cajaTarjeta || !cajaGrilla) throw new Error("sin cajas");
      expect(Math.abs(cajaTarjeta.x + cajaTarjeta.width / 2 - (cajaMapa.x + cajaMapa.width * 0.3))).toBeLessThan(2);
      expect(Math.abs(cajaTarjeta.y + cajaTarjeta.height / 2 - (cajaMapa.y + cajaMapa.height * 0.4))).toBeLessThan(2);
      expect(cajaGrilla.y).toBeGreaterThan(cajaMapa.y + cajaMapa.height);
      await expect(enMapa).toHaveAttribute("href", `/carta-publica/${EMPRESA}/e2e-mapa-a-${marca}`);

      // Sin imagen de fondo: no hay mapa, las dos son una lista.
      await prisma.portalCartaEmpresa.deleteMany();
      await page.goto(`/carta-publica/${EMPRESA}`);
      await expect(page.locator(".portal-mapa")).toHaveCount(0);
      await expect(page.getByRole("link", { name: new RegExp(`En mapa ${marca}`) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`Sin posición ${marca}`) })).toBeVisible();
    } finally {
      await prisma.portalCartaEmpresa.deleteMany();
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [sucursalId, otra.id] } } });
      await prisma.sucursal.deleteMany({ where: { id: otra.id } });
    }
  });

  test("un valor de apariencia inválido guardado a mano cae al default y no rompe el portal", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    try {
      await prisma.sucursalPublica.create({ data: { sucursalId, slug: `e2e-mapa-inv-${marca}`, publicada: true, etiqueta: `Inválido ${marca}` } });
      await prisma.portalCartaEmpresa.deleteMany();
      await prisma.portalCartaEmpresa.create({ data: { valores: { portal_card_bg: "red;position:fixed", portal_bg_image_url: "javascript:alert(1)", portal_titulo: `Título ${marca}` } } });
      await page.goto(`/carta-publica/${EMPRESA}`);
      await expect(page.getByRole("heading", { name: `Título ${marca}`, level: 1 })).toBeVisible();
      await expect(page.locator(".portal-mapa")).toHaveCount(0);
      await expect(page.getByRole("link", { name: new RegExp(`Inválido ${marca}`) })).toBeVisible();
    } finally {
      await prisma.portalCartaEmpresa.deleteMany();
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });
});

test.describe("carta de una sucursal", () => {
  test("muestra la sección, un PV con precio formateado y la promo; slug inexistente da 404", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-carta-${marca}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const producto = await prisma.producto.create({
      data: { codigo: `E2E_CARTAPUB_${marca}`, nombre: `E2E Plato ${marca}`, tipo: "PV", precioVenta: 12345, unidadStockId: unidad.id },
    });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección ${marca}` } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
    const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo: `E2E Promo ${marca}`, precio: 5000 } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });

    try {
      const noExiste = await page.goto(`/carta-publica/${EMPRESA}/no-existe-${marca}`);
      expect(noExiste?.status()).toBe(404);

      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      // Ir a la sección desde el índice.
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      await expect(page.getByText(producto.nombre)).toBeVisible();
      await expect(page.getByText("$12.345")).toBeVisible();
      await expect(page.getByText(promo.titulo)).toBeVisible();
      await expect(page.getByText("$5.000")).toBeVisible();
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { id: promo.id } } });
      await prisma.promoCarta.delete({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
      await prisma.producto.delete({ where: { id: producto.id } });
    }
  });

  test("precio local: con la capacidad precio_local apagada la carta muestra el precio central; al reactivarla (desde el admin), el local", async ({ page, paginaAutenticada, sucursalId }) => {
    const sucursal = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-preciolocal-${marca}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const producto = await prisma.producto.create({
      data: { codigo: `E2E_PLCAP_${marca}`, nombre: `E2E Plato Local ${marca}`, tipo: "PV", precioVenta: 11111, unidadStockId: unidad.id },
    });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección Local ${marca}` } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: producto.id, precio: 22222, habilitado: true } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId, habilitado: false } });
    // O.41: cambiar una capacidad es solo del gerente. Este test es sobre la revalidación de la carta, no sobre ese punto: el usuario de las pruebas (que no es
    // gerente por defecto) pasa a serlo mientras dura, y al terminar la empresa queda sin gerente, como la esperan los demás specs.
    const admin = await prismaAdmin.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { empresaId: sucursal.empresaId, rolEmpresa: "gerente" }, data: { rolEmpresa: null } });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId: sucursal.empresaId } }, data: { rolEmpresa: "gerente" } });

    try {
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      await expect(page.getByText(producto.nombre)).toBeVisible();
      await expect(page.getByText("$11.111")).toBeVisible();
      await expect(page.getByText("$22.222")).toHaveCount(0);

      // La carta está cacheada (ISR): reactivar la capacidad desde el admin tiene que invalidarla, no esperar los 5 minutos.
      await paginaAutenticada.goto("/administracion/capacidades-sucursal");
      const columnas = await paginaAutenticada.locator("thead th").allTextContents();
      const indice = columnas.findIndex((t) => t.trim() === sucursal.nombre);
      expect(indice, "no apareció la columna de la sucursal").toBeGreaterThan(1);
      const celda = paginaAutenticada.locator("tr", { has: paginaAutenticada.getByRole("cell", { name: "precio_local", exact: true }) }).locator("td").nth(indice);
      await expect(celda.getByRole("button")).toHaveText("⛔");
      await celda.getByRole("button").click();
      await expect(celda.getByRole("button")).toHaveText("✅");

      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      await expect(page.getByText("$22.222")).toBeVisible();
      await expect(page.getByText("$11.111")).toHaveCount(0);
    } finally {
      await prismaAdmin.usuarioEmpresa.updateMany({ where: { empresaId: sucursal.empresaId, rolEmpresa: "gerente" }, data: { rolEmpresa: null } });
      await prisma.capacidadSucursal.deleteMany({ where: { accionClave: "precio_local", sucursalId } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.precioLocalProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
      await prisma.producto.delete({ where: { id: producto.id } });
    }
  });

  test("con tema aplicado se ve el color de marca; sin aplicar, el default", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-tema-${marca}`;
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId, aplicarEnCarta: true, valores: { color_marca: "#123456" } } });

    try {
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      // La variable se pisa en el wrapper de NavegacionCarta (dentro de .carta-shell): getComputedStyle sobre un
      // ANCESTRO no la vería (las custom properties heredan hacia abajo, no hacia arriba).
      const primary = await page.evaluate(() => getComputedStyle(document.querySelector(".carta-slider")!).getPropertyValue("--carta-color-marca").trim());
      expect(primary).toBe("#123456");
    } finally {
      await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });
});

test.describe("sin boundary HTTP (ADR-006, Fase 8)", () => {
  // proxy.ts excluye /api del matcher: una ruta borrada da el 404 liso de Next, sin redirigir a /login.
  for (const ruta of ["/api/carta/tenants", "/api/carta/central", "/api/carta/central/tema"]) {
    test(`GET ${ruta} da 404`, async ({ request }) => {
      const r = await request.get(ruta, { maxRedirects: 0 });
      expect(r.status()).toBe(404);
    });
  }
});
