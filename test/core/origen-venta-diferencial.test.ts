import { describe, expect, it } from "vitest";
import { asignarConsumo, crearLibroDeStock, faltantesDe, type SaldoLote, type SeccionCandidata } from "@/core/movimientos/origen-venta";
import { redondearCantidadExacta } from "@/core/datos/cantidad-exacta";
import { asignarConsumoReferencia } from "./fixtures/origen-venta-referencia";

/**
 * Etapa aparte de A1b 2026-11-16 («origen-venta: resta exacta del resto del pedido»). EXCEPCIÓN DECLARADA al «no se edita en ningún paso posterior» del encabezado de arriba: el
 * `asignarConsumo` real ahora resta el resto con `redondearACantidadDeUnidad(restante − tomar, 8)`, así que ya NO es idéntico a la referencia congelada, que conserva la resta en float
 * (ruido de 1e-16: 0,2368 vs 0,23680000000000012, y restos de 0,00005 que PIERDE con pedidos de más de 4 decimales). Motivo: un resto de 0,00005 perdido era stock que no se descontaba.
 * Por eso el primer test compara redondeando a 8 decimales (cualquier diferencia de estructura, orden, lote o cantidad ≥ 1e-8 sigue fallando) y el segundo, con pedidos de 5
 * decimales, fija la propiedad que el PR arregla (no se pierde nada) y cuenta cuántas veces la referencia SÍ lo pierde (prueba de que el generador ejercita el arreglo).
 */
const r8 = (n: number) => redondearCantidadExacta(n, 8);
const limpias = <T extends { cantidad: number }>(partes: T[]): T[] => partes.map((p) => ({ ...p, cantidad: r8(p.cantidad) }));

/**
 * Test DIFERENCIAL (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 1): compara el `asignarConsumo` REAL contra la
 * REFERENCIA CONGELADA (`fixtures/origen-venta-referencia.ts`, copia literal de hoy) en ~500 escenarios generados con un PRNG de
 * semilla fija — determinístico entre corridas, sin flakiness.
 *
 * Objetivo: demostrar (a) del plan §4 — sin sustitutos, `asignarConsumo` se sigue comportando EXACTAMENTE igual después de los
 * pasos 2 (refactor `tomarDeFamilia`) y 3 (núcleo de sustitución). Este archivo se escribe ANTES de tocar producción y no se edita
 * en ningún paso posterior — si algún paso cambia el resultado sin sustitutos, este test lo detecta.
 *
 * Cada escenario: 1–3 secciones, 1–2 familias de 1–3 productos cada una (con lotes con/sin fecha, saldos que pueden ser negativos),
 * habitual/respaldos al azar, y 1–4 pedidos que comparten esas familias sobre el MISMO libro (ejercita H9: lo que toma un pedido
 * descuenta lo que ve el siguiente). Se compara: el resultado de cada pedido, el estado final del libro (`cargados()` y `cargado`
 * por par) y `faltantesDe`.
 */

// PRNG determinístico (mulberry32) — mismo criterio en todo el archivo: nunca Math.random().
function mulberry32(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEMILLA = 20260926;
const N_ESCENARIOS = 500;
const NOMBRES_SECCION = ["Alfa", "Beta", "Gama"];

function crearGenerador(rand: () => number) {
  const entero = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const cantidad4 = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 10000) / 10000;
  const elegir = <T,>(arr: readonly T[]): T => arr[entero(0, arr.length - 1)];
  const bool = (probabilidadTrue = 0.5) => rand() < probabilidadTrue;

  return { entero, cantidad4, elegir, bool };
}

interface Escenario {
  secciones: SeccionCandidata[];
  familias: string[][];
  saldos: SaldoLote[];
  pedidos: {
    productoId: string;
    familia: readonly string[];
    cantidad: number;
    seccionHabitual: SeccionCandidata | null;
    respaldos: readonly SeccionCandidata[];
    seccionParaFaltanteId: string;
  }[];
}

