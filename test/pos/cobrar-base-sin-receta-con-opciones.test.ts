import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { sembrarGaseosaPorOpcion, sembrarLineaDeGaseosa, type GaseosaPorOpcion } from "./gaseosa-fixture";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";

/**
 * Ventas con opciones, paso 1 (diseño 2026-10-29; decisión del dueño): al COBRAR, una línea con opciones elegidas dentro del precio sobre una base SIN receta se vende si lo elegido descuenta
 * al menos un insumo, y descuenta exactamente eso (la barrera final de `registrar-venta-en-tx.ts`). Si lo elegido no descuenta nada, se rechaza con `PRODUCTO_SIN_RECETA` y un mensaje que nombra
 * la opción, sin escribir nada (ni operación, ni Kardex, ni ticket) y con la cuenta abierta. Las líneas se siembran SIN pasar por agregar ítems (el aviso temprano es el paso 2).
 * Cubre además C2 (versión nueva de la opción entre pedir y cobrar), C3 (dos cuentas a la vez), C4 (dos cierres de la misma cuenta) e I2 (atomicidad del cierre).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let g: GaseosaPorOpcion;
const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre, email: "admin@test.com", empresaZonaHoraria: ZONA_ARGENTINA, ahora: new Date(), ...baseDe(s.sucursalId) });
const MENSAJE_FANTA = "“Gaseosa 500 cc” con “Fanta” no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “Gaseosa 500 cc” en Catálogo → Recetas.";

const cuentaNueva = async (numeroDeMesa?: number) => {
  const mesa = numeroDeMesa === undefined ? s.mesa : await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: numeroDeMesa } });
  return (await sembrarCuenta(mesa.id, s.admin.id)).id;
};
const nadaEscrito = async (cuentaId: string) => {
  expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
  expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);
  expect(await prisma.ejemplarTicket.count()).toBe(0);
  expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } })).cerradaEn).toBeNull();
  expect((await prisma.cuentaItem.findMany({ where: { cuentaId } })).every((i) => i.operacionId === null)).toBe(true);
};
const movimientosDe = async () => (await prisma.movimientoStock.findMany({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).map((m) => [m.proceso, m.productoId, Number(m.cantidad)] as const);

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  g = await sembrarGaseosaPorOpcion(s);
  await entrarComo(s.admin);
});

describe("cobrar una base sin receta con opciones", () => {
  it("con «Coca» (suma una botella) se vende y descuenta la botella de la opción, por la cantidad", async () => {
    const cuentaId = await cuentaNueva();
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.cocaId, 2);
    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await movimientosDe()).toEqual(expect.arrayContaining([["VENTA", g.gaseosaId, -2], ["CONSUMO", g.botellaId, -2]]));
    expect(await prisma.movimientoStock.count({ where: { proceso: "CONSUMO" } })).toBe(1);
  });

  it("con «Fanta» (sin consumo cargado) se rechaza con PRODUCTO_SIN_RECETA y el mensaje que nombra la opción; no queda nada escrito y la cuenta sigue abierta", async () => {
    const cuentaId = await cuentaNueva();
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.fantaId);
    expect(await cerrarCuentaCasoDeUso(actor(), { cuentaId })).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: MENSAJE_FANTA });
    await nadaEscrito(cuentaId);
  });

  it("I2, atomicidad: una cuenta con «Coca» (válida) y «Fanta» (sin consumo) no escribe NADA, ni siquiera la venta de la Coca; arreglada la Fanta, el mismo cierre vende las dos", async () => {
    const cuentaId = await cuentaNueva();
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.cocaId);
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.fantaId);
    expect(await cerrarCuentaCasoDeUso(actor(), { cuentaId })).toEqual({ ok: false, codigo: "PRODUCTO_SIN_RECETA", mensaje: MENSAJE_FANTA });
    await nadaEscrito(cuentaId);
  });

  it("una base CON receta sigue igual: con «Fanta» (sin consumo) se vende y descuenta la receta; con «Coca» descuenta la receta MÁS la botella", async () => {
    const mp = await darRecetaDeReventa(prisma, { id: g.gaseosaId, nombre: "Gaseosa 500 cc", codigo: "PV_GASEOSA_500", unidadStockId: s.unidad.id }, { sucursalIds: [s.sucursalId] });
    const conFanta = await cuentaNueva();
    await sembrarLineaDeGaseosa(s, g, conFanta, g.fantaId);
    expect((await cerrarCuentaCasoDeUso(actor(), { cuentaId: conFanta })).ok).toBe(true);
    const conCoca = await cuentaNueva(5);
    await sembrarLineaDeGaseosa(s, g, conCoca, g.cocaId);
    expect((await cerrarCuentaCasoDeUso(actor(), { cuentaId: conCoca })).ok).toBe(true);
    const consumos = (await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO" } })).map((m) => m.productoId).sort();
    expect(consumos).toEqual([mp.id, mp.id, g.botellaId].sort());
  });

  it("C2: una versión nueva de «Coca» SIN consumos entre pedir y cobrar no cambia lo pedido: el cobro descuenta según la versión 1 de la foto", async () => {
    const cuentaId = await cuentaNueva();
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.cocaId);
    await prisma.versionDeOpcion.create({ data: { opcionId: g.cocaId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId });
    expect(r.ok, r.mensaje).toBe(true);
    expect((await movimientosDe()).filter(([p]) => p === "CONSUMO")).toEqual([["CONSUMO", g.botellaId, -1]]);
  });

  it("C4: dos cierres a la vez de la MISMA cuenta dejan una sola operación de venta y un solo consumo", async () => {
    const cuentaId = await cuentaNueva();
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.cocaId);
    const [a, b] = await Promise.all([cerrarCuentaCasoDeUso(actor(), { cuentaId }), cerrarCuentaCasoDeUso(actor(), { cuentaId })]);
    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((r) => r.mensaje.includes("ya estaba cerrada"))).toHaveLength(1);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
    expect(await prisma.movimientoStock.count({ where: { proceso: "CONSUMO" } })).toBe(1);
  });

  it("C3: dos cuentas distintas cobran a la vez «Gaseosa · Coca» con la base vacía: dos operaciones y dos consumos, sin pérdida", async () => {
    const a = await cuentaNueva();
    const b = await cuentaNueva(5);
    await sembrarLineaDeGaseosa(s, g, a, g.cocaId);
    await sembrarLineaDeGaseosa(s, g, b, g.cocaId);
    const [ra, rb] = await Promise.all([cerrarCuentaCasoDeUso(actor(), { cuentaId: a }), cerrarCuentaCasoDeUso(actor(), { cuentaId: b })]);
    expect(ra.ok, ra.mensaje).toBe(true);
    expect(rb.ok, rb.mensaje).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
    const consumos = await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO" } });
    expect(consumos).toHaveLength(2);
    expect(consumos.reduce((t, m) => t + Number(m.cantidad), 0)).toBe(-2);
  });
});
