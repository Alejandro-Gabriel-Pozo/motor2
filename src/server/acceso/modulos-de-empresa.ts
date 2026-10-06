import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { cache } from "react";
import { moduloDelCatalogo } from "@/core/modulos/catalogo";
import { moduloDeAccion, type AccionClave } from "@/core/permisos/acciones";
import { denegacionDeModulo, modulosEfectivosDeFilas, situacionDelRegistro, type SituacionDelRegistro } from "@/core/permisos/modulo-de-la-accion";
import type { Denegacion } from "@/core/permisos/motivos";

type Db = PrismaClient | Prisma.TransactionClient;

// Lector del registro de módulos de una empresa para el guard y el menú (ADR-011, bloque 5A, P7). Es el ÚNICO archivo que consulta
// `ModuloEmpresa` (un test lo exige): guard y menú salen de aquí, así no pueden discrepar. Lo PURO (qué módulos tiene una empresa dadas sus filas, si una acción
// es de un módulo que no tiene) vive en `modulo-de-la-accion.ts` (Pureza Fase 3, tramo B).
//
// Si la tabla no existe (migración sin aplicar) la consulta TIRA el error: «sin tabla» nunca se confunde con «empresa sin módulos», que dejaría
// a todos con solo Administración. `cache` de React memoiza por pedido (mismos argumentos, mismo objeto `db`); fuera de un pedido de Next no
// memoiza, y es lo que se quiere en los tests.

// Una sola consulta por pedido: el guard, el menú y el aviso del shell leen las filas de la empresa (a lo sumo una por módulo vendible).
const filasDelRegistro = cache(async (empresaId: string, db: Db) => db.moduloEmpresa.findMany({ where: { empresaId }, select: { modulo: true, estado: true } }));

/** Los módulos con que cuenta la empresa: Administración, los vendibles ACTIVO del registro y todo lo que ellos requieren. */
export const modulosEfectivosDeEmpresa = cache(async (empresaId: string, db: Db): Promise<ReadonlySet<string>> => modulosEfectivosDeFilas(await filasDelRegistro(empresaId, db)));

/** Cómo está el registro de la empresa, para el aviso del shell (P8). */
export async function situacionDelRegistroDeModulos(empresaId: string, db: Db): Promise<SituacionDelRegistro> {
  const filas = await filasDelRegistro(empresaId, db);
  return situacionDelRegistro(filas.length, filas.length === 0 ? new Set() : await modulosEfectivosDeEmpresa(empresaId, db));
}

/** Si la acción es de un módulo que la empresa no tiene, la denegación. Administración (fija) se resuelve sin leer la tabla. */
export async function denegacionDeModuloDeAccion(accion: AccionClave, empresaId: string, db: Db): Promise<Denegacion | null> {
  const modulo = moduloDeAccion(accion);
  if (moduloDelCatalogo(modulo).tipo === "fijo") return null;
  return denegacionDeModulo(modulo, await modulosEfectivosDeEmpresa(empresaId, db));
}
