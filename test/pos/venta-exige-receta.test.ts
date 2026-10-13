import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { elegida, sembrarCafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { volverALaRecetaCentralCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/volver-a-la-receta-central";

/**
 * SIN RECETA NO SE VENDE (ADR-033, decisión del dueño del 2026-10-13), contra Postgres real: un PV se vende solo con receta vigente EN LA SUCURSAL (la propia si la tiene habilitada, si no
 * la central) o con stock propio (`seProduce`); el ancla de un adicional queda exceptuada. Tres lugares: al AGREGAR a la cuenta (el error temprano para el mozo, también en los componentes de
 * una promo), al CERRAR la cuenta y en la venta de MOSTRADOR (la barrera final de `armarLinea`, con la misma receta que ya lee la venta). Fija los textos, el código `PRODUCTO_SIN_RECETA`,
 * que un rechazo no deja nada escrito (ni filas ni el comprobante de la clave), la receta que se desactiva entre el pedido y el cobro, y la carrera entre «volver a la receta central» y el
 * cierre: o vende con la receta que leyó (con su consumo) o rechaza, nunca una venta sin consumo ni una cuenta a medias.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
/** La base del actor con el alcance que le da la producción: su sucursal activa, para lectura y escritura (ADR-028). */
const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre, email: "admin@test.com", ahora: new Date(), ...baseDe(s.sucursalId) });
const sinReceta = (nombre: string) => `«${nombre}» no tiene receta: armala en Catálogo → Recetas para poder venderla.`;
const CLAVE = "44444444-4444-4444-8444-444444444444";

/** Un PV disponible en «Central», SIN receta. */
const sembrarSoda = () => sembrarProductoDisponible({ codigo: "PV_SODA", nombre: "Soda", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 800 }, s.sucursalId);

/** Un PV con SOLO una receta PROPIA de `sucursalId` (habilitada), de 1 unidad de su MP; la MP queda disponible en «Central» con 100 en «Salón». */
async function sembrarTartaDeLaCasa(sucursalId: string) {
  const tarta = await sembrarProductoDisponible({ codigo: "PV_TARTA_CASA", nombre: "Tarta de la casa", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 5000 }, s.sucursalId);
  const masa = await sembrarProductoDisponible({ codigo: "MP_MASA", nombre: "Masa", tipo: "MP", unidadStockId: s.unidad.id }, s.sucursalId);
  const compra = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "COMPRA", fecha: new Date("2000-01-01T12:00:00Z"), usuarioId: s.admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: masa.id, seccionId: s.seccion.id, proceso: "COMPRA", cantidad: 100, detalle: "Stock", precioTotal: 0, precioPorUnidadStock: 0 } });
  await prisma.recetaVersion.create({ data: { productoId: tarta.id, version: 1, sucursalId, ingredientes: { create: [{ insumoProductoId: masa.id, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }] } } });
  await prisma.recetaSucursal.create({ data: { sucursalId, productoId: tarta.id, habilitada: true } });
  return { tarta, masa };
}

