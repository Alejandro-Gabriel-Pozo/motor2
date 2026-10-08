import { describe, expect, it } from "vitest";
import { crearLibroDeStock, type SaldoLote, type SeccionCandidata } from "../../src/core/movimientos/origen-venta";
import type { DatosDeOrigen } from "../../src/core/movimientos/origen-venta-datos";
import { asignarOrigenDeLaVenta, rechazoSinRespaldo, type LineaArmada } from "../../src/core/movimientos/plan-de-la-venta";

/**
 * El plan de origen de la venta (Hito 5, 5.1 bloque B1: `core/movimientos/plan-de-la-venta.ts`, mudado tal cual desde `registrarVentaEnTx`): sin base. Fija el TEXTO del rechazo sin
 * respaldo, qué sección gana para cada venta (la habitual, después la del primer consumo, después la de referencia, después la de por defecto) y el ORDEN en que se muta el libro
 * (el stock propio de los PV que se producen ANTES que los pedidos de receta). Las matrices de la venta (`caracterizacion/venta-matriz*`) lo fijan de punta a punta con la base.
 */

const COCINA: SeccionCandidata = { id: "s-cocina", nombre: "Cocina" };
const DEPOSITO: SeccionCandidata = { id: "s-deposito", nombre: "Depósito" };
const BARRA: SeccionCandidata = { id: "s-barra", nombre: "Barra" };

const saldo = (productoId: string, seccion: SeccionCandidata, s: number, loteVencimiento: Date | null = null): SaldoLote => ({ productoId, seccionId: seccion.id, loteVencimiento, saldo: s });

/** Los datos de origen con un libro real y los mapas que el cargador de la base arma de antemano (cierres sin I/O). */
function origen(
  saldos: SaldoLote[],
  opciones: {
    respaldos?: SeccionCandidata[];
    habituales?: Record<string, SeccionCandidata>;
    referencias?: Record<string, string>;
    familias?: Record<string, string[]>;
    sustitutas?: Record<string, string[]>;
    porDefecto?: string;
  } = {}
): DatosDeOrigen {
  const habituales = opciones.habituales ?? {};
  const referencias = opciones.referencias ?? {};
  const familias = opciones.familias ?? {};
  const sustitutas = opciones.sustitutas ?? {};
  return {
    libro: crearLibroDeStock(saldos),
    familiaDe: (mpId) => familias[mpId] ?? [mpId],
    familiaSustitutaDe: (insumoId) => sustitutas[insumoId] ?? [],
    habitualDe: (pvId) => habituales[pvId] ?? null,
    respaldos: opciones.respaldos ?? [],
    referenciaDe: (productoId) => referencias[productoId] ?? null,
    seccionPorDefectoId: opciones.porDefecto ?? COCINA.id,
    nombreDeSeccion: (id) => id,
  };
}

const linea = (productoId: string, extra: Partial<LineaArmada> = {}): LineaArmada => ({
  productoId, nombre: productoId, seProduce: false, cantidadVendida: 1, precioVenta: 100, precioListaVenta: null, costoUnitarioAlVender: null, promoCuentaId: null, pedidos: [], ...extra,
});
const pedido = (productoId: string, cantidad: number, insumoSustitutoIds: string[] = []) => ({ productoId, cantidad, insumoSustitutoIds, unidadStockId: "u1" });

describe("rechazoSinRespaldo", () => {
  const sinRespaldos = origen([], { habituales: { PAN: COCINA } });

  it("sin ninguna sección de respaldo y un PV sin habitual: el texto exacto, con el nombre de la sucursal y del PV", () => {
    expect(rechazoSinRespaldo([linea("PIZZA")], sinRespaldos, "Central")).toBe(
      "Ninguna sección de «Central» sirve de respaldo automático en ventas y «PIZZA» no tiene sección habitual: " +
        "configurá su sección habitual (Stock → Sección habitual) o marcá una sección como respaldo (Movimientos → Secciones)."
    );
  });

  it("nombra al PRIMER PV de las líneas que no tiene habitual (no al último)", () => {
    const mensaje = rechazoSinRespaldo([linea("PAN"), linea("PIZZA"), linea("TORTA")], sinRespaldos, "Central");
    expect(mensaje).toContain("«PIZZA» no tiene sección habitual");
    expect(mensaje).not.toContain("TORTA");
  });

  it("no rechaza si todas las líneas tienen habitual, aunque no haya respaldos", () => {
    expect(rechazoSinRespaldo([linea("PAN")], sinRespaldos, "Central")).toBeNull();
  });

  it("no rechaza si hay al menos un respaldo, aunque el PV no tenga habitual", () => {
    expect(rechazoSinRespaldo([linea("PIZZA")], origen([], { respaldos: [DEPOSITO] }), "Central")).toBeNull();
  });
});

