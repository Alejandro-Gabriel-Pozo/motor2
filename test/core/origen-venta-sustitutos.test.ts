import { describe, expect, it } from "vitest";
import {
  asignarConsumo,
  asignarConsumosDeVenta,
  crearLibroDeStock,
  type ParteConsumo,
  type PedidoDeConsumo,
  type SaldoLote,
  type SeccionCandidata,
} from "@/core/movimientos/origen-venta";
import { asignarConsumoReferencia } from "./fixtures/origen-venta-referencia";
import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";

/**
 * Núcleo puro de sustitución (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 3): `asignarConsumosDeVenta`, sin base ni
 * schema — los sustitutos llegan como familias YA RESUELTAS (eso lo hace `origen-venta-datos.ts` recién en el paso 8).
 */

const COCINA: SeccionCandidata = { id: "s-cocina", nombre: "Cocina" };
const DEPOSITO: SeccionCandidata = { id: "s-deposito", nombre: "Depósito" };
const BARRA: SeccionCandidata = { id: "s-barra", nombre: "Barra" };
const OCT = new Date("2026-10-01");
const NOV = new Date("2026-11-01");

const saldo = (productoId: string, seccion: SeccionCandidata, loteVencimiento: Date | null, s: number): SaldoLote => ({ productoId, seccionId: seccion.id, loteVencimiento, saldo: s });
const resumen = (partes: readonly ParteConsumo[]) =>
  partes.map((p) => [p.productoId, p.seccionId, p.loteVencimiento?.toISOString().slice(0, 10) ?? null, redondearACantidadDeUnidad(p.cantidad, 4), p.sustituyeAProductoId ?? null]);

