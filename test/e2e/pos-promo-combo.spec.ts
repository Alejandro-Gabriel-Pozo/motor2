import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { interceptarImpresion } from "./fixtures/impresion";

/**
 * Promos ARMABLES en la pantalla de la mesa (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): tocar la promo destacada
 * en la carta abre «Armar promo» (D1: mínimo/máximo por cupo, D5: elegibles = los mismos que ya ofrece esa sección), confirmarla
 * la agrega a «Por agregar» junto con los sueltos, y de ahí en más viaja SIEMPRE agrupada — «Sin enviar» (D4: se quita entera),
 * el envío a cocina (nunca a medias) y la anulación ya enviada (D4: todos sus componentes juntos, un solo motivo). El precio de
 * la promo se prorratea entre lo elegido, proporcional al precio de carta (D3): la suma de sus componentes es SIEMPRE el precio
 * de la promo, nunca la suma de los precios de carta.
 *
 * Siembra en «Central» dos secciones («E2E Promo Entradas», con Empanada y Tarta; «E2E Promo Bebidas», con Agua y Gaseosa) y una
 * promo «Combo E2E» de $4.000 que vive en Entradas, con un cupo obligatorio (1 de Entradas) y uno opcional (0 a 2 de Bebidas).
 * Cada caso limpia lo suyo en `finally`, en el orden que exigen las claves foráneas (RESTRICT): espejos → ítems → auditoría →
 * movimientos → operaciones → promo de la cuenta → cuentas → mesas → cupos → promo de carta → contenidos → secciones →
 * disponibilidad → productos.
 */

const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');
const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });

async function sembrarPromoCombo(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-PC-${clave}-${marca}`, nombre: `E2E ${nombre} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const empanada = await crear("EMPA", "Empanada", 2000);
  const tarta = await crear("TARTA", "Tarta", 3000);
  const agua = await crear("AGUA", "Agua", 1000);
  const gaseosa = await crear("GASEOSA", "Gaseosa", 1500);
  const productoIds = [empanada, tarta, agua, gaseosa].map((p) => p.id);

  const entradas = await prisma.seccionCarta.create({ data: { nombre: `E2E Promo Entradas ${marca}`, orden: 1 } });
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: `E2E Promo Bebidas ${marca}`, orden: 2 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { productoId: empanada.id, visibleEnCarta: true, seccionCartaId: entradas.id, orden: 1 },
      { productoId: tarta.id, visibleEnCarta: true, seccionCartaId: entradas.id, orden: 2 },
      { productoId: agua.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 1 },
      { productoId: gaseosa.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 2 },
    ],
  });
  const titulo = `E2E Combo ${marca}`;
  const promo = await prisma.promoCarta.create({ data: { sucursalId, seccionCartaId: entradas.id, titulo, precio: 4000 } });
  await prisma.promoCartaCupo.createMany({
    data: [
      { promoCartaId: promo.id, seccionCartaId: entradas.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
      { promoCartaId: promo.id, seccionCartaId: bebidas.id, cantidadMinima: 0, cantidadMaxima: 2, orden: 1 },
    ],
  });

  return {
    empanada,
    tarta,
    agua,
    gaseosa,
    entradas,
    bebidas,
    promo,
    titulo,
    limpiar: async (mesaIds: string[]) => {
      const items = await prisma.cuentaItem.findMany({ where: { cuenta: { mesaId: { in: mesaIds } } }, select: { operacionId: true } });
      const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
      const promoCuentaIds = (await prisma.promoCuenta.findMany({ where: { cuenta: { mesaId: { in: mesaIds } } }, select: { id: true } })).map((p) => p.id);
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } }, anulaAItemId: { not: null } } });
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      const cuentaIds = (await prisma.cuenta.findMany({ where: { mesaId: { in: mesaIds } }, select: { id: true } })).map((c) => c.id);
      await prisma.registroAuditoria.deleteMany({ where: { entidadId: { in: [...operacionIds, ...cuentaIds] } } });
      await prisma.movimientoStock.deleteMany({ where: { OR: [{ operacionId: { in: operacionIds } }, { productoId: { in: productoIds } }] } });
      await prisma.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      await prisma.promoCuenta.deleteMany({ where: { id: { in: promoCuentaIds } } });
      // Cerrar la cuenta (test D3/D4) emite una boleta: su ejemplar referencia la cuenta (RESTRICT) — se borra antes.
      await prisma.ejemplarBoleta.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [entradas.id, bebidas.id] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

