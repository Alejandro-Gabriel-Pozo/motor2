import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import AxeBuilder from "@axe-core/playwright";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

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

  test("CARTA-B y CARTA-C: tamaños en lista con puntitos, línea «Adicionales:» y las opciones sin costo (preparación, guarnición) como pastillas bajo el nombre de su grupo, sin «Ver opciones»; marcar una opción agotada desde la app la saca al instante", async ({
    page,
    paginaAutenticada,
    sucursalId,
  }) => {
    const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const slug = `e2e-opciones-${m}`;
    // El café del dueño: tamaño 2.500 / 2.800 / 3.100 (diferencia 0 / +300 / +600 sobre 2.500), preparación «Solo» / «Flat white» / «Cortado» sin costo y «Con leche +400», y extras «Medialuna +600» y «Shot +500».
    const tamano = await sembrarGrupo({ nombre: `Tamaño ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 0.75 }, { nombre: "Mediano", monto: 300, factorEscala: 1 }, { nombre: "Grande", monto: 600, factorEscala: 1.5 }] });
    const preparacion = await sembrarGrupo({ nombre: `Preparación ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Solo" }, { nombre: "Flat white" }, { nombre: "Cortado" }, { nombre: "Con leche", monto: 400 }] });
    const extras = await sembrarGrupo({ nombre: `Extras ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Medialuna", monto: 600, conAncla: true }, { nombre: "Shot", monto: 500, conAncla: true }] });
    // La milanesa: la guarnición no cambia el precio; se lee debajo del plato (la elige el mozo en el POS) y la «ninguna» no.
    const guarnicion = await sembrarGrupo({ nombre: `Guarnición ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Papas fritas" }, { nombre: "Puré" }, { nombre: "Ensalada" }, { nombre: "Sin guarnición", esNinguna: true }] });
    const cafe = `E2E Café carta ${m}`;
    const milanesa = `E2E Milanesa carta ${m}`;
    const flan = `E2E Flan carta ${m}`;
    const { productoId: cafeId } = await sembrarProductoConOpciones({ nombre: cafe, codigo: `E2E-CPO-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: tamano }, { grupo: preparacion }, { grupo: extras }] });
    const { productoId: milanesaId } = await sembrarProductoConOpciones({ nombre: milanesa, codigo: `E2E-CPM-${m}`, precioVenta: 9500, sucursalId, grupos: [{ grupo: guarnicion }] });
    const { productoId: flanId } = await sembrarProductoConOpciones({ nombre: flan, codigo: `E2E-CPF-${m}`, precioVenta: 3200, sucursalId, grupos: [] });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección opciones ${m}` } });
    for (const [orden, productoId] of [cafeId, milanesaId, flanId].entries()) await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden } });
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    const abrir = async () => {
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      return { cafe: page.locator("li", { has: page.getByRole("heading", { name: cafe }) }), milanesa: page.locator("li", { has: page.getByRole("heading", { name: milanesa }) }), flan: page.locator("li", { has: page.getByRole("heading", { name: flan }) }) };
    };
    const tamanoPx = (l: import("@playwright/test").Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    try {
      for (const ancho of [375, 1280]) {
        await page.setViewportSize({ width: ancho, height: ancho === 375 ? 800 : 900 });
        const filas = await abrir();
        const lista = filas.cafe.locator(`[data-tamanos-carta='Tamaño ${m}']`);
        // La lista de tamaños está a la vista sin tocar nada: un renglón por tamaño con su precio FINAL, y el renglón del nombre va sin precio ni «desde».
        await expect(lista).toBeVisible();
        await expect(lista.getByRole("listitem")).toHaveText(["Chico$2.500", "Mediano$2.800", "Grande$3.100"]);
        await expect(filas.cafe.locator("h3").locator("..")).not.toContainText("$");
        await expect(filas.cafe).not.toContainText("desde");
        await expect(filas.cafe).not.toContainText("Ver opciones");
        expect(await filas.cafe.locator("details").count(), "ningún desplegable").toBe(0);
        // La línea «Adicionales:» con lo que suma una variante o un adicional; «Solo», «Flat white» y «Cortado» (sin costo) NO están ahí: van como pastillas.
        const suma = filas.cafe.locator("[data-suma-carta]");
        await expect(suma).toBeVisible();
        await expect(suma).toHaveText("Adicionales: Con leche +$400 · Medialuna +$600 · Shot +$500");
        await expect(suma.locator("strong")).toHaveText("Adicionales:");
        // Las pastillas de la preparación: bajo el nombre del grupo, a la vista, en el orden del grupo, en una lista con el nombre del grupo; no son botones.
        const pastillasCafe = filas.cafe.locator(`[data-opciones-sin-costo='Preparación ${m}']`);
        await expect(pastillasCafe).toBeVisible();
        await expect(pastillasCafe.locator("p")).toHaveText(`Preparación ${m}`);
        await expect(filas.cafe.getByRole("list", { name: `Preparación ${m}` }).getByRole("listitem")).toHaveText(["Solo", "Flat white", "Cortado"]);
        await expect(pastillasCafe.locator("button, [role='button'], [tabindex], a")).toHaveCount(0);
        // La milanesa (Fase 5, forma «simple»): su precio base de siempre y, debajo, la aclaración «Guarnición: papas fritas, puré o ensalada» (sin «Ver opciones» ni desplegable; sin la «ninguna»); el flan, un producto común.
        await expect(filas.milanesa).toContainText("$9.500");
        const guarnicionMila = filas.milanesa.locator(`[data-aclaracion='Guarnición ${m}']`);
        await expect(guarnicionMila).toBeVisible();
        await expect(guarnicionMila).toHaveText(`Guarnición ${m}: papas fritas, puré o ensalada`);
        await expect(filas.milanesa).not.toContainText("Ver opciones");
        await expect(filas.milanesa).not.toContainText("Sin guarnición");
        expect(await filas.milanesa.locator("details").count(), "ningún desplegable").toBe(0);
        await expect(filas.milanesa.locator("[data-tamanos-carta], [data-suma-carta]")).toHaveCount(0);
        await expect(filas.flan).toContainText("$3.200");
        await expect(filas.flan.locator("[data-opciones-sin-costo]")).toHaveCount(0);
        await expect(page.locator("body")).not.toContainText("Sin guarnición");
        // Legibilidad (escala única, DEC-35): nombre del ítem 19 px (rol Producto), tamaños 16 px (rol Opción), «Adicionales» y pastillas 14 px (rol Aclaración); el flan, sin opciones, también 19 px.
        expect(await tamanoPx(filas.cafe.getByRole("heading", { name: cafe }))).toBeGreaterThanOrEqual(19);
        expect(await tamanoPx(filas.flan.getByRole("heading", { name: flan }))).toBeGreaterThanOrEqual(19);
        expect(await tamanoPx(lista.getByRole("listitem").first().locator("span").first())).toBeGreaterThanOrEqual(16);
        expect(await tamanoPx(suma)).toBeGreaterThanOrEqual(14);
        expect(await tamanoPx(pastillasCafe.locator("p"))).toBeGreaterThanOrEqual(14);
        for (const pastilla of await pastillasCafe.getByRole("listitem").all()) expect(await tamanoPx(pastilla)).toBeGreaterThanOrEqual(14);
        expect(await tamanoPx(guarnicionMila)).toBeGreaterThanOrEqual(14);
        // Sin desborde horizontal tampoco de las pastillas (envuelven a la línea siguiente).
        expect(await pastillasCafe.evaluate((el) => el.scrollWidth <= el.clientWidth), `las pastillas se desbordan a ${ancho} px`).toBe(true);
        // Sin desborde horizontal: ni la página ni la fila del café.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `la página se desborda a ${ancho} px`).toBe(true);
        expect(await filas.cafe.evaluate((el) => el.scrollWidth <= el.clientWidth), `el café se desborda a ${ancho} px`).toBe(true);
        expect(await filas.milanesa.evaluate((el) => el.scrollWidth <= el.clientWidth), `la milanesa se desborda a ${ancho} px`).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations, `carta con opciones a ${ancho} px`).toEqual([]);
      }

      // El encargado marca «Mediano» agotado hoy: la carta (cacheada, ISR) lo deja de mostrar en la próxima visita, sin esperar el minuto.
      await page.setViewportSize({ width: 375, height: 800 });
      await paginaAutenticada.goto("/movimientos/opciones-agotadas");
      const pildora = paginaAutenticada.getByRole("region", { name: new RegExp(`^Tamaño ${m}`) }).getByRole("button", { name: "Mediano: Disponible" });
      await pildora.click();
      await expect(paginaAutenticada.getByRole("status").filter({ hasText: "quedó agotada" })).toBeVisible();
      const despues = await abrir();
      await expect(despues.cafe.getByRole("listitem").filter({ hasText: "Chico" })).toBeVisible();
      await expect(despues.cafe.locator(`[data-tamanos-carta='Tamaño ${m}']`).getByRole("listitem")).toHaveText(["Chico$2.500", "Grande$3.100"]);
      await expect(despues.cafe).not.toContainText("Mediano");
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
      // La opción agotada se vuelve a prender (las filas de opciones no se borran: ver `fixtures/opciones.ts`).
      await prisma.opcionApagadaEnSucursal.updateMany({ where: { sucursalId, opcionId: tamano.opciones["Mediano"]!.opcionId }, data: { apagada: false } });
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
