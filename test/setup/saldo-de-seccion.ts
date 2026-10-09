import type { Prisma, PrismaClient } from "@prisma/client";
import { calcularSaldoPorLote as saldoPorLoteDeSucursal, calcularSaldoTotal as saldoTotalDeSucursal } from "../../src/server/lecturas/movimientos/saldos";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Los lectores del saldo FALLAN CERRADO por sucursal (`calcularSaldoTotal` / `calcularSaldoPorLote` exigen la `sucursalId` del contexto y solo
 * suman la sección si es de ella). Los tests de integración que solo quieren «¿cuánto hay en esta sección?» no tienen contexto: estos
 * envoltorios toman la sucursal DE LA SECCIÓN (una lectura del test, no de la función) y llaman a la función real, así que siguen probando
 * el código de producción. Lo que se prueba contra una sección de OTRA sucursal está en `test/stock/saldos-por-sucursal.test.ts`.
 */
async function sucursalDeLaSeccion(seccionId: string, db: Db): Promise<string> {
  return (await db.seccion.findUniqueOrThrow({ where: { id: seccionId }, select: { sucursalId: true } })).sucursalId;
}

export async function calcularSaldoTotal(productoId: string, seccionId: string, db: Db): Promise<number> {
  return saldoTotalDeSucursal(productoId, seccionId, await sucursalDeLaSeccion(seccionId, db), db);
}

export async function calcularSaldoPorLote(productoId: string, seccionId: string, loteVencimiento: Date | null, db: Db): Promise<number> {
  return saldoPorLoteDeSucursal(productoId, seccionId, loteVencimiento, await sucursalDeLaSeccion(seccionId, db), db);
}