describe("asignarConsumosDeVenta: núcleo puro de sustitución", () => {
  it("1) diferencial: sin sustitutos (ausente y []) da EXACTAMENTE lo mismo que la referencia congelada, sin ninguna marca", () => {
    let semilla = 42;
    const rand = () => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla / 0x7fffffff;
    };
    const entero = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
    const cantidad4 = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 10000) / 10000;
    const secciones = [COCINA, DEPOSITO, BARRA];

    for (let i = 0; i < 200; i++) {
      const familia = Array.from({ length: entero(1, 3) }, (_, k) => `p${i}-${k}`);
      const saldos: SaldoLote[] = [];
      for (const productoId of familia) {
        for (const seccion of secciones) {
          if (rand() < 0.4) continue;
          const conFecha = rand() < 0.7;
          saldos.push(saldo(productoId, seccion, conFecha ? new Date(2026, 9 + entero(0, 2), 1 + entero(0, 27)) : null, cantidad4(0, 3)));
        }
      }
      const habitual = rand() < 0.5 ? secciones[entero(0, 2)] : null;
      const respaldos = secciones.filter(() => rand() < 0.7);
      const seccionParaFaltanteId = secciones[entero(0, 2)].id;
      const pedidoBase = { productoId: familia[0], familia, cantidad: cantidad4(0.01, 4), seccionHabitual: habitual, respaldos, seccionParaFaltanteId };

      const libroA = crearLibroDeStock(saldos);
      const libroB = crearLibroDeStock(saldos);
      const conSustitutosVacio: PedidoDeConsumo = { ...pedidoBase, sustitutos: rand() < 0.5 ? [] : undefined };

      const [resultado] = asignarConsumosDeVenta(libroA, [conSustitutosVacio]);
      const referencia = asignarConsumoReferencia(libroB, pedidoBase);
      expect(resumen(resultado)).toStrictEqual(resumen(referencia.map((p) => ({ ...p }))));
      expect(resultado.every((p) => !("sustituyeAProductoId" in p))).toBe(true);
    }
  });

  it("2) hermanos antes que sustitutos, una sección: A=0, hermano B=0,3, sustituto S=1, pedido 0,5 → B 0,3 + S 0,2", () => {
    const libro = crearLibroDeStock([saldo("B", COCINA, null, 0.3), saldo("S", COCINA, null, 1)]);
    const [resultado] = asignarConsumosDeVenta(libro, [
      { productoId: "A", familia: ["A", "B"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id, sustitutos: [["S"]] },
    ]);
    expect(resumen(resultado)).toEqual([
      ["B", COCINA.id, null, 0.3, null],
      ["S", COCINA.id, null, 0.2, "A"],
    ]);
  });

  it("3) hermanos antes que sustitutos, entre secciones: sustituto en la habitual, hermano en el respaldo → primero el hermano", () => {
    const libro = crearLibroDeStock([saldo("B", DEPOSITO, null, 0.3), saldo("S", COCINA, null, 1)]);
    const [resultado] = asignarConsumosDeVenta(libro, [
      { productoId: "A", familia: ["A", "B"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [DEPOSITO], seccionParaFaltanteId: COCINA.id, sustitutos: [["S"]] },
    ]);
    expect(resumen(resultado)).toEqual([
      ["B", DEPOSITO.id, null, 0.3, null],
      ["S", COCINA.id, null, 0.2, "A"],
    ]);
  });

  it("4) orden declarado: se agota S1 antes de tocar S2", () => {
    const libro = crearLibroDeStock([saldo("S1", COCINA, null, 0.3), saldo("S2", COCINA, null, 1)]);
    const [resultado] = asignarConsumosDeVenta(libro, [
      { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id, sustitutos: [["S1"], ["S2"]] },
    ]);
    expect(resumen(resultado)).toEqual([
      ["S1", COCINA.id, null, 0.3, "A"],
      ["S2", COCINA.id, null, 0.2, "A"],
    ]);
  });

  it("5) FEFO y orden de secciones dentro de la familia sustituta (mira el vencimiento de TODA esa familia, no la principal)", () => {
    const libro = crearLibroDeStock([saldo("S1", BARRA, NOV, 5), saldo("S2", DEPOSITO, OCT, 0.1)]);
    const [resultado] = asignarConsumosDeVenta(libro, [
      { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: null, respaldos: [BARRA, DEPOSITO], seccionParaFaltanteId: BARRA.id, sustitutos: [["S1", "S2"]] },
    ]);
    expect(resumen(resultado)).toEqual([
      ["S2", DEPOSITO.id, "2026-10-01", 0.1, "A"],
      ["S1", BARRA.id, "2026-11-01", 0.4, "A"],
    ]);
  });

  it("6) todo o nada (D4): los sustitutos no alcanzan a cubrir el resto → no se toca ninguno, faltante idéntico a sin sustitutos", () => {
    const saldos = [saldo("A", COCINA, null, 0.2), saldo("S", COCINA, null, 0.1)];
    const libroConSustitutos = crearLibroDeStock(saldos);
    const libroSinSustitutos = crearLibroDeStock(saldos);
    const pedidoBase = { productoId: "A", familia: ["A"], cantidad: 1, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id };

    const [resultado] = asignarConsumosDeVenta(libroConSustitutos, [{ ...pedidoBase, sustitutos: [["S"]] }]);
    const referencia = asignarConsumo(libroSinSustitutos, pedidoBase);
    expect(resumen(resultado)).toStrictEqual(resumen(referencia.map((p) => ({ ...p }))));
    expect(resultado.some((p) => p.productoId === "S")).toBe(false);
  });

  it("7) equidad entre líneas (D5): una sustitución nunca le saca stock a un consumo principal de la MISMA venta", () => {
    const libro = crearLibroDeStock([saldo("S", COCINA, null, 0.5)]);
    const resultados = asignarConsumosDeVenta(libro, [
      { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id, sustitutos: [["S"]] },
      { productoId: "S", familia: ["S"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id },
    ]);
    // Pedido 2 (S como principal) sale completo — la sustitución del pedido 1 no le sacó nada.
    expect(resumen(resultados[1])).toEqual([["S", COCINA.id, null, 0.5, null]]);
    // Pedido 1 se queda sin sustituto (S ya no tiene disponible) y va todo a faltante.
    expect(resumen(resultados[0])).toEqual([["A", COCINA.id, null, 0.5, null]]);
  });

  it("8) dedupe: una familia sustituta que incluye un producto de la principal no lo usa dos veces", () => {
    const libro = crearLibroDeStock([saldo("B", COCINA, null, 0.3), saldo("S", COCINA, null, 1)]);
    const [resultado] = asignarConsumosDeVenta(libro, [
      // "B" está declarado (por error, o porque coincide) también en la familia del sustituto — no tiene que duplicarse.
      { productoId: "A", familia: ["A", "B"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id, sustitutos: [["B", "S"]] },
    ]);
    expect(resumen(resultado)).toEqual([
      ["B", COCINA.id, null, 0.3, null],
      ["S", COCINA.id, null, 0.2, "A"],
    ]);
    expect(resultado.filter((p) => p.productoId === "B")).toHaveLength(1);
  });

  it("9) marca: toda parte que salió de un sustituto lleva sustituyeAProductoId = el producto principal de la línea", () => {
    const libro = crearLibroDeStock([saldo("S", COCINA, null, 1)]);
    const [resultado] = asignarConsumosDeVenta(libro, [
      { productoId: "A", familia: ["A"], cantidad: 0.5, seccionHabitual: COCINA, respaldos: [], seccionParaFaltanteId: COCINA.id, sustitutos: [["S"]] },
    ]);
    expect(resultado).toEqual([{ productoId: "S", seccionId: COCINA.id, loteVencimiento: null, cantidad: 0.5, sustituyeAProductoId: "A" }]);
  });
});
