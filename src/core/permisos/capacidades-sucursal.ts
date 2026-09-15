import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Equivalente directo de sucursalTieneCapacidad_ (Sucursales.js:616-628).
 * Gate de RED (aplica a cualquier usuario/rol de esa sucursal), previo al
 * de rol — la Central puede deshabilitar una acción entera para una
 * sucursal completa.
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

  const especifica = await db.capacidadSucursal.findUnique({
    where: { accionClave_sucursalId: { accionClave, sucursalId } },
  });
  if (especifica) return especifica.habilitado;

  // Fila "default" (sucursalId NULL) — usar findFirst, no findUnique: la
  // unicidad de "como máximo una fila default por acción" la garantiza un
  // índice único parcial en la migración (Postgres no la garantiza sola
  // sobre una columna nullable dentro de un @@unique compuesto).
  const porDefecto = await db.capacidadSucursal.findFirst({
    where: { accionClave, sucursalId: null },
  });

  // Sin ninguna fila configurada = habilitado (Sucursales.js:621: "si no
  // hay fila para esta acción, se puede").
  return porDefecto ? porDefecto.habilitado : true;
}
