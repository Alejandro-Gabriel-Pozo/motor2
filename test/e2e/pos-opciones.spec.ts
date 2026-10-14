import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * GO-2d, el selector del POS con opciones (`ElegirOpciones`): un producto sin opciones se sigue sumando con un toque; uno con opciones abre el diálogo, exige lo obligatorio, muestra
 * el total ANTES de confirmar (el del servidor al pedir), deshabilita lo agotado y marca discretamente lo que el sistema registra en 0 (se vende igual). Teclado, celular y axe con el
 * diálogo abierto; el cambio de precio entre elegir y pedir («volvé a elegirla»); el doble clic que agrega una sola vez. Lo sembrado de opciones no se borra (ver
 * `fixtures/opciones.ts`); las cuentas sí.
 */

async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const l = await prisma.unidad.findFirstOrThrow({ where: { nombre: "l" } });
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const leche = await prisma.producto.create({ data: { codigo: `E2E-PO-LECHE-${m}`, nombre: `E2E Leche ${m}`, tipo: "MP", unidadStockId: l.id } });
  const cafeMolido = await prisma.producto.create({ data: { codigo: `E2E-PO-MOLIDO-${m}`, nombre: `E2E Café molido ${m}`, tipo: "MP", unidadStockId: kg.id } });
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño POS ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", monto: -300, factorEscala: 0.75 }, { nombre: "Mediano", factorEscala: 1 }, { nombre: "Grande", monto: 300, factorEscala: 1.5 }] });
  const prep = await sembrarGrupo({ nombre: `E2E Preparación POS ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Solo" }, { nombre: "Con leche", monto: 400, consumos: [{ insumoProductoId: leche.id, cantidad: 0.1 }] }, { nombre: "Cortado", monto: 200 }] });
  const extras = await sembrarGrupo({ nombre: `E2E Extras POS ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Medialuna extra", monto: 600, conAncla: true }] });
  const { productoId: cafeId } = await sembrarProductoConOpciones({ nombre: `E2E Café POS ${m}`, codigo: `E2E-PO-CAFE-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: tamano }, { grupo: prep }, { grupo: extras }] });
  await prisma.recetaVersion.create({ data: { productoId: cafeId, version: 1, ingredientes: { create: [{ insumoProductoId: cafeMolido.id, cantidad: 0.02, unidadId: kg.id }] } } });
  const medialuna = await prisma.producto.create({ data: { codigo: `E2E-PO-ML-${m}`, nombre: `E2E Medialuna POS ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 900 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: medialuna.id, disponible: true } });
  await prisma.recetaVersion.create({ data: { productoId: medialuna.id, version: 1, ingredientes: { create: [{ insumoProductoId: cafeMolido.id, cantidad: 0.01, unidadId: kg.id }] } } });
  // Cortado: agotado HOY en esta sucursal.
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId, opcionId: prep.opciones["Cortado"]!.opcionId, apagada: true, actualizadoPorId: admin.id } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Cafetería POS ${m}`, orden: 1 } });
  await prisma.contenidoCartaProducto.createMany({ data: [{ sucursalId, productoId: cafeId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 }, { sucursalId, productoId: medialuna.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 }] });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 5000 + Math.floor(Math.random() * 4000) } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    m,
    cafeId,
    nombreCafe: `E2E Café POS ${m}`,
    nombreMedialuna: `E2E Medialuna POS ${m}`,
    seccion,
    mesa,
    cuenta,
    leche,
    tamano,
    prep,
    admin,
    limpiar: async () => {
      // Las líneas con opciones tienen su foto (OpcionElegidaEnLinea, que solo se agrega): se borra todo de la cuenta como dueño.
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: cuenta.id } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id, lineaPadreId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    },
  };
}

const seccionDe = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });

async function abrirCafe(page: Page, d: Awaited<ReturnType<typeof sembrar>>) {
  await page.goto(`/mesas/${d.mesa.id}`);
  await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
  const boton = seccionDe(page, d.seccion.nombre).getByRole("button", { name: new RegExp(`^${d.nombreCafe}`) });
  return boton;
}

test("sin opciones entra con un toque; con opciones: «desde» y «Opciones», el diálogo exige el tamaño y muestra el total antes de agregar", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    const cafe = await abrirCafe(page, d);
    // La medialuna (sin opciones) se suma con un toque, como siempre.
    await seccionDe(page, d.seccion.nombre).getByRole("button", { name: new RegExp(`^${d.nombreMedialuna}`) }).click();
    await expect(page.locator(`[data-linea-por-agregar="${d.nombreMedialuna}"]`)).toBeVisible();

    await expect(cafe).toContainText("desde $ 2.200 · Opciones");
    await expect(cafe).toHaveAttribute("aria-haspopup", "dialog");
    await cafe.click();
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    await expect(dialogo).toBeVisible();
    const agregar = dialogo.getByRole("button", { name: /^Agregar/ });
    await expect(agregar).toBeDisabled();
    await expect(dialogo.locator("[data-total-opciones]")).toHaveText(`Falta elegir: E2E Tamaño POS ${d.m}`);
    // Tamaños con su precio final; la variante con su recargo; lo agotado, deshabilitado; lo que el sistema registra en 0, marcado (y se puede elegir igual).
    await expect(dialogo.getByText("Mediano").locator("xpath=ancestor::label")).toContainText("$ 2.500");
    await expect(dialogo.getByRole("radio", { name: /Cortado/ })).toBeDisabled();
    await expect(dialogo.getByText("Cortado").locator("xpath=ancestor::label")).toContainText("Agotada hoy");
    await expect(dialogo.getByText("Con leche").locator("xpath=ancestor::label")).toContainText(`Sistema: stock 0 de ${d.leche.nombre}`);
    await dialogo.getByRole("radio", { name: /Mediano/ }).check();
    await expect(agregar).toHaveText("Agregar · $ 2.500");
    await dialogo.getByRole("radio", { name: /Con leche/ }).check();
    await dialogo.getByRole("button", { name: "Sumar uno de Medialuna extra" }).click();
    await dialogo.getByRole("button", { name: "Sumar una unidad" }).click();
    // 2 × (2.500 + 400) + 2 × 600 = 7.000.
    await expect(agregar).toHaveText("Agregar · $ 7.000");
    await expect(dialogo.locator("[data-total-opciones]")).toContainText("2 × $ 2.900 + Medialuna extra 2 × $ 600");
    expect((await new AxeBuilder({ page }).analyze()).violations, "con el diálogo abierto").toEqual([]);
    await agregar.click();
    await expect(dialogo).toBeHidden();
    const linea = page.locator(`[data-linea-por-agregar="${d.nombreCafe} · Mediano · Con leche"]`);
    await expect(linea).toContainText("+ Medialuna extra ×1");
    await expect(linea).toContainText("$ 7.000");

    await page.getByRole("button", { name: "Agregar 2 al pedido" }).click();
    await expect(page.locator(`[data-linea-por-agregar]`)).toHaveCount(0);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: d.cuenta.id }, orderBy: { creadoEn: "asc" }, select: { productoId: true, cantidad: true, precioUnitario: true, lineaPadreId: true, opcionesElegidas: { select: { nombreOpcion: true } } } });
    const delCafe = items.find((i) => i.productoId === d.cafeId)!;
    expect(Number(delCafe.cantidad)).toBe(2);
    expect(Number(delCafe.precioUnitario)).toBe(2900);
    expect(delCafe.opcionesElegidas.map((o) => o.nombreOpcion).sort()).toEqual(["Con leche", "Mediano"]);
    const adicional = items.find((i) => i.lineaPadreId !== null)!;
    expect([Number(adicional.cantidad), Number(adicional.precioUnitario)]).toEqual([2, 600]);
  } finally {
    await d.limpiar();
  }
});

test("teclado: Enter abre, las flechas recorren los tamaños, Escape cierra y el foco vuelve al producto", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    const cafe = await abrirCafe(page, d);
    await cafe.focus();
    await page.keyboard.press("Enter");
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("radio", { name: /Chico/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(dialogo.getByRole("radio", { name: /Mediano/ })).toBeChecked();
    await expect(dialogo.getByRole("button", { name: /^Agregar/ })).toHaveText("Agregar · $ 2.500");
    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();
    await expect(cafe).toBeFocused();
  } finally {
    await d.limpiar();
  }
});

test("si el precio de una opción cambia entre elegir y pedir, el servidor no cobra otra cosa: avisa y la lista queda intacta; doble clic agrega una sola vez", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    const cafe = await abrirCafe(page, d);
    await cafe.click();
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    await dialogo.getByRole("radio", { name: /Grande/ }).check();
    await dialogo.getByRole("button", { name: /^Agregar/ }).click();
    // Otra persona carga un cambio de precio de «Grande» mientras tanto.
    await prisma.versionDeOpcion.create({ data: { opcionId: d.tamano.opciones["Grande"]!.opcionId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "500.00", factorEscala: "1.5000", creadoPorId: d.admin.id } });
    await page.getByRole("button", { name: "Agregar 1 al pedido" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "cambió desde que la elegiste" })).toBeVisible();
    await expect(page.locator(`[data-linea-por-agregar="${d.nombreCafe} · Grande"]`)).toBeVisible();
    expect(await prisma.cuentaItem.count({ where: { cuentaId: d.cuenta.id } })).toBe(0);

    // Se vuelve a elegir (la pantalla se recarga con el precio nuevo) y el doble clic agrega una sola vez.
    await page.reload();
    await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
    await seccionDe(page, d.seccion.nombre).getByRole("button", { name: new RegExp(`^${d.nombreCafe}`) }).click();
    await page.getByRole("dialog", { name: d.nombreCafe }).getByRole("radio", { name: /Grande/ }).check();
    await expect(page.getByRole("dialog", { name: d.nombreCafe }).getByRole("button", { name: /^Agregar/ })).toHaveText("Agregar · $ 3.000");
    await page.getByRole("dialog", { name: d.nombreCafe }).getByRole("button", { name: /^Agregar/ }).click();
    await page.getByRole("button", { name: "Agregar 1 al pedido" }).dblclick();
    await expect(page.locator(`[data-linea-por-agregar]`)).toHaveCount(0);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: d.cuenta.id }, select: { cantidad: true, precioUnitario: true } });
    expect(items.map((i) => [Number(i.cantidad), Number(i.precioUnitario)])).toEqual([[1, 3000]]);
  } finally {
    await d.limpiar();
  }
});

test("en el celular el diálogo es una hoja inferior sin scroll horizontal y pasa axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const cafe = await abrirCafe(page, d);
    await cafe.click();
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    await expect(dialogo).toBeVisible();
    const caja = (await dialogo.boundingBox())!;
    expect(Math.round(caja.y + caja.height), "pegada abajo").toBeGreaterThanOrEqual(843);
    expect(await dialogo.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations, "celular, diálogo abierto").toEqual([]);
    // El POS es siempre claro, aunque el sistema esté en oscuro.
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await dialogo.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  } finally {
    await d.limpiar();
  }
});
