import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { interceptarImpresion, impresiones } from "./fixtures/impresion";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";
import { formatearNumeroTicket } from "../../src/core/pos/numeracion-ticket";

/**
 * El mostrador como puesto del salón (ADR-039, M1.5): lo mismo que una mesa, con su propia entrada. Dos casos de punta a punta:
 *  1. habilitar el puesto (el administrador, con el botón), abrir la cuenta SIN comensales, pedir, asignar un cliente con %, enviar a cocina, cerrar (venta con detalle «Mostrador», ticket numerado
 *     comparado contra la base), descartar una cuenta vacía y comprobar que el límite de mesas abiertas no cuenta el mostrador;
 *  2. un café CON OPCIONES (tamaño y adicional) y una PROMO armable en una cuenta del mostrador, enviadas y cerradas.
 *
 * Limpieza en `finally`, en el orden de `pos-tomar-pedido.spec.ts` (espejos → hijos → ítems → auditoría → movimientos → operaciones → promo de la cuenta → ejemplares → comprobantes → cuentas) y, al final, el
 * puesto mostrador de la sucursal (habilitarlo es parte de lo que prueba el spec: se borra para que los demás specs encuentren el mapa como siempre). Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`).
 */

const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const SECCION = "Depósito E2E";
const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');
const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });

/** Borra el puesto mostrador de la sucursal con todo lo que colgó de sus cuentas (y las fichas de auditoría de habilitarlo). */
async function limpiarPuesto(sucursalId: string, productoIds: string[] = []) {
  const puestos = await prismaAdmin.mesa.findMany({ where: { sucursalId, tipo: "MOSTRADOR" }, select: { id: true } });
  const mesaIds = puestos.map((p) => p.id);
  const cuentas = await prismaAdmin.cuenta.findMany({ where: { mesaId: { in: mesaIds } }, select: { id: true } });
  const cuentaIds = cuentas.map((c) => c.id);
  const items = await prismaAdmin.cuentaItem.findMany({ where: { cuentaId: { in: cuentaIds } }, select: { operacionId: true } });
  const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
  const promoCuentaIds = (await prismaAdmin.promoCuenta.findMany({ where: { cuentaId: { in: cuentaIds } }, select: { id: true } })).map((p) => p.id);
  await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: { in: cuentaIds } } } });
  await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds }, anulaAItemId: { not: null } } });
  await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds }, lineaPadreId: { not: null } } });
  await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: [...operacionIds, ...cuentaIds, ...mesaIds] } } });
  await prismaAdmin.movimientoStock.deleteMany({ where: { OR: [{ operacionId: { in: operacionIds } }, ...(productoIds.length ? [{ productoId: { in: productoIds } }] : [])] } });
  await prismaAdmin.operacion.deleteMany({ where: { id: { in: operacionIds }, operacionPadreId: { not: null } } });
  await prismaAdmin.operacion.deleteMany({ where: { id: { in: operacionIds } } });
  await prismaAdmin.promoCuenta.deleteMany({ where: { id: { in: promoCuentaIds } } });
  await prismaAdmin.ejemplarTicket.deleteMany({ where: { cuentaId: { in: cuentaIds }, corrigeAId: { not: null } } });
  await prismaAdmin.ejemplarTicket.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prismaAdmin.cuenta.deleteMany({ where: { id: { in: cuentaIds } } });
  await prismaAdmin.mesa.deleteMany({ where: { id: { in: mesaIds } } });
}