/** Una mesa con la cuenta abierta por el admin de las pruebas — sin pasar por el modal de comensales. */
async function mesaConCuenta(sucursalId: string, numero: number) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return { mesa, cuenta };
}

/** Abre el diálogo "Armar promo" desde la sección donde vive (Entradas, en el fixture de este spec). */
async function abrirArmarPromo(page: Page, cat: Awaited<ReturnType<typeof sembrarPromoCombo>>) {
  await barra(page).getByRole("button", { name: cat.entradas.nombre }).click();
  await page.getByRole("region", { name: cat.entradas.nombre }).getByRole("button", { name: cat.titulo }).click();
  return page.getByRole("dialog", { name: `Armar «${cat.titulo}»` });
}

test("armar una promo respeta el mínimo obligatorio y el máximo COMPARTIDO del cupo (D1)", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPromoCombo(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 991);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const dialogo = await abrirArmarPromo(page, cat);

    const cupoEntradas = dialogo.getByRole("group", { name: `${cat.entradas.nombre} · 0/1 (mínimo 1)` });
    await expect(cupoEntradas).toBeVisible();
    const agregarPromo = dialogo.getByRole("button", { name: "Agregar promo" });
    await expect(agregarPromo).toBeDisabled();

    // Elegir la Empanada cumple el mínimo (1/1): "Agregar promo" se habilita y el máximo COMPARTIDO del cupo bloquea sumar la
    // Tarta también (D1: es un máximo del CUPO, no por producto).
    await dialogo.getByRole("button", { name: `Sumar ${cat.empanada.nombre} a ${cat.entradas.nombre}` }).click();
    await expect(dialogo.getByRole("group", { name: `${cat.entradas.nombre} · 1/1 (mínimo 1)` })).toBeVisible();
    await expect(agregarPromo).toBeEnabled();
    await expect(dialogo.getByRole("button", { name: `Sumar ${cat.tarta.nombre} a ${cat.entradas.nombre}` })).toBeDisabled();

    // Restar la Empanada vuelve a 0/1: el mínimo deja de cumplirse y "Agregar promo" se deshabilita de nuevo.
    await dialogo.getByRole("button", { name: `Restar ${cat.empanada.nombre} de ${cat.entradas.nombre}` }).click();
    await expect(agregarPromo).toBeDisabled();

    // El cupo de Bebidas es OPCIONAL (mínimo 0): sin tocar nada ahí, elegir solo la Empanada alcanza para confirmar.
    await expect(dialogo.getByRole("group", { name: `${cat.bebidas.nombre} · 0/2 (opcional)` })).toBeVisible();
    await dialogo.getByRole("button", { name: `Sumar ${cat.empanada.nombre} a ${cat.entradas.nombre}` }).click();
    await expect(agregarPromo).toBeEnabled();

    // Máximo 2 del cupo opcional: agua + gaseosa lo llenan y bloquean sumar una tercera unidad de cualquiera de las dos.
    await dialogo.getByRole("button", { name: `Sumar ${cat.agua.nombre} a ${cat.bebidas.nombre}` }).click();
    await dialogo.getByRole("button", { name: `Sumar ${cat.gaseosa.nombre} a ${cat.bebidas.nombre}` }).click();
    await expect(dialogo.getByRole("group", { name: `${cat.bebidas.nombre} · 2/2 (opcional)` })).toBeVisible();
    await expect(dialogo.getByRole("button", { name: `Sumar ${cat.agua.nombre} a ${cat.bebidas.nombre}` })).toBeDisabled();
    await expect(dialogo.getByRole("button", { name: `Sumar ${cat.gaseosa.nombre} a ${cat.bebidas.nombre}` })).toBeDisabled();

    // Escape cierra sin agregar nada.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-promo-por-agregar]")).toHaveCount(0);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("armar la promo con los dos cupos, agregarla, enviarla a cocina y cerrar la cuenta: los componentes van SIEMPRE agrupados y el precio se prorratea (D3/D4)", async ({
  paginaAutenticada: page,
  sucursalId,
}) => {
  const cat = await sembrarPromoCombo(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 992);
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    const dialogo = await abrirArmarPromo(page, cat);
    await dialogo.getByRole("button", { name: `Sumar ${cat.empanada.nombre} a ${cat.entradas.nombre}` }).click();
    await dialogo.getByRole("button", { name: `Sumar ${cat.agua.nombre} a ${cat.bebidas.nombre}` }).click();
    await dialogo.getByRole("button", { name: "Agregar promo" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // «Por agregar»: la promo entera por su precio ($4.000), como una única línea (no dos, una por componente).
    const linea = page.locator(`[data-promo-por-agregar="${cat.titulo}"]`);
    await expect(linea).toBeVisible();
    await expect(linea).toContainText(MONEDA.format(4000));
    await expect(page.getByRole("button", { name: "Agregar 1 al pedido", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(aviso(page)).toHaveText(`Se agregaron 2 ítems a la mesa 992. Incluye «${cat.titulo}».`);

    // «Sin enviar»: los dos componentes agrupados bajo el título de la promo, con un único «Quitar promo».
    const grupoSinEnviar = page.locator(`[data-promo-sin-enviar="${cat.titulo}"]`);
    await expect(grupoSinEnviar).toBeVisible();
    await expect(grupoSinEnviar.locator(`[data-item-sin-enviar="${cat.empanada.nombre}"]`)).toBeVisible();
    await expect(grupoSinEnviar.locator(`[data-item-sin-enviar="${cat.agua.nombre}"]`)).toBeVisible();
    await expect(grupoSinEnviar).toContainText(MONEDA.format(4000));

    // D3: el precio de carta de lo elegido (Empanada $2.000 + Agua $1.000 = $3.000) NUNCA es lo que se cobra — se prorratea a
    // que la suma dé EXACTO el precio de la promo ($4.000), proporcional al precio de carta de cada uno.
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    const componentes = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id }, orderBy: { precioCartaUnitario: "desc" } });
    expect(componentes).toHaveLength(2);
    const suma = componentes.reduce((s, c) => s + Number(c.cantidad) * Number(c.precioUnitario), 0);
    expect(suma).toBe(4000);
    expect(Number(componentes[0].precioUnitario)).toBeGreaterThan(Number(componentes[1].precioUnitario)); // la Empanada (carta $2.000) pesa más que el Agua (carta $1.000)
    expect(componentes.every((c) => Number(c.precioUnitario) >= 0.01)).toBe(true);

    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(aviso(page)).toHaveText(`Envío 1 a cocina: 2 ítems de la mesa 992.`);
    const grupoEnviado = page.locator(`[data-promo-enviada="${cat.titulo}"]`);
    await expect(grupoEnviado).toBeVisible();
    await expect(grupoEnviado.locator(`[data-item-enviado="${cat.empanada.nombre}"]`)).toBeVisible();
    await expect(grupoEnviado.locator(`[data-item-enviado="${cat.agua.nombre}"]`)).toBeVisible();
    await expect(grupoEnviado.getByRole("button", { name: `Anular promo ${cat.titulo}` })).toBeVisible();

    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 992" });
    await expect(cierre.locator("[data-total-cierre]")).toContainText(MONEDA.format(4000));
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(aviso(page)).toHaveText(new RegExp(`^Cuenta de la mesa 992 cerrada: se registró la venta por \\$\\s?4\\.000\\.$`));
    await expect(page.getByText("La mesa está libre.")).toBeVisible();

    // D4/paso 7: una Operacion VENTA por componente, TODAS con el mismo promoCuentaId — nunca una sola por la promo entera.
    const ventas = await prisma.operacion.findMany({ where: { promoCuentaId: promoCuenta.id, proceso: "VENTA" } });
    expect(ventas).toHaveLength(2);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("«Quitar promo» sin enviar la borra ENTERA de un solo golpe (D4)", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPromoCombo(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 993);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const dialogo = await abrirArmarPromo(page, cat);
    await dialogo.getByRole("button", { name: `Sumar ${cat.empanada.nombre} a ${cat.entradas.nombre}` }).click();
    await dialogo.getByRole("button", { name: "Agregar promo" }).click();
    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(aviso(page)).toHaveText(`Se agregó 1 ítem a la mesa 993. Incluye «${cat.titulo}».`);
    await expect(page.locator(`[data-promo-sin-enviar="${cat.titulo}"]`)).toBeVisible();

    await page.getByRole("button", { name: `Quitar promo ${cat.titulo}` }).click();
    await expect(aviso(page)).toHaveText(`Se quitó «${cat.titulo}» de la mesa 993.`);
    await expect(page.locator("[data-promo-sin-enviar]")).toHaveCount(0);
    expect(await prisma.cuentaItem.count({ where: { cuentaId: cuenta.id } })).toBe(0);
    expect(await prisma.promoCuenta.count({ where: { cuentaId: cuenta.id } })).toBe(0);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("«Anular promo» ya enviada anula TODOS sus componentes juntos con un solo motivo (D4)", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPromoCombo(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 994);
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    const dialogo = await abrirArmarPromo(page, cat);
    await dialogo.getByRole("button", { name: `Sumar ${cat.empanada.nombre} a ${cat.entradas.nombre}` }).click();
    await dialogo.getByRole("button", { name: `Sumar ${cat.agua.nombre} a ${cat.bebidas.nombre}` }).click();
    await dialogo.getByRole("button", { name: "Agregar promo" }).click();
    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.locator(`[data-promo-enviada="${cat.titulo}"]`)).toBeVisible();

    await page.getByRole("button", { name: `Anular promo ${cat.titulo}` }).click();
    const anular = page.getByRole("dialog", { name: `Anular promo «${cat.titulo}»` });
    await anular.getByRole("button", { name: "Anular promo", exact: true }).click();
    await expect(anular.getByRole("alert")).toHaveText("Escribí el motivo de la anulación.");
    await anular.getByLabel("Motivo (obligatorio)").fill("Se equivocó de mesa");
    await anular.getByRole("button", { name: "Anular promo", exact: true }).click();
    await expect(anular).toHaveCount(0);
    await expect(aviso(page)).toHaveText(`Se anuló la promo «${cat.titulo}» de la mesa 994 (2 componentes).`);

    // Los dos componentes quedan tachados, «Anulado», y sin botón de anular (nada le queda vigente a esa promo).
    const grupo = page.locator(`[data-promo-enviada="${cat.titulo}"]`);
    await expect(grupo).toContainText("Anulado");
    await expect(grupo.getByRole("button", { name: `Anular promo ${cat.titulo}` })).toHaveCount(0);

    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    const espejos = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id, anulaAItemId: { not: null } } });
    expect(espejos).toHaveLength(2);
    expect(espejos.every((e) => e.motivoAnulacion === "Se equivocó de mesa")).toBe(true);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("accesibilidad: con el diálogo «Armar promo» abierto, sin violaciones", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPromoCombo(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 995);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await abrirArmarPromo(page, cat);
    expect((await new AxeBuilder({ page }).analyze()).violations, "mesa con «Armar promo» abierto").toEqual([]);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});
