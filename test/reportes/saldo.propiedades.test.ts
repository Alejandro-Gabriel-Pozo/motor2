import { beforeAll, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/server/lecturas/movimientos/saldos";
import { obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";
import { limitadorMutaciones } from "../../src/server/actions/limitador-de-mutaciones";
import { prisma } from "../setup/test-db";

/**
 * Property-based testing (Task #41, Fase F4): la vista de historial de un producto (`obtenerHistorialProducto`, saldo
 * corriente acumulado línea por línea en JS) y el cálculo directo de saldo (`calcularSaldoTotal`, un SUM en Postgres)
 * nunca pueden discrepar, para CUALQUIER secuencia de movimientos con signo.
 *
 * Lo que el código REALMENTE garantiza (y por eso se afirma así, no como "igualdad exacta de números"):
 *  - Solo cuentan los movimientos que `registrarMovimiento` ACEPTÓ: una salida (MERMA, o AJUSTE negativo) que supera el
 *    saldo de ese momento se rechaza por `validarStockSuficiente` y no escribe nada. El modelo lo replica.
 *  - `saldoCorriente` y `saldoActual` pasan por `redondearCantidad` (3 decimales); `calcularSaldoTotal` NO redondea. Por
 *    eso las cantidades se generan en centésimas (la unidad `kg` de `sembrarCatalogoBase` admite 2 decimales, así
 *    `redondearACantidadDeUnidad` no altera nada) y el modelo lleva la cuenta en enteros (centésimas), sin float.
 *  - Con fechas iguales el orden entre movimientos del mismo instante no está garantizado (sort estable sobre un
 *    findMany sin ORDER BY): ahí solo el saldo FINAL es invariante. Con fechas estrictamente crecientes, además, cada
 *    fila tiene que ser la suma de prefijo del modelo.
 */

type Paso = { proceso: "COMPRA" | "MERMA" | "AJUSTE"; centesimas: number };

// COMPRA/MERMA: magnitud positiva (el motor le pone el signo). AJUSTE: delta YA con signo, nunca 0 (un ajuste en 0 no
// mueve el saldo y complica el conteo de filas sin aportar nada a la propiedad).
const arbPaso: fc.Arbitrary<Paso> = fc.oneof(
  // COMPRA con peso doble: sin entradas casi toda salida se rechaza y la secuencia no ejercita saldos distintos de 0.
  { weight: 2, arbitrary: fc.record({ proceso: fc.constant("COMPRA" as const), centesimas: fc.integer({ min: 1, max: 50_000 }) }) },
  { weight: 1, arbitrary: fc.record({ proceso: fc.constant("MERMA" as const), centesimas: fc.integer({ min: 1, max: 50_000 }) }) },
  { weight: 1, arbitrary: fc.record({ proceso: fc.constant("AJUSTE" as const), centesimas: fc.integer({ min: -50_000, max: 50_000 }).filter((n) => n !== 0) }) }
);

const deltaConSigno = (p: Paso) => (p.proceso === "MERMA" ? -p.centesimas : p.centesimas);
const aCentesimas = (n: number) => Math.round(n * 100);

// Con Postgres real cada corrida escribe hasta 12 operaciones: numRuns bajo (20 por propiedad, ~2-3s el archivo entero
// contra Postgres local) para no inflar `npm test` (presupuesto compartido de Fase F). Si algo falla, fast-check
// reporta `seed`/`path` para reproducirlo.
const NUM_RUNS = 20;

describe("propiedad: historial de producto vs. calcularSaldoTotal", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let corrida = 0;

  beforeAll(async () => {
    // Las dos propiedades juntas pueden superar las 300 mutaciones/min del limitador (según la semilla, con el shrinking de
    // fast-check incluido) y rechazar una acción legítima: intermitente. Acá el límite no es lo que se prueba.
    vi.spyOn(limitadorMutaciones, "excedeLimite").mockReturnValue(false);
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin-prop@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  // Un producto NUEVO por corrida: cada secuencia arranca de saldo 0 sin limpiar la base entera.
  async function productoNuevo() {
    corrida++;
    const p = await sembrarProductoDisponible({ codigo: `MP_PROP_${corrida}`, nombre: `Propiedad ${corrida}`, tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    return p.id;
  }

  /** Escribe la secuencia y devuelve el saldo del modelo (centésimas) después de cada paso ACEPTADO. */
  async function aplicar(productoId: string, pasos: Paso[], fechaDe: (i: number) => Date) {
    let saldoModelo = 0;
    const prefijosAceptados: number[] = [];
    for (const [i, paso] of pasos.entries()) {
      const delta = deltaConSigno(paso);
      const debeAceptarse = delta > 0 || saldoModelo >= -delta;
      const r = await registrarMovimiento({ proceso: paso.proceso, fecha: fechaDe(i), seccionId, items: [{ productoId, cantidad: paso.centesimas / 100 }] });
      expect(r.ok, `${paso.proceso} ${paso.centesimas / 100} con saldo ${saldoModelo / 100}: ${r.mensaje}`).toBe(debeAceptarse);
      if (r.ok) {
        saldoModelo += delta;
        prefijosAceptados.push(saldoModelo);
      }
    }
    return { saldoModelo, prefijosAceptados };
  }

  it("fechas estrictamente crecientes: calcularSaldoTotal = suma con signo, y cada saldoCorriente = suma de prefijo (el último = saldoActual)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbPaso, { minLength: 1, maxLength: 12 }), async (pasos) => {
        const productoId = await productoNuevo();
        const { saldoModelo, prefijosAceptados } = await aplicar(productoId, pasos, (i) => new Date(Date.UTC(2026, 0, 1 + i)));

        const saldoDirecto = await calcularSaldoTotal(productoId, seccionId, prisma);
        expect(aCentesimas(saldoDirecto)).toBe(saldoModelo);

        const historial = await obtenerHistorialProducto(sucursalId, productoId, seccionId, undefined, undefined, prisma);
        const filas = historial!.eventos.filter((e) => e.tipo === "movimiento");
        expect(filas.map((f) => aCentesimas(f.saldoCorriente!))).toEqual(prefijosAceptados);
        expect(historial!.totalMovimientos).toBe(prefijosAceptados.length);
        expect(aCentesimas(historial!.saldoActual)).toBe(saldoModelo);
        // La vista y el cálculo directo NUNCA discrepan (con historial vacío, ambos son 0).
        expect(filas.at(-1)?.saldoCorriente ?? 0).toBe(historial!.saldoActual);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("todas las fechas iguales (orden entre empates no garantizado): el saldoCorriente FINAL igual coincide con calcularSaldoTotal", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbPaso, { minLength: 1, maxLength: 12 }), async (pasos) => {
        const productoId = await productoNuevo();
        const fecha = new Date(Date.UTC(2026, 5, 15));
        const { saldoModelo, prefijosAceptados } = await aplicar(productoId, pasos, () => fecha);

        const saldoDirecto = await calcularSaldoTotal(productoId, seccionId, prisma);
        expect(aCentesimas(saldoDirecto)).toBe(saldoModelo);

        const historial = await obtenerHistorialProducto(sucursalId, productoId, seccionId, undefined, undefined, prisma);
        const filas = historial!.eventos.filter((e) => e.tipo === "movimiento");
        expect(filas).toHaveLength(prefijosAceptados.length);
        expect(aCentesimas(filas.at(-1)?.saldoCorriente ?? 0)).toBe(aCentesimas(saldoDirecto));
        expect(filas.at(-1)?.saldoCorriente ?? 0).toBe(historial!.saldoActual);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