async function sembrarCatalogoSimple(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: SECCION } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const reventa = { sucursalIds: [sucursalId], stock: { cantidad: 1000, seccionIds: [seccion.id], usuarioId: admin.id } };
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-MO-${clave}-${marca}`, nombre: `E2E ${nombre} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return { producto: p, mpId: (await darRecetaDeReventa(prisma, p, reventa)).id };
  };
  const milanesa = await crear("MILA", "Milanesa", 9000);
  const flan = await crear("FLAN", "Flan", 3000);
  const cliente = await prisma.cliente.create({ data: { nombre: `E2E Cliente mostrador ${marca}`, descuentoPorcentaje: 10 } });
  return {
    milanesa: milanesa.producto,
    flan: flan.producto,
    cliente,
    limpiar: async () => {
      const productoIds = [milanesa.producto.id, flan.producto.id];
      await limpiarPuesto(sucursalId, productoIds);
      await prisma.cliente.deleteMany({ where: { id: cliente.id } });
      await borrarRecetasDeReventa(prisma, { pvIds: productoIds, mpIds: [milanesa.mpId, flan.mpId] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

/** Un producto por vez (ver `pos-tomar-pedido.spec.ts`): lo busca, lo elige, corrige la cantidad si no es 1 y confirma. */
async function agregar(page: Page, nombre: string, cantidad: string) {
  await page.getByRole("combobox", { name: "Producto" }).fill(nombre);
  await page.getByRole("option", { name: new RegExp(nombre) }).click();
  if (cantidad !== "1") await page.getByLabel(`Cantidad de ${nombre}`, { exact: true }).fill(cantidad);
  await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
}

/** El administrador habilita el puesto desde el mapa: tarjeta «Mostrador» → pantalla sin habilitar → botón. Deja la pantalla del mostrador sin cuenta abierta. */
async function habilitarDesdeElMapa(page: Page) {
  await page.goto("/mesas");
  const tarjeta = page.locator('[data-mostrador="sin-habilitar"]');
  await expect(tarjeta).toContainText("Todavía no está habilitado");
  await tarjeta.click();
  await page.waitForURL("/mesas/mostrador");
  await expect(page.getByText("Habilitá el mostrador de esta sucursal.")).toBeVisible();
  await page.getByRole("button", { name: "Habilitar el mostrador" }).click();
  await expect(page.getByText("No hay una cuenta abierta en el mostrador.")).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("Mostrador");
}

test("el mostrador: habilitar, abrir sin comensales, pedir, cliente con %, enviar y cerrar con ticket numerado; descartar una cuenta vacía; no cuenta para el límite de mesas", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogoSimple(sucursalId);
  const limiteAntes = (await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } })).maxMesasAbiertas;
  await limpiarPuesto(sucursalId); // un resto de una corrida anterior que murió
  try {
    await interceptarImpresion(page);
    await habilitarDesdeElMapa(page);

    // Abrir la cuenta: sin pedir comensales (no hay diálogo) y sin mostrarlos.
    await page.getByRole("button", { name: "Nueva cuenta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta del mostrador abierta.");
    await expect(page.getByText(/comensal/i)).toHaveCount(0);
    await expect(page.getByText("Sin cuenta abierta")).toHaveCount(0);

    await agregar(page, cat.milanesa.nombre, "2");
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem al mostrador.");
    await agregar(page, cat.flan.nombre, "1");
    await expect(page.locator("[data-total-cuenta]")).toContainText(/21\.000/);

    // Cliente con %: el mismo control de la mesa.
    await page.getByRole("button", { name: "Asignar cliente" }).click();
    await page.getByLabel("Cliente", { exact: true }).selectOption({ label: `${cat.cliente.nombre} (−10%)` });
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(aviso(page)).toHaveText(`«${cat.cliente.nombre}» asignado al mostrador, con 10% de descuento.`);

    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(aviso(page)).toHaveText("Envío 1 a cocina: 2 ítems del mostrador.");

    // El límite de mesas abiertas no cuenta el mostrador: con límite 1 y la cuenta del mostrador abierta, el mapa dice 0 de 1.
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { maxMesasAbiertas: 1 } });
    await page.goto("/mesas");
    await expect(page.locator('[data-mostrador="habilitado"]')).toContainText("1 cuenta abierta");
    await expect(page.getByText("Máx. 1 mesas abiertas (0/1)")).toBeVisible();
    await page.goto("/mesas/mostrador");

    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mostrador" });
    await expect(cierre).toContainText("Se registra la venta y la cuenta queda cerrada.");
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(aviso(page)).toHaveText(/^Cuenta del mostrador cerrada: se registró la venta por \$\s?18\.900 \(con 10% de descuento a «.+»\)\.$/);
    await expect(page.getByText("No hay una cuenta abierta en el mostrador.")).toBeVisible();

    // El ticket sale solo, con el rótulo del mostrador y el número que quedó en la base.
    const ejemplar = await prisma.ejemplarTicket.findFirstOrThrow({ where: { cuenta: { mesa: { sucursalId, tipo: "MOSTRADOR" } } } });
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda", "ticket"]);
    const ticket = (await impresiones(page))[1]!.texto;
    expect(ticket).toContain("Mostrador");
    expect(ticket).not.toContain("Mesa 0");
    await expect(page.getByText(`N.º ${formatearNumeroTicket({ numero: ejemplar.numero, ejemplar: ejemplar.ejemplar })} ·`)).toBeVisible();

    const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA", detalleLibre: "Mostrador", sucursalId } });
    expect(ventas).toHaveLength(2);
    expect(ventas.every((v) => v.clienteId === cat.cliente.id)).toBe(true);

    // Descartar una cuenta vacía: se cierra sin venta ni ticket.
    await page.getByRole("button", { name: "Nueva cuenta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta del mostrador abierta.");
    await page.getByRole("button", { name: "Descartar cuenta (sin consumo)" }).click();
    await expect(aviso(page)).toHaveText("Cuenta del mostrador descartada.");
    await expect(page.getByText("No hay una cuenta abierta en el mostrador.")).toBeVisible();
    expect(await prisma.ejemplarTicket.count({ where: { cuenta: { mesa: { sucursalId, tipo: "MOSTRADOR" } } } })).toBe(1);

    // La ruta de una mesa con el id del puesto no lo abre como mesa: dice que es el mostrador y lleva a su pantalla.
    const puesto = await prisma.mesa.findFirstOrThrow({ where: { sucursalId, tipo: "MOSTRADOR" } });
    await page.goto(`/mesas/${puesto.id}`);
    await expect(page.getByText("Ese es el mostrador, que tiene su propia pantalla.")).toBeVisible();
    await page.getByRole("link", { name: "Ir al mostrador" }).click();
    await page.waitForURL("/mesas/mostrador");
  } finally {
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { maxMesasAbiertas: limiteAntes } });
    await cat.limpiar();
  }
});