/** Una cuenta de la mesa 4 con el ítem ya enviado a cocina (sembrado directo: lo que se prueba es el cobro). */
const cuentaEnviadaCon = async (productoId: string, cantidad = 1) => (await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId, cantidad, precioUnitario: 5000, numeroEnvio: 1 }])).id;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("agregar a la cuenta: el error temprano para el mozo", () => {
  it("un PV sin receta: PRODUCTO_SIN_RECETA con el mensaje que nombra el producto, y el pedido entero no escribe nada", async () => {
    const soda = await sembrarSoda();
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const r = await agregarItemsCasoDeUso(actor(), { cuentaId, items: [{ productoId: s.milanesa.id, cantidad: 1 }, { productoId: soda.id, cantidad: 2 }], promos: [] });
    expect(r).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: sinReceta("Soda") });
    // La Server Action (lo que ve la pantalla): el mismo texto, sin el código.
    expect(await agregarItems(cuentaId, [{ productoId: soda.id, cantidad: 1 }])).toEqual({ ok: false, mensaje: sinReceta("Soda") });
    expect(await prisma.cuentaItem.count()).toBe(0);
  });

  it("con su receta armada (aunque sea de un solo ingrediente: una reventa), se agrega", async () => {
    const soda = await sembrarSoda();
    await darRecetaDeReventa(prisma, soda, { sucursalIds: [s.sucursalId] });
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect(await agregarItems(cuentaId, [{ productoId: soda.id, cantidad: 2 }])).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
  });

  it("idempotencia: el agregado rechazado no consume la clave ni deja filas; el reintento rechaza igual; con la receta armada, la MISMA clave agrega una sola vez", async () => {
    const soda = await sembrarSoda();
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const pedir = () => agregarItems(cuentaId, [{ productoId: soda.id, cantidad: 1 }], [], CLAVE);
    for (let i = 0; i < 2; i++) expect(await pedir()).toEqual({ ok: false, mensaje: sinReceta("Soda") });
    expect(await prisma.cuentaItem.count()).toBe(0);
    expect(await prisma.agregadoDeCuenta.count()).toBe(0);

    await darRecetaDeReventa(prisma, soda, { sucursalIds: [s.sucursalId] });
    expect(await pedir()).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(await pedir()).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(await prisma.cuentaItem.count()).toBe(1);
    expect(await prisma.agregadoDeCuenta.count()).toBe(1);
  });

  it("una promo con un componente sin receta se rechaza entera (PRODUCTO_SIN_RECETA con el título de la promo), sin PromoCuenta ni ítems", async () => {
    const soda = await sembrarSoda();
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: soda.id, visibleEnCarta: true, seccionCartaId: bebidas.id } });
    const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: platos.id, titulo: "Menú del día", precio: 9000 } });
    await prisma.promoCartaCupo.createMany({
      data: [
        { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
        { promoCartaId: promo.id, seccionCartaId: bebidas.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
      ],
    });
    const menu = [
      {
        promoCartaId: promo.id,
        elecciones: [
          { seccionCartaId: platos.id, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] },
          { seccionCartaId: bebidas.id, elegidos: [{ productoId: soda.id, cantidad: 1 }] },
        ],
      },
    ];
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const r = await agregarItemsCasoDeUso(actor(), { cuentaId, items: [{ productoId: s.flan.id, cantidad: 1 }], promos: menu });
    expect(r).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: `«Menú del día»: ${sinReceta("Soda")}` });
    expect(await prisma.promoCuenta.count()).toBe(0);
    expect(await prisma.cuentaItem.count()).toBe(0);

    // Control: con la receta de la Soda, la misma promo entra.
    await darRecetaDeReventa(prisma, soda, { sucursalIds: [s.sucursalId] });
    expect((await agregarItemsCasoDeUso(actor(), { cuentaId, items: [], promos: menu })).ok).toBe(true);
  });

  it("aislamiento por sucursal: una receta PROPIA de OTRA sucursal no habilita la venta acá", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const { tarta } = await sembrarTartaDeLaCasa(norte.id);
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect(await agregarItemsCasoDeUso(actor(), { cuentaId, items: [{ productoId: tarta.id, cantidad: 1 }], promos: [] })).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: sinReceta("Tarta de la casa") });
  });

  it("un PV que se produce tiene stock propio: se agrega y se cobra sin receta (sin CONSUMO)", async () => {
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN_CASERO", nombre: "Pan casero", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 1500, seProduce: true }, s.sucursalId);
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect((await agregarItems(cuentaId, [{ productoId: pan.id, cantidad: 2 }])).ok).toBe(true);
    const ids = (await prisma.cuentaItem.findMany({ where: { cuentaId }, select: { id: true } })).map((i) => i.id);
    expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);
    const r = await cerrarCuenta(cuentaId);
    expect(r.ok, r.mensaje).toBe(true);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" }, include: { movimientos: true } });
    expect(venta.movimientos.map((m) => [m.proceso, m.productoId])).toEqual([["VENTA", pan.id]]);
  });
});