describe("asignarOrigenDeLaVenta: la sección de cada venta", () => {
  it("la HABITUAL del PV gana aunque el consumo haya salido de otra sección (respaldo)", () => {
    const datos = origen([saldo("HARINA", DEPOSITO, 5)], { respaldos: [DEPOSITO], habituales: { PAN: COCINA }, referencias: { PAN: BARRA.id }, porDefecto: BARRA.id });
    const { ventas } = asignarOrigenDeLaVenta([linea("PAN", { pedidos: [pedido("HARINA", 2)] })], datos);
    expect(ventas[0]!.consumos.map((c) => c.seccionId)).toEqual([DEPOSITO.id]);
    expect(ventas[0]!.seccionId).toBe(COCINA.id);
    expect(ventas[0]!.loteVencimiento).toBeNull();
  });

  it("sin habitual, la sección del PRIMER consumo gana a la de referencia y a la de por defecto", () => {
    const datos = origen([saldo("HARINA", DEPOSITO, 5)], { respaldos: [DEPOSITO], referencias: { PAN: BARRA.id }, porDefecto: COCINA.id });
    const { ventas } = asignarOrigenDeLaVenta([linea("PAN", { pedidos: [pedido("HARINA", 2)] })], datos);
    expect(ventas[0]!.seccionId).toBe(DEPOSITO.id);
  });

  it("sin habitual y sin consumos (receta vacía): la de referencia del PV y, sin ella, la de por defecto", () => {
    const conReferencia = origen([], { respaldos: [DEPOSITO], referencias: { PAN: BARRA.id }, porDefecto: COCINA.id });
    expect(asignarOrigenDeLaVenta([linea("PAN")], conReferencia).ventas[0]!.seccionId).toBe(BARRA.id);
    const sinReferencia = origen([], { respaldos: [DEPOSITO], porDefecto: COCINA.id });
    expect(asignarOrigenDeLaVenta([linea("PAN")], sinReferencia).ventas[0]!.seccionId).toBe(COCINA.id);
  });

  it("un PV que se produce sale de su stock PROPIO: sección, lote y partes de la primera parte (FEFO), con todas en `partesPropias`", () => {
    const vence1 = new Date("2026-11-01");
    const vence2 = new Date("2026-12-01");
    const datos = origen([saldo("TORTA", COCINA, 0.4, vence2), saldo("TORTA", COCINA, 0.4, vence1)], { habituales: { TORTA: COCINA } });
    const { ventas, pedidosPlanos } = asignarOrigenDeLaVenta([linea("TORTA", { seProduce: true, cantidadVendida: 0.6 })], datos);
    expect(ventas[0]!.seccionId).toBe(COCINA.id);
    expect(ventas[0]!.loteVencimiento).toEqual(vence1);
    expect(ventas[0]!.consumos).toEqual([]);
    expect(ventas[0]!.partesPropias!.map((p) => [p.loteVencimiento, p.cantidad])).toEqual([[vence1, 0.4], [vence2, 0.6 - 0.4]]);
    expect(pedidosPlanos).toEqual([]);
  });
});

