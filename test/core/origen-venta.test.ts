import { describe, expect, it } from "vitest";
import { asignarConsumo, crearLibroDeStock, elegirSeccionDeStockPropio, faltantesDe, type SaldoLote, type SeccionCandidata } from "../../src/core/movimientos/origen-venta";
import { redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";

/**
 * Núcleo puro del origen de la venta (src/core/movimientos/origen-venta.ts, docs/plan-seccion-habitual-stock-2026-09-25.md C3): sin
 * base. De qué sección y lote sale cada consumo, con el libro que lleva la cuenta de lo ya asignado dentro de la misma venta.
 */

const OCT = new Date("2026-10-01");
const NOV = new Date("2026-11-01");
const DIC = new Date("2026-12-01");

const COCINA: SeccionCandidata = { id: "s-cocina", nombre: "Cocina" };
const DEPOSITO: SeccionCandidata = { id: "s-deposito", nombre: "Depósito" };
const BARRA: SeccionCandidata = { id: "s-barra", nombre: "Barra" };

const saldo = (productoId: string, seccion: SeccionCandidata, loteVencimiento: Date | null, s: number): SaldoLote => ({ productoId, seccionId: seccion.id, loteVencimiento, saldo: s });
const resumen = (partes: { productoId: string; seccionId: string; loteVencimiento: Date | null; cantidad: number }[]) =>
  partes.map((p) => [p.productoId, p.seccionId, p.loteVencimiento?.toISOString().slice(0, 10) ?? null, redondearACantidadDeUnidad(p.cantidad, 4)]);

describe("asignarConsumo", () => {
  it("una sola sección que alcanza: todo de ahí, del lote que vence antes", () => {
    const libro = crearLibroDeStock([saldo("A", COCINA, NOV, 1), saldo("A", COCINA, OCT, 1)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([["A", COCINA.id, "2026-10-01", 0.5]]);
  });

  it("la habitual gana aunque un respaldo tenga un lote que vence antes", () => {
    const libro = crearLibroDeStock([saldo("A", COCINA, DIC, 1), saldo("A", DEPOSITO, OCT, 1)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [COCINA, DEPOSITO], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([["A", COCINA.id, "2026-12-01", 0.5]]);
  });

  it("la habitual alcanza en parte: el resto sale del respaldo", () => {
    const libro = crearLibroDeStock([saldo("A", COCINA, null, 0.2), saldo("A", DEPOSITO, OCT, 1)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [DEPOSITO], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([
      ["A", COCINA.id, null, 0.2],
      ["A", DEPOSITO.id, "2026-10-01", 0.3],
    ]);
  });

  it("orden de respaldo: primero por vencimiento de la sección, después más disponible, después nombre", () => {
    // Por vencimiento: Depósito (OCT) antes que Barra (NOV) aunque Barra tenga más.
    let libro = crearLibroDeStock([saldo("A", BARRA, NOV, 5), saldo("A", DEPOSITO, OCT, 0.1)]);
    let partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: null, respaldos: [BARRA, DEPOSITO], seccionParaFaltanteId: BARRA.id });
    expect(resumen(partes)).toEqual([
      ["A", DEPOSITO.id, "2026-10-01", 0.1],
      ["A", BARRA.id, "2026-11-01", 0.4],
    ]);
    // Mismo vencimiento: más disponible primero.
    libro = crearLibroDeStock([saldo("A", BARRA, OCT, 0.5), saldo("A", DEPOSITO, OCT, 1)]);
    partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: null, respaldos: [BARRA, DEPOSITO], seccionParaFaltanteId: BARRA.id });
    expect(resumen(partes)).toEqual([["A", DEPOSITO.id, "2026-10-01", 0.5]]);
    // Mismo vencimiento y disponible: por nombre (Barra < Depósito).
    libro = crearLibroDeStock([saldo("A", DEPOSITO, null, 1), saldo("A", BARRA, null, 1)]);
    partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: null, respaldos: [DEPOSITO, BARRA], seccionParaFaltanteId: DEPOSITO.id });
    expect(resumen(partes)).toEqual([["A", BARRA.id, null, 0.5]]);
  });

  it("el vencimiento de la sección mira la familia entera (un hermano que vence antes adelanta a su sección)", () => {
    const libro = crearLibroDeStock([saldo("A", BARRA, NOV, 1), saldo("B", DEPOSITO, OCT, 1)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A", "B"], cantidad: 0.5, seccionHabitual: null, respaldos: [BARRA, DEPOSITO], seccionParaFaltanteId: BARRA.id });
    expect(resumen(partes)).toEqual([["B", DEPOSITO.id, "2026-10-01", 0.5]]);
  });

  it("sin habitual: sale de los respaldos", () => {
    const libro = crearLibroDeStock([saldo("A", DEPOSITO, null, 1)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.25, seccionHabitual: null, respaldos: [COCINA, DEPOSITO], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([["A", DEPOSITO.id, null, 0.25]]);
  });

  it("nada alcanza: toma todo lo disponible y carga SOLO el resto al producto de la receta en la sección de faltante, con el lote de la última parte tomada ahí", () => {
    const libro = crearLibroDeStock([saldo("A", COCINA, OCT, 0.2), saldo("B", DEPOSITO, null, 0.1)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A", "B"], cantidad: 1, seccionHabitual: COCINA, respaldos: [DEPOSITO], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([
      ["A", COCINA.id, "2026-10-01", 0.9],
      ["B", DEPOSITO.id, null, 0.1],
    ]);
    expect(faltantesDe(libro, new Set(["A", "B"]))).toEqual([{ productoId: "A", seccionId: COCINA.id, actual: 0.2, requerido: 0.9 }]);
  });

  it("nada alcanza y no se tomó nada en la sección de faltante: el resto va sin lote", () => {
    const libro = crearLibroDeStock([saldo("A", DEPOSITO, OCT, 0.2)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 1, seccionHabitual: null, respaldos: [DEPOSITO], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([
      ["A", DEPOSITO.id, "2026-10-01", 0.2],
      ["A", COCINA.id, null, 0.8],
    ]);
  });

  it("H9: dos pedidos de la misma familia en el mismo libro no toman dos veces el mismo lote", () => {
    const libro = crearLibroDeStock([saldo("A", DEPOSITO, OCT, 0.3), saldo("B", DEPOSITO, NOV, 0.3)]);
    const pedido = { productoId: "A", familia: ["A", "B"], cantidad: 0.25, seccionHabitual: DEPOSITO, respaldos: [], seccionParaFaltanteId: DEPOSITO.id };
    expect(resumen(asignarConsumo(libro, pedido))).toEqual([["A", DEPOSITO.id, "2026-10-01", 0.25]]);
    expect(resumen(asignarConsumo(libro, pedido))).toEqual([
      ["A", DEPOSITO.id, "2026-10-01", 0.05],
      ["B", DEPOSITO.id, "2026-11-01", 0.2],
    ]);
    expect(faltantesDe(libro, new Set(["A", "B"]))).toEqual([]);
  });

  it("FEFO entre hermanos igual que resolverConsumoPorFamilia cuando alcanza: lote que vence antes primero, sin lote al final; empate → el de la receta", () => {
    const libro = crearLibroDeStock([saldo("B", COCINA, null, 1), saldo("B", COCINA, NOV, 0.2), saldo("C", COCINA, OCT, 0.2), saldo("A", COCINA, NOV, 0.2)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A", "B", "C"], cantidad: 0.8, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id });
    expect(resumen(partes)).toEqual([
      ["C", COCINA.id, "2026-10-01", 0.2],
      ["A", COCINA.id, "2026-11-01", 0.2],
      ["B", COCINA.id, "2026-11-01", 0.2],
      ["B", COCINA.id, null, 0.2],
    ]);
  });

  it.each([
    { hermanos: [3.37, 2.19, 1.81], pedido: 7.37 },
    { hermanos: [0.1, 0.2, 0.3, 0.4, 0.07], pedido: 1.07 },
  ])("precisión: $hermanos.length hermanos que calzan justo, sin residuos (cada parte = su saldo, ninguna de 1e-17)", ({ hermanos, pedido }) => {
    const ids = hermanos.map((_, i) => `H${i}`);
    const libro = crearLibroDeStock(hermanos.map((s, i) => saldo(ids[i], COCINA, new Date(2026, 9, i + 1), s)));
    const partes = asignarConsumo(libro, { productoId: ids[0], familia: ids, cantidad: pedido, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id });
    // Una parte por hermano (ninguna parte extra de ruido de punto flotante), cada una con su saldo.
    expect(partes.map((p) => redondearACantidadDeUnidad(p.cantidad, 4))).toEqual(hermanos);
    expect(partes.every((p) => Math.abs(p.cantidad - redondearACantidadDeUnidad(p.cantidad, 4)) < 1e-9)).toBe(true);
    expect(redondearACantidadDeUnidad(partes.reduce((s, p) => s + p.cantidad, 0), 4)).toBe(pedido);
    expect(faltantesDe(libro, new Set(ids))).toEqual([]);
  });

  it("saldo negativo previo en un lote: nunca se toma más que el saldo TOTAL que queda en la sección", () => {
    const libro = crearLibroDeStock([saldo("A", COCINA, OCT, -0.2), saldo("A", COCINA, NOV, 0.5)]);
    const partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.4, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id });
    // Total de la sección 0,3: se toman 0,3 del lote NOV y el 0,1 restante es faltante (mismo lote, una sola parte).
    expect(resumen(partes)).toEqual([["A", COCINA.id, "2026-11-01", 0.4]]);
    expect(faltantesDe(libro, new Set(["A"]))).toEqual([{ productoId: "A", seccionId: COCINA.id, actual: 0.3, requerido: 0.4 }]);
  });

  it("modo sección fija (mostrador) = como antes: sin hermanos, el faltante carga todo el pedido al producto en esa sección y el aviso trae saldo y total", () => {
    const libro = crearLibroDeStock([saldo("HARINA", DEPOSITO, null, 0.5), saldo("HARINA", COCINA, null, 10)]);
    const partes = asignarConsumo(libro, { productoId: "HARINA", familia: ["HARINA"], cantidad: 1.5, seccionHabitual: DEPOSITO, respaldos: [], seccionParaFaltanteId: DEPOSITO.id });
    expect(resumen(partes)).toEqual([["HARINA", DEPOSITO.id, null, 1.5]]);
    expect(faltantesDe(libro, new Set(["HARINA"]))).toEqual([{ productoId: "HARINA", seccionId: DEPOSITO.id, actual: 0.5, requerido: 1.5 }]);
  });

  it("una sección fuera de `respaldos` nunca recibe partes aunque venza antes, salvo que sea la habitual", () => {
    const saldos = [saldo("A", BARRA, OCT, 1), saldo("A", DEPOSITO, DIC, 1)];
    let libro = crearLibroDeStock(saldos);
    let partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 1.5, seccionHabitual: null, respaldos: [DEPOSITO], seccionParaFaltanteId: DEPOSITO.id });
    expect(partes.every((p) => p.seccionId !== BARRA.id)).toBe(true);
    libro = crearLibroDeStock(saldos);
    partes = asignarConsumo(libro, { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: BARRA, respaldos: [DEPOSITO], seccionParaFaltanteId: BARRA.id });
    expect(resumen(partes)).toEqual([["A", BARRA.id, "2026-10-01", 0.5]]);
  });
});

describe("elegirSeccionDeStockPropio (PV que se produce)", () => {
  it("la habitual si alcanza; si no, el primer respaldo que alcanza; si ninguno, la indicada — sin repartir entre secciones, FEFO por lote", () => {
    const saldos = [saldo("TORTA", COCINA, OCT, 1), saldo("TORTA", DEPOSITO, NOV, 3), saldo("TORTA", DEPOSITO, DIC, 3)];
    let libro = crearLibroDeStock(saldos);
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 1, seccionHabitual: COCINA, respaldos: [DEPOSITO], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, "2026-10-01", 1],
    ]);
    // La habitual ya se agotó en el libro: la segunda sale del respaldo.
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 2, seccionHabitual: COCINA, respaldos: [DEPOSITO], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", DEPOSITO.id, "2026-11-01", 2],
    ]);
    libro = crearLibroDeStock(saldos);
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 9, seccionHabitual: null, respaldos: [COCINA, DEPOSITO], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, "2026-10-01", 9],
    ]);
  });

  it("modo sección fija: siempre esa sección, sin lote si no le queda ninguno con disponible", () => {
    const libro = crearLibroDeStock([saldo("TORTA", COCINA, OCT, 2)]);
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 5, seccionHabitual: COCINA, respaldos: [], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, "2026-10-01", 5],
    ]);
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 1, seccionHabitual: COCINA, respaldos: [], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, null, 1],
    ]);
  });

  it("O.40 (1): un pedido que un solo lote no cubre se reparte FEFO entre los lotes de la sección (el que vence antes primero), y ninguno queda en negativo", () => {
    const libro = crearLibroDeStock([saldo("TORTA", COCINA, NOV, 2), saldo("TORTA", COCINA, OCT, 1), saldo("TORTA", COCINA, DIC, 5)]);
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 2, seccionHabitual: COCINA, respaldos: [], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, "2026-10-01", 1],
      ["TORTA", COCINA.id, "2026-11-01", 1],
    ]);
    // El libro recuerda lo tomado: el pedido siguiente sigue por donde quedó.
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 2, seccionHabitual: COCINA, respaldos: [], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, "2026-11-01", 1],
      ["TORTA", COCINA.id, "2026-12-01", 1],
    ]);
  });

  it("el lote «sin lote» va al final; y lo que ningún lote cubre queda en el último lote tomado (el faltante), con la suma exacta del pedido", () => {
    const libro = crearLibroDeStock([saldo("TORTA", COCINA, OCT, 1), saldo("TORTA", COCINA, null, 1)]);
    expect(resumen(elegirSeccionDeStockPropio(libro, { productoId: "TORTA", cantidad: 5, seccionHabitual: COCINA, respaldos: [], seccionSiNingunaAlcanzaId: COCINA.id }))).toEqual([
      ["TORTA", COCINA.id, "2026-10-01", 1],
      ["TORTA", COCINA.id, null, 4],
    ]);
  });
});