describe("cobrar: la barrera final (armarLinea, con la receta que ya lee la venta)", () => {
  it("la receta PROPIA de la sucursal se usa al cobrar; si la sucursal vuelve a la central (que no existe) entre el pedido y el cobro, el cierre se rechaza y la cuenta queda abierta", async () => {
    const { tarta } = await sembrarTartaDeLaCasa(s.sucursalId);
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect((await agregarItems(cuentaId, [{ productoId: tarta.id, cantidad: 1 }])).ok).toBe(true);
    const ids = (await prisma.cuentaItem.findMany({ where: { cuentaId }, select: { id: true } })).map((i) => i.id);
    expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);

    expect((await volverALaRecetaCentralCasoDeUso(actor(), { productoId: tarta.id })).ok).toBe(true);
    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId });
    expect(r).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: sinReceta("Tarta de la casa") });
    // Nada a medias: sin venta, sin ticket, la cuenta abierta y sus ítems sin Operacion.
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
    expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);
    expect(await prisma.ejemplarTicket.count()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } })).cerradaEn).toBeNull();
    expect((await prisma.cuentaItem.findMany({ where: { cuentaId } })).every((i) => i.operacionId === null)).toBe(true);

    // Con la receta propia otra vez habilitada, la misma cuenta se cobra y consume su masa.
    await prisma.recetaSucursal.updateMany({ where: { productoId: tarta.id }, data: { habilitada: true } });
    const cobrada = await cerrarCuentaCasoDeUso(actor(), { cuentaId });
    expect(cobrada.ok, cobrada.mensaje).toBe(true);
    expect(await prisma.movimientoStock.count({ where: { proceso: "CONSUMO" } })).toBe(1);
  });

  it("una cuenta con un PV que ya no tiene receta (sembrada sin pasar por agregar): PRODUCTO_SIN_RECETA y nada escrito", async () => {
    const soda = await sembrarSoda();
    const cuentaId = await cuentaEnviadaCon(soda.id);
    expect(await cerrarCuenta(cuentaId)).toEqual({ ok: false, mensaje: sinReceta("Soda") });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
    expect(await prisma.ejemplarTicket.count()).toBe(0);
  });

  it("mostrador: registrarVenta con un PV sin receta → PRODUCTO_SIN_RECETA, sin ninguna Operación (tampoco la línea con receta del mismo lote)", async () => {
    const soda = await sembrarSoda();
    const r = await registrarVentaCasoDeUso(actor(), { fecha: new Date(), seccionId: s.seccion.id, ventas: [{ productoId: s.milanesa.id, cantidadVendida: 1 }, { productoId: soda.id, cantidadVendida: 1 }] });
    expect(r).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: sinReceta("Soda") });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
  });

  it("el ancla de un ADICIONAL no tiene receta y se cobra igual: su consumo es el de su opción", async () => {
    const c = await sembrarCafeDelSalon(s);
    expect(await prisma.recetaVersion.count({ where: { productoId: c.anclaDelShotId } })).toBe(0);
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect((await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId), elegida(c, c.shotId)] }])).ok).toBe(true);
    const ids = (await prisma.cuentaItem.findMany({ where: { cuentaId }, select: { id: true } })).map((i) => i.id);
    expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);
    const r = await cerrarCuenta(cuentaId);
    expect(r.ok, r.mensaje).toBe(true);
    const delShot = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", operacionPadreId: { not: null } }, include: { movimientos: true } });
    expect(delShot.movimientos.map((m) => [m.proceso, m.productoId]).sort()).toEqual([
      ["CONSUMO", c.granoId],
      ["VENTA", c.anclaDelShotId],
    ]);
  });
});

describe("concurrencia: volver a la receta central MIENTRAS se cobra la cuenta", () => {
  it("o vende con la receta que leyó (con su CONSUMO) o rechaza sin escribir: nunca una venta sin consumo ni una cuenta cerrada sin venta (varias vueltas, Postgres real)", async () => {
    const { tarta, masa } = await sembrarTartaDeLaCasa(s.sucursalId);
    const desenlaces = new Set<string>();
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      await prisma.recetaSucursal.updateMany({ where: { productoId: tarta.id }, data: { habilitada: true } });
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 100 + vuelta } });
      const cuentaId = (await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: tarta.id, cantidad: 1, precioUnitario: 5000, numeroEnvio: 1 }])).id;

      const [cierre, vuelve] = await Promise.all([cerrarCuentaCasoDeUso(actor(), { cuentaId }), volverALaRecetaCentralCasoDeUso(actor(), { productoId: tarta.id })]);
      expect(vuelve.ok, vuelve.mensaje).toBe(true);
      const cuenta = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } });
      const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA", detalleLibre: `Mesa ${100 + vuelta}` }, include: { movimientos: true } });
      if (cierre.ok) {
        desenlaces.add("vendio");
        // Vendió con la receta propia que leyó: UNA venta con su VENTA y el CONSUMO de la masa, la cuenta cerrada y su ticket.
        expect(ventas).toHaveLength(1);
        expect(ventas[0]!.movimientos.map((m) => [m.proceso, m.productoId]).sort()).toEqual([
          ["CONSUMO", masa.id],
          ["VENTA", tarta.id],
        ]);
        expect(cuenta.cerradaEn).not.toBeNull();
        expect(await prisma.ejemplarTicket.count({ where: { cuentaId } })).toBe(1);
      } else {
        desenlaces.add("rechazo");
        expect(cierre).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: sinReceta("Tarta de la casa") });
        expect(ventas).toEqual([]);
        expect(cuenta.cerradaEn).toBeNull();
        expect(await prisma.ejemplarTicket.count({ where: { cuentaId } })).toBe(0);
      }
    }
    // Ningún VENTA de la tarta quedó sin su CONSUMO, en ninguna vuelta.
    const ventasDeLaTarta = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA", productoId: tarta.id }, select: { operacionId: true } });
    for (const v of ventasDeLaTarta) expect(await prisma.movimientoStock.count({ where: { operacionId: v.operacionId, proceso: "CONSUMO" } })).toBe(1);
    expect(desenlaces.size).toBeGreaterThan(0);
  });
});