function generarEscenario(rand: () => number, indice: number): Escenario {
  const { entero, cantidad4, elegir, bool } = crearGenerador(rand);

  const nSecciones = entero(1, 3);
  const secciones: SeccionCandidata[] = NOMBRES_SECCION.slice(0, nSecciones).map((nombre, i) => ({ id: `e${indice}-s${i}`, nombre }));

  const nFamilias = entero(1, 2);
  const familias: string[][] = [];
  for (let f = 0; f < nFamilias; f++) {
    const nProductos = entero(1, 3);
    familias.push(Array.from({ length: nProductos }, (_, i) => `e${indice}-f${f}-p${i}`));
  }

  const saldos: SaldoLote[] = [];
  for (const familia of familias) {
    for (const productoId of familia) {
      for (const seccion of secciones) {
        if (!bool(0.6)) continue; // no todos los productos tienen stock en todas las secciones
        const nLotes = entero(1, 3);
        for (let l = 0; l < nLotes; l++) {
          const conFecha = bool(0.7);
          const loteVencimiento = conFecha ? new Date(2026, 9 + entero(0, 3), 1 + entero(0, 27)) : null;
          const negativo = bool(0.15);
          const saldo = negativo ? -cantidad4(0.01, 1) : cantidad4(0, 5);
          saldos.push({ productoId, seccionId: seccion.id, loteVencimiento, saldo });
        }
      }
    }
  }

  const respaldosPosibles = secciones.filter(() => bool(0.7));
  const habitual = bool(0.6) ? elegir(secciones) : null;
  const seccionParaFaltante = elegir(secciones);

  const nPedidos = entero(1, 4);
  const pedidos: Escenario["pedidos"] = [];
  for (let p = 0; p < nPedidos; p++) {
    const familia = elegir(familias);
    const productoId = elegir(familia);
    pedidos.push({
      productoId,
      familia,
      cantidad: cantidad4(0.01, 6),
      seccionHabitual: habitual,
      respaldos: respaldosPosibles,
      seccionParaFaltanteId: seccionParaFaltante.id,
    });
  }

  return { secciones, familias, saldos, pedidos };
}

describe("asignarConsumo real vs. referencia congelada (diferencial, PRNG de semilla fija)", () => {
  it(`${N_ESCENARIOS} escenarios al azar: mismos resultados por pedido, mismo estado final del libro, mismos faltantes`, () => {
    const rand = mulberry32(SEMILLA);

    for (let i = 0; i < N_ESCENARIOS; i++) {
      const escenario = generarEscenario(rand, i);
      const libroReal = crearLibroDeStock(escenario.saldos);
      const libroRef = crearLibroDeStock(escenario.saldos);
      const productoIds = new Set(escenario.familias.flat());

      for (let j = 0; j < escenario.pedidos.length; j++) {
        const pedido = escenario.pedidos[j];
        const partesReal = asignarConsumo(libroReal, pedido);
        const partesRef = asignarConsumoReferencia(libroRef, pedido);
        try {
          expect(limpias(partesReal)).toStrictEqual(limpias(partesRef));
        } catch (e) {
          throw new Error(`Escenario ${i}, pedido ${j}: resultado distinto.\n${(e as Error).message}`);
        }
      }

      try {
        expect(libroReal.cargados()).toStrictEqual(libroRef.cargados());
        for (const { productoId, seccionId } of libroReal.cargados()) {
          expect(r8(libroReal.cargado(productoId, seccionId))).toBe(r8(libroRef.cargado(productoId, seccionId)));
        }
        expect(faltantesDe(libroReal, productoIds)).toStrictEqual(faltantesDe(libroRef, productoIds));
      } catch (e) {
        throw new Error(`Escenario ${i}: estado final del libro distinto.\n${(e as Error).message}`);
      }
    }
  });

  it("con pedidos de 5 decimales (una media unidad de 0,0001): el real no pierde nada; la referencia congelada sí lo pierde en alguno", () => {
    const rand = mulberry32(SEMILLA + 1);
    const sumar = (partes: { cantidad: number }[]) => r8(partes.reduce((suma, p) => suma + p.cantidad, 0));
    let perdidasEnLaReferencia = 0;

    for (let i = 0; i < N_ESCENARIOS; i++) {
      const escenario = generarEscenario(rand, i);
      // Cada pedido pide lo que suman uno o dos lotes con saldo de su familia MÁS una media unidad (0,00005, 0,00015 o 0,00025): el resto que queda tras agotarlos es el que el float perdía.
      for (const pedido of escenario.pedidos) {
        const delaFamilia = escenario.saldos.filter((x) => pedido.familia.includes(x.productoId) && x.saldo > 0);
        const aAgotar = delaFamilia.slice(0, 1 + Math.floor(rand() * 2));
        pedido.cantidad = r8(aAgotar.reduce((suma, x) => suma + x.saldo, 0) + 0.00005 + 0.0001 * Math.floor(rand() * 3));
      }
      const libroReal = crearLibroDeStock(escenario.saldos);
      const libroRef = crearLibroDeStock(escenario.saldos);
      for (let j = 0; j < escenario.pedidos.length; j++) {
        const pedido = escenario.pedidos[j];
        const real = sumar(asignarConsumo(libroReal, pedido));
        const ref = sumar(asignarConsumoReferencia(libroRef, pedido));
        // Lo único que puede quedar sin asignar es lo que el redondeo a 4 decimales lleva a 0 (< 0,00005).
        expect(r8(pedido.cantidad - real) < 0.00005, `Escenario ${i}, pedido ${j}: el real perdió ${r8(pedido.cantidad - real)}`).toBe(true);
        if (r8(pedido.cantidad - ref) >= 0.00005) perdidasEnLaReferencia++;
      }
    }
    expect(perdidasEnLaReferencia, "el generador tiene que ejercitar el caso que el PR arregla").toBeGreaterThan(0);
  });
});
