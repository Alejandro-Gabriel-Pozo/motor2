import type { Prisma, PrismaClient } from "@prisma/client";
import { armarTemaCarta, type TemaCartaV1 } from "./tema";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de LECTURA del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M4), separada de `tema.ts` (puro) igual que
 * `registro-consulta.ts` de `registro-tenants.ts`. NUNCA ESCRIBE (lo fija test/arquitectura/carta-solo-lectura.test.ts).
 *
 * Una sola consulta: la fila de `TemaCartaSucursal` de la sucursal, con su estado de activa. Devuelve `null` (→ 404 en el
 * endpoint, y la carta sigue con la tab Config de la sheet) si no hay fila, si el tema no está aplicado (`aplicarEnCarta`
 * false = borrador) o si la sucursal está inactiva. Si no, `armarTemaCarta`, que vuelve a validar cada valor del Json.
 */
export async function resolverTemaCarta(sucursalId: string, db: Db, ahora: Date = new Date()): Promise<TemaCartaV1 | null> {
  const fila = await db.temaCartaSucursal.findFirst({
    where: { sucursalId },
    select: { valores: true, aplicarEnCarta: true, actualizadoEn: true, sucursal: { select: { id: true, activo: true } } },
  });
  if (!fila || !fila.aplicarEnCarta || !fila.sucursal.activo) return null;
  return armarTemaCarta({ sucursalId: fila.sucursal.id, valores: fila.valores, actualizadoEn: fila.actualizadoEn }, ahora);
}
