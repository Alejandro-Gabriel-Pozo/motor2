import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

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
  db: PrismaClient = prisma
): Promise<boolean> {
  // Auto-protección (Sucursales.js:618): la matriz de capacidades nunca
  // puede autobloquearse, si no la Central podría quedar sin forma de
  // volver a habilitar algo que deshabilitó por error.
  if (accionClave === "capacidades_sucursal") return true;

  const candidatas = await db.capacidadSucursal.findMany({
    where: { accionClave, OR: [{ sucursalId }, { sucursalId: null }] },
  });

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
