import type { Prisma, PrismaClient } from "@prisma/client";
import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE } from "./acciones";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Equivalente directo de sucursalTieneCapacidad_ (Sucursales.js:616-628).
 * Gate de RED (aplica a cualquier usuario/rol de esa sucursal), previo al
 * de rol — la Central puede deshabilitar una acción entera para una
 * sucursal completa.
 *
 * Antes eran hasta 2 round-trips secuenciales (fila específica, y solo si
 * no existía, la fila default) — acá es 1 sola consulta que trae ambas
 * candidatas de una (a lo sumo 2 filas) y elige en JS. Esta función se
 * llama en cada `requierePermiso`/`requierePermisoVer`, o sea en casi
 * toda página — con Neon, cada round-trip menos importa.
 */
export async function sucursalTieneCapacidad(
  sucursalId: string,
  accionClave: string,
  db: Db
): Promise<boolean> {
  // Auto-protección (Sucursales.js:618): la matriz de capacidades nunca
  // puede autobloquearse, si no la Central podría quedar sin forma de
  // volver a habilitar algo que deshabilitó por error. Mismo criterio se
  // extiende a gestion_usuarios/gestion_permisos (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE,
  // acciones.ts): esta capa se evalúa ANTES que el permiso de rol
  // (ver gate.ts), así que sin esto un admin podía lograr acá exactamente
  // lo que esa otra protección ya existe para evitar — dejar a todo el
  // mundo, en todas las sucursales, sin forma de entrar a Usuarios/Permisos.
  if (esCapacidadSiempreHabilitada(accionClave)) return true;

  const candidatas = await db.capacidadSucursal.findMany({
    where: { accionClave, OR: [{ sucursalId }, { sucursalId: null }] },
  });

  return resolverCapacidad(candidatas, sucursalId);
}

/**
 * Qué acciones (de una lista) tiene habilitadas una sucursal, con UNA consulta en vez de una por acción — para armar el menú.
 * Misma regla que `sucursalTieneCapacidad` (que la comparte vía `resolverCapacidad`).
 */
export async function capacidadesDeSucursal(
  sucursalId: string,
  claves: readonly string[],
  db: Db
): Promise<Set<string>> {
  const candidatas = await db.capacidadSucursal.findMany({
    where: { accionClave: { in: [...claves] }, OR: [{ sucursalId }, { sucursalId: null }] },
  });
  const habilitadas = new Set<string>();
  for (const clave of claves) {
    if (esCapacidadSiempreHabilitada(clave) || resolverCapacidad(candidatas.filter((c) => c.accionClave === clave), sucursalId)) habilitadas.add(clave);
  }
  return habilitadas;
}

function esCapacidadSiempreHabilitada(accionClave: string): boolean {
  return accionClave === "capacidades_sucursal" || (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE as readonly string[]).includes(accionClave);
}

/** Regla de una acción, dadas sus filas candidatas (la de la sucursal y/o la «default»). */
function resolverCapacidad(candidatas: Array<{ sucursalId: string | null; habilitado: boolean }>, sucursalId: string): boolean {
  const especifica = candidatas.find((c) => c.sucursalId === sucursalId);
  if (especifica) return especifica.habilitado;

  // Fila "default" (sucursalId NULL) — a lo sumo una por acción, lo
  // garantiza un índice único parcial en la migración (Postgres no lo
  // garantiza solo con una columna nullable dentro de un @@unique
  // compuesto).
  const porDefecto = candidatas.find((c) => c.sucursalId === null);

  // Sin ninguna fila configurada = habilitado (Sucursales.js:621: "si no
  // hay fila para esta acción, se puede").
  return porDefecto ? porDefecto.habilitado : true;
}
