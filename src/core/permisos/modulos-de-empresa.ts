import type { Prisma, PrismaClient } from "@prisma/client";
import { cache } from "react";
import { moduloDelCatalogo, type ModuloId } from "../modulos/catalogo";
import { modulosEfectivos } from "../modulos/clausura";
import { moduloDeAccion, type AccionClave } from "./acciones";
import type { Denegacion } from "./motivos";

type Db = PrismaClient | Prisma.TransactionClient;

// Lector del registro de módulos de una empresa para el guard y el menú (ADR-011, bloque 5A, P7). Es el ÚNICO archivo que consulta
// `ModuloEmpresa` (un test lo exige): guard y menú salen de aquí, así no pueden discrepar.
//
// Si la tabla no existe (migración sin aplicar) la consulta TIRA el error: «sin tabla» nunca se confunde con «empresa sin módulos», que dejaría
// a todos con solo Administración. `cache` de React memoiza por pedido (mismos argumentos, mismo objeto `db`); fuera de un pedido de Next no
// memoiza, y es lo que se quiere en los tests.

/** Los módulos con que cuenta la empresa: Administración, los vendibles ACTIVO del registro y todo lo que ellos requieren. */
export const modulosEfectivosDeEmpresa = cache(async (empresaId: string, db: Db): Promise<ReadonlySet<string>> => {
  const filas = await db.moduloEmpresa.findMany({ where: { empresaId, estado: "ACTIVO" }, select: { modulo: true } });
  return modulosEfectivos(filas.map((f) => f.modulo));
});

/** Por qué el módulo no está disponible, o null si lo está. Un módulo `en_desarrollo` se distingue de uno simplemente apagado. */
export function denegacionDeModulo(modulo: ModuloId, efectivos: ReadonlySet<string>): Denegacion | null {
  if (efectivos.has(modulo)) return null;
  return { motivo: moduloDelCatalogo(modulo).estado === "en_desarrollo" ? "MODULO_EN_DESARROLLO" : "MODULO_NO_ACTIVO", modulo };
}

/** Si la acción es de un módulo que la empresa no tiene, la denegación. Administración (fija) se resuelve sin leer la tabla. */
export async function denegacionDeModuloDeAccion(accion: AccionClave, empresaId: string, db: Db): Promise<Denegacion | null> {
  const modulo = moduloDeAccion(accion);
  if (moduloDelCatalogo(modulo).tipo === "fijo") return null;
  return denegacionDeModulo(modulo, await modulosEfectivosDeEmpresa(empresaId, db));
}

/** ¿Alguna de estas acciones necesita leer el registro? Falso si todas son de Administración. */
export function algunaAccionNecesitaElRegistro(claves: readonly AccionClave[]): boolean {
  return claves.some((c) => moduloDelCatalogo(moduloDeAccion(c)).tipo !== "fijo");
}
