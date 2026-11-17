import { prismaAdmin } from "../setup/test-db";

/**
 * Para armar el caso «dos o más cuentas activas compatibles en una sucursal» (que la regla C3b, `CuentaDeCobro_una_activa_por_sucursal_key`, impide con datos nuevos pero la etapa P-C3 tiene que resolver para datos
 * anteriores a C3b): se quita el índice DENTRO de la prueba y se restituye SIEMPRE (`afterAll`/`finally`) con la MISMA definición de la migración 20261117118100_caja_c3b_una_cuenta_por_sucursal.
 * Los tests de Vitest de este repo corren en serie (`fileParallelism: false`), así que nadie más ve la base sin el índice.
 */
const NOMBRE = "CuentaDeCobro_una_activa_por_sucursal_key";

export async function quitarIndiceDeUnaActiva(): Promise<void> {
  await prismaAdmin.$executeRawUnsafe(`DROP INDEX IF EXISTS "${NOMBRE}"`);
}

/** Restituye el índice con la definición de la migración. Si quedaron dos activas en una sucursal (resto de una prueba caída), deja activa solo una por (empresa, sucursal) para poder crearlo. */
export async function restituirIndiceDeUnaActiva(): Promise<void> {
  await prismaAdmin.$executeRawUnsafe(
    `UPDATE "CuentaDeCobro" c SET "activa" = false WHERE c."activa" AND c."id"::text <> (SELECT min(o."id"::text) FROM "CuentaDeCobro" o WHERE o."activa" AND o."empresaId" = c."empresaId" AND o."sucursalId" = c."sucursalId")`,
  );
  await prismaAdmin.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "${NOMBRE}" ON "CuentaDeCobro"("empresaId", "sucursalId") WHERE "activa"`);
}
