import { vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prismaSinEmpresa } from "./test-db";

/**
 * Observa CON QUÉ ALCANCE POR SUCURSAL corre cada operación de empresa del código bajo prueba (P2 del Paquete 1: la lectura de verificación). Hoy la base no tiene políticas por sucursal, así que una lectura
 * ensanchada y una que no lo está devuelven lo mismo; lo que sí se puede medir es qué `app.sucursales_lectura` y `app.sucursales_escritura` fijó el código antes de cada operación. Con las políticas puestas, ese
 * alcance es lo que decide qué filas ve (lo prueba `test/aislamiento/lectura-de-verificacion-con-politicas.test.ts` contra una base temporal con las políticas del generador).
 *
 * Mide las dos formas en que `src/server/sesion/base.ts` fija el alcance:
 *  - una operación suelta de `ctx.db` (`dbDeEmpresa`): un `set_config(…)` por operación, con `prisma.$executeRaw` (se lee de los argumentos de la llamada);
 *  - una transacción interactiva (`ctx.transaccion`, `transaccionDeEmpresa`): las variables que quedaron fijadas al terminar el cuerpo (la lista que vio todo su cuerpo).
 * Hay que llamar a `restaurar()` al terminar (los espías se sacan también con `vi.restoreAllMocks()`).
 */
export interface AlcanceObservado {
  lectura: string[];
  escritura: string[];
}

const lista = (v: string | null | undefined): string[] => (v ? v.split(",").sort() : []);

export function observarAlcances() {
  const deTransacciones: AlcanceObservado[] = [];
  const sql = vi.spyOn(prismaSinEmpresa, "$executeRaw");
  const original = prismaSinEmpresa.$transaction.bind(prismaSinEmpresa) as (...args: unknown[]) => Promise<unknown>;
  const transacciones = vi.spyOn(prismaSinEmpresa, "$transaction").mockImplementation(((fn: unknown, opciones?: unknown) => {
    if (typeof fn !== "function") return original(fn, opciones);
    return original(async (tx: Prisma.TransactionClient) => {
      const resultado = await (fn as (t: Prisma.TransactionClient) => Promise<unknown>)(tx);
      const [fila] = await tx.$queryRaw<{ lectura: string | null; escritura: string | null }[]>`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;
      deTransacciones.push({ lectura: lista(fila?.lectura), escritura: lista(fila?.escritura) });
      return resultado;
    }, opciones);
  }) as never);

  const deOperaciones = (): AlcanceObservado[] =>
    sql.mock.calls
      .filter((llamada) => (llamada[0] as unknown as readonly string[]).join("").includes("app.sucursales_lectura"))
      .map((llamada) => ({ lectura: lista(llamada[2] as string), escritura: lista(llamada[3] as string) }));

  return {
    /** Todos los alcances con que corrió algo desde que se empezó a observar (operaciones sueltas y transacciones). */
    vistos: (): AlcanceObservado[] => [...deOperaciones(), ...deTransacciones],
    /** Solo las transacciones interactivas (`ctx.transaccion`), con el alcance que vio todo su cuerpo. */
    transacciones: (): AlcanceObservado[] => [...deTransacciones],
    /** Borra lo observado hasta ahora (para medir solo lo que sigue). */
    limpiar() {
      sql.mockClear();
      deTransacciones.length = 0;
    },
    restaurar() {
      sql.mockRestore();
      transacciones.mockRestore();
    },
  };
}

/** ¿Es el mismo conjunto de ids (sin importar el orden)? */
const mismosIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/** Las operaciones que leyeron TODAS las sucursales de la empresa (`todas`) sin escribir en ninguna más que las de `escritura`: la marca de una lectura de verificación. */
export const deVerificacion = (vistos: readonly AlcanceObservado[], todas: readonly string[], escritura: readonly string[]): AlcanceObservado[] =>
  vistos.filter((v) => mismosIds(v.lectura, todas) && mismosIds(v.escritura, escritura));

/** Las operaciones que escribieron en alguna sucursal de más que las de `escritura` (un ensanche de escritura): una lectura de verificación nunca tiene que producir una. Las que no fijan ninguna (el gate, el login) no cuentan. */
export const conEscrituraMasAnchaQue = (vistos: readonly AlcanceObservado[], escritura: readonly string[]): AlcanceObservado[] => vistos.filter((v) => v.escritura.some((id) => !escritura.includes(id)));