test("el mostrador vende lo mismo que el salón: un café con opciones y una promo armable, enviados y cerrados con su ticket", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const seccionStock = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: SECCION } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });

  // Café con opciones (tamaño y un adicional), como en pos-mesa-opciones.
  const molido = await prisma.producto.create({ data: { codigo: `E2E-MO-MOLIDO-${m}`, nombre: `E2E Molido mostrador ${m}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: molido.id, disponible: true } });
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño mostrador ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Mediano", factorEscala: 1 }, { nombre: "Grande", monto: 300, factorEscala: 1.5 }] });
  const extras = await sembrarGrupo({ nombre: `E2E Extras mostrador ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Medialuna extra", monto: 600, conAncla: true }] });
  const nombreCafe = `E2E Café mostrador ${m}`;
  const { productoId: cafeId } = await sembrarProductoConOpciones({ nombre: nombreCafe, codigo: `E2E-MO-CAFE-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: tamano }, { grupo: extras }] });
  const anclaId = extras.opciones["Medialuna extra"]!.anclaId!;
  for (const productoId of [cafeId, anclaId]) await prisma.recetaVersion.create({ data: { productoId, version: 1, ingredientes: { create: [{ insumoProductoId: molido.id, cantidad: 0.01, unidadId: kg.id }] } } });
  const ancla = await prisma.producto.findUniqueOrThrow({ where: { id: anclaId } });
  const seccionCafe = await prisma.seccionCarta.create({ data: { nombre: `E2E Cafetería mostrador ${m}`, orden: 1 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: cafeId, visibleEnCarta: true, seccionCartaId: seccionCafe.id, orden: 1 } });

  // Promo armable (un cupo obligatorio de Entradas), como en pos-promo-combo.
  const reventas: { pv: string; mp: string }[] = [];
  const reventa = { sucursalIds: [sucursalId], stock: { cantidad: 1000, seccionIds: [seccionStock.id], usuarioId: admin.id } };
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-MO-${clave}-${m}`, nombre: `E2E ${nombre} ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    reventas.push({ pv: p.id, mp: (await darRecetaDeReventa(prisma, p, reventa)).id });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const empanada = await crear("EMPA", "Empanada", 2000);
  const productoIds = [empanada.id];
  const entradas = await prisma.seccionCarta.create({ data: { nombre: `E2E Entradas mostrador ${m}`, orden: 2 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: empanada.id, visibleEnCarta: true, seccionCartaId: entradas.id, orden: 1 } });
  const tituloPromo = `E2E Combo mostrador ${m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: entradas.id, titulo: tituloPromo, precio: 4000 } });
  await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: entradas.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 } });

  await limpiarPuesto(sucursalId);
  try {
    await interceptarImpresion(page);
    await habilitarDesdeElMapa(page);
    await page.getByRole("button", { name: "Nueva cuenta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta del mostrador abierta.");

    // El café Grande con una Medialuna extra, desde el selector de la carta y «Elegir opciones».
    await barra(page).getByRole("button", { name: seccionCafe.nombre }).click();
    await page.getByRole("region", { name: seccionCafe.nombre }).getByRole("button", { name: new RegExp(`^${nombreCafe}`) }).click();
    const dialogo = page.getByRole("dialog", { name: nombreCafe });
    await dialogo.getByRole("radio", { name: /Grande/ }).check();
    await dialogo.getByRole("button", { name: "Sumar uno de Medialuna extra" }).click();
    await dialogo.getByRole("button", { name: /^Agregar/ }).click();
    await expect(dialogo).toBeHidden();
    await page.getByRole("button", { name: "Agregar 1 al pedido" }).click();
    await expect(aviso(page)).toContainText("Se agregó");
    const linea = page.locator(`[data-item-sin-enviar="${nombreCafe}"]`);
    await expect(linea.locator("[data-opciones-de-linea]")).toHaveText("Grande");
    await expect(linea.locator(`[data-adicional-sin-enviar="${ancla.nombre}"]`)).toContainText("$ 600");

    // La promo armada: un componente del cupo, agregada por su precio.
    await barra(page).getByRole("button", { name: entradas.nombre }).click();
    await page.getByRole("region", { name: entradas.nombre }).getByRole("button", { name: tituloPromo }).click();
    const armar = page.getByRole("dialog", { name: `Armar «${tituloPromo}»` });
    await armar.getByRole("button", { name: `Sumar ${empanada.nombre} a ${entradas.nombre}` }).click();
    await armar.getByRole("button", { name: "Agregar promo" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(`[data-promo-por-agregar="${tituloPromo}"]`)).toContainText(MONEDA.format(4000));
    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(aviso(page)).toContainText(`Incluye «${tituloPromo}».`);

    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();

    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mostrador" });
    await expect(cierre.locator("[data-total-cierre]")).toContainText("7.400");
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(aviso(page)).toContainText("Cuenta del mostrador cerrada: se registró la venta por");
    await expect(page.getByText("No hay una cuenta abierta en el mostrador.")).toBeVisible();

    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda", "ticket"]);
    const ticket = (await impresiones(page))[1]!.texto;
    expect(ticket).toContain(`1 × ${nombreCafe}Grande`);
    expect(ticket).toMatch(/TOTAL\s*\$\s?7\.400/);
    const ejemplar = await prisma.ejemplarTicket.findFirstOrThrow({ where: { cuenta: { mesa: { sucursalId, tipo: "MOSTRADOR" } } } });
    expect(ejemplar.ejemplar).toBe(1);
    expect(await prisma.promoCuenta.count({ where: { cuenta: { mesa: { sucursalId, tipo: "MOSTRADOR" } } } })).toBe(1);
  } finally {
    await limpiarPuesto(sucursalId, [...productoIds, cafeId, anclaId, molido.id]);
    await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
    await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { id: promo.id } } });
    await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: { in: [seccionCafe.id, entradas.id] } } });
    await prisma.seccionCarta.deleteMany({ where: { id: { in: [seccionCafe.id, entradas.id] } } });
    await borrarRecetasDeReventa(prisma, { pvIds: reventas.map((r) => r.pv), mpIds: reventas.map((r) => r.mp) });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
  }
});
