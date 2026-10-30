import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { impresiones, interceptarImpresion } from "./fixtures/impresion";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * GO-2d, paso 8: la mesa con una línea con opciones. «Sin enviar» y cada envío muestran las opciones del producto y sus adicionales debajo (sin botón propio); la comanda lleva las
 * opciones y el adicional, el ticket el adicional en su propia línea con su precio; «Quitar» un producto con adicionales pide confirmar y se lleva los adicionales; «Anular» lo
 * avisa y los arrastra; «Otro igual» abre «Elegir opciones» con la misma elección. Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`); la mesa, la cuenta y la venta sí.
 */

const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

async function sembrar(sucursalId: string, numero: number) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const molido = await prisma.producto.create({ data: { codigo: `E2E-PM-MOLIDO-${m}`, nombre: `E2E Molido mesa ${m}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: molido.id, disponible: true } });
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño mesa ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Mediano", factorEscala: 1 }, { nombre: "Grande", monto: 300, factorEscala: 1.5 }] });
  const extras = await sembrarGrupo({ nombre: `E2E Extras mesa ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Medialuna extra", monto: 600, conAncla: true }] });
  const nombreCafe = `E2E Café mesa ${m}`;
  const { productoId: cafeId } = await sembrarProductoConOpciones({ nombre: nombreCafe, codigo: `E2E-PM-CAFE-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: tamano }, { grupo: extras }] });
  // Con receta el café y el respaldo del adicional (lo que se vende al cerrar descuenta stock de algo).
  const anclaId = extras.opciones["Medialuna extra"]!.anclaId!;
  for (const productoId of [cafeId, anclaId]) await prisma.recetaVersion.create({ data: { productoId, version: 1, ingredientes: { create: [{ insumoProductoId: molido.id, cantidad: 0.01, unidadId: kg.id }] } } });
  const ancla = await prisma.producto.findUniqueOrThrow({ where: { id: anclaId } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Cafetería mesa ${m}`, orden: 1 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: cafeId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    m,
    cafeId,
    nombreCafe,
    nombreAncla: ancla.nombre,
    seccion,
    mesa,
    cuenta,
    limpiar: async () => {
      const items = await prismaAdmin.cuentaItem.findMany({ where: { cuenta: { mesaId: mesa.id } }, select: { operacionId: true } });
      const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
      const cuentaIds = (await prismaAdmin.cuenta.findMany({ where: { mesaId: mesa.id }, select: { id: true } })).map((c) => c.id);
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: { in: cuentaIds } } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds }, anulaAItemId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds }, lineaPadreId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: [...operacionIds, ...cuentaIds] } } });
      await prismaAdmin.movimientoStock.deleteMany({ where: { operacionId: { in: operacionIds } } });
      await prismaAdmin.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      await prismaAdmin.ejemplarTicket.deleteMany({ where: { cuentaId: { in: cuentaIds }, corrigeAId: { not: null } } });
      await prismaAdmin.ejemplarTicket.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
      await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
      await prismaAdmin.cuenta.deleteMany({ where: { id: { in: cuentaIds } } });
      await prismaAdmin.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    },
  };
}

/** Pide «1 × Café Grande + 1 Medialuna extra» desde el diálogo y lo agrega a la mesa. */
async function pedirCafeGrandeConMedialuna(page: Page, d: Awaited<ReturnType<typeof sembrar>>) {
  await page.goto(`/mesas/${d.mesa.id}`);
  await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
  await page.getByRole("region", { name: d.seccion.nombre }).getByRole("button", { name: new RegExp(`^${d.nombreCafe}`) }).click();
  const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
  await dialogo.getByRole("radio", { name: /Grande/ }).check();
  await dialogo.getByRole("button", { name: "Sumar uno de Medialuna extra" }).click();
  await dialogo.getByRole("button", { name: /^Agregar/ }).click();
  await expect(dialogo).toBeHidden();
  await page.getByRole("button", { name: "Agregar 1 al pedido" }).click();
  await expect(aviso(page)).toContainText("Se agregó");
}

test("la mesa muestra las opciones y el adicional bajo su producto; la comanda los lleva y el ticket cobra el adicional en su línea", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId, 7100 + Math.floor(Math.random() * 800));
  try {
    await interceptarImpresion(page);
    await pedirCafeGrandeConMedialuna(page, d);

    // «Sin enviar»: una línea (el adicional no cuenta aparte), con «Grande» debajo y el adicional con sangría, su importe y sin botón propio.
    await expect(page.getByRole("heading", { name: "Sin enviar · 1" })).toBeVisible();
    const linea = page.locator(`[data-item-sin-enviar="${d.nombreCafe}"]`);
    await expect(linea.locator("[data-opciones-de-linea]")).toHaveText("Grande");
    const adicional = linea.locator(`[data-adicional-sin-enviar="${d.nombreAncla}"]`);
    await expect(adicional).toContainText(`+ 1 × ${d.nombreAncla}`);
    await expect(adicional).toContainText("$ 600");
    await expect(adicional.getByRole("button")).toHaveCount(0);
    await expect(linea).toContainText("$ 2.800");
    expect((await new AxeBuilder({ page }).analyze()).violations, "sin enviar con opciones").toEqual([]);

    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda"]);
    const [comanda] = await impresiones(page);
    expect(comanda!.texto).toContain(`1 × ${d.nombreCafe}Grande`);
    expect(comanda!.texto).toContain(`+ 1 × ${d.nombreAncla}`);
    expect(comanda!.texto).not.toContain("$");

    const enviado = page.locator(`[data-item-enviado="${d.nombreCafe}"]`);
    await expect(enviado.locator("[data-opciones-de-linea]")).toHaveText("Grande");
    await expect(enviado.locator(`[data-adicional-enviado="${d.nombreAncla}"]`)).toContainText("$ 600");
    await expect(enviado.locator(`[data-adicional-enviado="${d.nombreAncla}"]`).getByRole("button")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations, "envío con opciones").toEqual([]);

    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: /^Cerrar cuenta/ });
    await expect(cierre.locator("[data-total-cierre]")).toContainText("3.400");
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(page.getByText("La mesa está libre.")).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda", "ticket"]);
    const ticket = (await impresiones(page))[1]!.texto;
    expect(ticket).toContain(`1 × ${d.nombreCafe} grande`);
    // El adicional en su línea con su precio: se busca el texto tal cual (sin armar una expresión regular con el nombre, que habría que escapar entera).
    const adicionalEnTicket = ticket.indexOf(`+ 1 × ${d.nombreAncla}`);
    expect(adicionalEnTicket, "el adicional va en su propia línea").toBeGreaterThan(-1);
    expect(ticket.slice(adicionalEnTicket + `+ 1 × ${d.nombreAncla}`.length)).toMatch(/^\s*\$\s?600 c\/u/);
    expect(ticket).toMatch(/TOTAL\s*\$\s?3\.400/);
  } finally {
    await d.limpiar();
  }
});

test("«Quitar» un producto con adicionales pide confirmar y se los lleva; «Otro igual» abre el diálogo con la misma elección", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId, 7100 + Math.floor(Math.random() * 800));
  try {
    await pedirCafeGrandeConMedialuna(page, d);
    const linea = page.locator(`[data-item-sin-enviar="${d.nombreCafe}"]`);

    // «Otro igual»: el diálogo arranca con Grande y una medialuna, y suma una línea igual a «Por agregar».
    await linea.getByRole("button", { name: `Otro igual a ${d.nombreCafe}` }).click();
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    await expect(dialogo.getByRole("radio", { name: /Grande/ })).toBeChecked();
    await expect(dialogo.getByRole("button", { name: /^Agregar/ })).toHaveText("Agregar · $ 3.400");
    expect((await new AxeBuilder({ page }).analyze()).violations, "diálogo desde «Otro igual»").toEqual([]);
    await dialogo.getByRole("button", { name: /^Agregar/ }).click();
    await expect(page.locator(`[data-linea-por-agregar="${d.nombreCafe} · Grande"]`)).toContainText("+ Medialuna extra ×1");

    // «Quitar» con adicionales: primero avisa; «No» lo deja como estaba; «Sí, quitar» se lleva los dos.
    await linea.getByRole("button", { name: `Quitar ${d.nombreCafe}` }).click();
    const confirmar = linea.getByRole("group", { name: `Quitar ${d.nombreCafe} con sus adicionales` });
    await expect(confirmar).toContainText("Se quitan también sus adicionales.");
    await confirmar.getByRole("button", { name: "No" }).click();
    expect(await prismaAdmin.cuentaItem.count({ where: { cuentaId: d.cuenta.id } })).toBe(2);
    await linea.getByRole("button", { name: `Quitar ${d.nombreCafe}` }).click();
    await linea.getByRole("button", { name: "Sí, quitar" }).click();
    await expect(page.getByRole("heading", { name: "Sin enviar · 0" })).toBeVisible();
    expect(await prismaAdmin.cuentaItem.count({ where: { cuentaId: d.cuenta.id } })).toBe(0);
  } finally {
    await d.limpiar();
  }
});

test("«Anular» un producto ya enviado avisa que arrastra sus adicionales y los anula con él", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId, 7100 + Math.floor(Math.random() * 800));
  try {
    await interceptarImpresion(page);
    await pedirCafeGrandeConMedialuna(page, d);
    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();

    await page.getByRole("button", { name: `Anular ${d.nombreCafe}` }).click();
    const dialogo = page.getByRole("dialog", { name: `Anular «${d.nombreCafe}»` });
    await expect(dialogo).toContainText("Se anulan también sus adicionales, en la misma proporción.");
    await dialogo.getByLabel("Motivo (obligatorio)").fill("Se equivocó de mesa");
    await dialogo.getByRole("button", { name: "Anular" }).click();
    await expect(dialogo).toHaveCount(0);
    const adicional = page.locator(`[data-adicional-enviado="${d.nombreAncla}"]`);
    await expect(adicional).toContainText("Anulado");
    await expect(page.locator("[data-total-cuenta]")).toContainText(/\$\s?0/);
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda", "anulacion"]);
    expect((await impresiones(page))[1]!.texto).toContain("Grande");
  } finally {
    await d.limpiar();
  }
});

test("paso 9: «Lo más pedido acá» precarga lo que más se pidió en la sucursal, y en una promo el café con tamaño se ve «pedilo suelto»", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId, 7100 + Math.floor(Math.random() * 800));
  const titulo = `E2E Promo café ${d.m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: d.seccion.id, titulo, precio: 2000 } });
  await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: d.seccion.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 } });
  try {
    await pedirCafeGrandeConMedialuna(page, d);
    await page.reload();
    await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
    const region = page.getByRole("region", { name: d.seccion.nombre });

    // Lo más pedido: el Grande que se acaba de pedir (sin el adicional: no entra en la cuenta), y el botón lo precarga.
    await region.getByRole("button", { name: new RegExp(`^${d.nombreCafe}`) }).click();
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    const masPedido = dialogo.getByRole("group", { name: "Lo más pedido acá" });
    await expect(masPedido.getByRole("button")).toHaveText(["Grande"]);
    await masPedido.getByRole("button", { name: "Grande" }).click();
    await expect(dialogo.getByRole("radio", { name: /Grande/ })).toBeChecked();
    await expect(dialogo.getByRole("button", { name: /^Agregar/ })).toHaveText("Agregar · $ 2.800");
    expect((await new AxeBuilder({ page }).analyze()).violations, "diálogo con lo más pedido").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();

    // En la promo, el café (tamaño obligatorio) no se puede sumar.
    await region.getByRole("button", { name: titulo }).click();
    const armar = page.getByRole("dialog", { name: `Armar «${titulo}»` });
    const fila = armar.locator(`[data-producto-armar-promo="${d.cafeId}"]`);
    await expect(fila.locator("[data-no-se-arma]")).toHaveText("Con tamaño: pedilo suelto");
    await expect(fila.getByRole("button", { name: `Sumar ${d.nombreCafe} a ${d.seccion.nombre}` })).toBeDisabled();
    expect((await new AxeBuilder({ page }).include(`[data-armar-promo="${promo.id}"]`).analyze()).violations, "promo con el aviso").toEqual([]);
  } finally {
    await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
    await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
    await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
    await d.limpiar();
  }
});