describe("asignarOrigenDeLaVenta: los pedidos de receta de la venta entera", () => {
  it("los pedidos planos van en el orden de línea e ingrediente y cada venta recibe SOLO sus consumos", () => {
    const datos = origen([saldo("HARINA", COCINA, 10), saldo("SAL", COCINA, 10), saldo("AGUA", COCINA, 10)], { habituales: { PAN: COCINA, FOCACCIA: COCINA } });
    const { ventas, pedidosPlanos } = asignarOrigenDeLaVenta(
      [linea("PAN", { pedidos: [pedido("HARINA", 2), pedido("SAL", 1)] }), linea("FOCACCIA", { pedidos: [pedido("AGUA", 3)] })],
      datos
    );
    expect(pedidosPlanos.map((p) => [p.productoId, p.cantidad])).toEqual([["HARINA", 2], ["SAL", 1], ["AGUA", 3]]);
    expect(ventas[0]!.consumos.map((c) => [c.productoId, c.cantidad])).toEqual([["HARINA", 2], ["SAL", 1]]);
    expect(ventas[1]!.consumos.map((c) => [c.productoId, c.cantidad])).toEqual([["AGUA", 3]]);
  });

  it("la sección del faltante de un pedido: habitual, después la referencia del insumo, después la del PV, después la de por defecto", () => {
    const base = { respaldos: [] as SeccionCandidata[] };
    const pedidos = (datos: DatosDeOrigen) => asignarOrigenDeLaVenta([linea("PAN", { pedidos: [pedido("HARINA", 1)] })], datos).pedidosPlanos[0]!.seccionParaFaltanteId;
    expect(pedidos(origen([], { ...base, habituales: { PAN: COCINA }, referencias: { HARINA: DEPOSITO.id, PAN: BARRA.id }, porDefecto: "x" }))).toBe(COCINA.id);
    expect(pedidos(origen([], { ...base, referencias: { HARINA: DEPOSITO.id, PAN: BARRA.id }, porDefecto: "x" }))).toBe(DEPOSITO.id);
    expect(pedidos(origen([], { ...base, referencias: { PAN: BARRA.id }, porDefecto: "x" }))).toBe(BARRA.id);
    expect(pedidos(origen([], { ...base, porDefecto: "x" }))).toBe("x");
  });

  it("los sustitutos del pedido son las familias de cada insumo sustituto declarado, o `undefined` si la línea no declara ninguno", () => {
    const datos = origen([], { sustitutas: { INSUMO_A: ["MP_A1", "MP_A2"], INSUMO_B: ["MP_B1"] } });
    const { pedidosPlanos } = asignarOrigenDeLaVenta([linea("PAN", { pedidos: [pedido("HARINA", 1, ["INSUMO_A", "INSUMO_B"]), pedido("SAL", 1)] })], datos);
    expect(pedidosPlanos[0]!.sustitutos).toEqual([["MP_A1", "MP_A2"], ["MP_B1"]]);
    expect(pedidosPlanos[1]!.sustitutos).toBeUndefined();
  });
});

describe("asignarOrigenDeLaVenta: el orden de las mutaciones del libro", () => {
  it("el stock PROPIO de los PV que se producen se asigna ANTES que los pedidos de receta (si compartieran producto, el propio se queda con el lote que vence antes)", () => {
    // Caso artificial (un PV que se produce nunca es MP de una receta): una línea que se produce pide X y otra consume X de su receta, con dos lotes de 1 cada uno.
    // La línea del PV propio se resuelve primero aunque esté DESPUÉS de la que consume: con el orden contrario, el lote que vence antes sería del consumo.
    const noviembre = new Date("2026-11-01");
    const diciembre = new Date("2026-12-01");
    const datos = origen([saldo("X", COCINA, 1, diciembre), saldo("X", COCINA, 1, noviembre)], { habituales: { PAN: COCINA, X: COCINA }, porDefecto: COCINA.id });
    const { ventas } = asignarOrigenDeLaVenta([linea("PAN", { pedidos: [pedido("X", 1)] }), linea("X", { seProduce: true, cantidadVendida: 1 })], datos);
    expect(ventas[1]!.partesPropias!.map((p) => [p.seccionId, p.loteVencimiento, p.cantidad])).toEqual([[COCINA.id, noviembre, 1]]);
    expect(ventas[0]!.consumos.map((c) => [c.productoId, c.seccionId, c.loteVencimiento, c.cantidad])).toEqual([["X", COCINA.id, diciembre, 1]]);
  });

  it("UN solo reparto para la venta entera: dos líneas que piden el mismo lote no lo toman dos veces (H9)", () => {
    const datos = origen([saldo("HARINA", COCINA, 3)], { habituales: { PAN: COCINA, FOCACCIA: COCINA } });
    const { ventas } = asignarOrigenDeLaVenta([linea("PAN", { pedidos: [pedido("HARINA", 2)] }), linea("FOCACCIA", { pedidos: [pedido("HARINA", 2)] })], datos);
    // La primera toma 2 de los 3; la segunda toma el 1 que queda y el resto (1) como faltante en la misma sección: se juntan en una parte de 2 (mismo producto, sección y lote).
    expect(ventas[0]!.consumos.map((c) => c.cantidad)).toEqual([2]);
    expect(ventas[1]!.consumos.map((c) => c.cantidad)).toEqual([2]);
    expect(datos.libro.cargado("HARINA", COCINA.id)).toBe(4);
  });
});
