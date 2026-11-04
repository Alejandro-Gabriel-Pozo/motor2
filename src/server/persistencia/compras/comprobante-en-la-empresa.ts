import "server-only";
import type { Prisma } from "@prisma/client";
import { normalizarNumeroDeComprobante } from "@/core/compras/public";
import { escaparComodinesLike } from "@/core/texto";

/**
 * ¿Ya hay un comprobante VIGENTE de ese proveedor con ese número en CUALQUIER sucursal de la empresa? (etapa 1 de Compras, I2; docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md §5.1). Mira las dos
 * tablas donde puede estar: la cabecera de una factura de proveedor repartida (`FacturaProveedor`, de la empresa) y la compra simple (`Operacion` COMPRA, por sucursal). La clave es el número normalizado
 * (`normalizarNumeroDeComprobante`): «A-23-237728» y «A-00023-00237728» son el mismo comprobante. Las compras viejas con texto libre no se tocan (I15): se comparan normalizando al leer.
 *
 * `tx` TIENE que llegar abierta con la base de verificación (`lecturaDeVerificacionEnLaEmpresa(...).transaccion`): con la lectura de una sola sucursal la compra de otra no se vería. Devuelve SOLO sí/no: nunca
 * datos de otra sucursal (ni cuál, ni cuándo).
 *
 * Cerrojo + SERIALIZABLE: primero toma un cerrojo de la transacción por empresa + proveedor + número (`pg_advisory_xact_lock`, como `cupoDeCorreoDeEmpresa`), así dos cargas del mismo número a la vez se turnan. Como la
 * transacción es SERIALIZABLE su foto se toma en la primera sentencia, ANTES del cerrojo: la segunda no ve a la primera aunque haya esperado, pero choca por serialización (P2034) al confirmar y
 * `conTransaccionSerializable` la reintenta con una foto nueva, y ahí SÍ ve el comprobante de la primera. El índice único de cada tabla queda como segunda barrera dentro de su alcance.
 *
 * `excluirOperacionId`: la compra que se está corrigiendo no cuenta contra sí misma.
 */
export async function hayComprobanteVigenteEnLaEmpresa(
  tx: Prisma.TransactionClient,
  args: { empresaId: string; proveedorId: string; nroFactura: string; excluirOperacionId?: string }
): Promise<boolean> {
  const clave = normalizarNumeroDeComprobante(args.nroFactura);
  await tx.$queryRaw`SELECT 1 AS tomado FROM (SELECT pg_advisory_xact_lock(hashtext(${`comprobante:${args.empresaId}:${args.proveedorId}:${clave}`}))) AS cerrojo`;

  const factura = await tx.facturaProveedor.count({ where: { proveedorId: args.proveedorId, nroFacturaNormalizado: clave, anuladaEn: null } });
  if (factura > 0) return true;

  // Para no traer todas las compras del proveedor: las que contienen el último grupo de dígitos del número (sin ceros a la izquierda); la comparación exacta se hace acá, normalizando cada una.
  const ultimoGrupo = (clave.match(/\d+/g) ?? []).at(-1);
  const candidatas = await tx.operacion.findMany({
    where: {
      proceso: "COMPRA",
      proveedorId: args.proveedorId,
      anuladaEn: null,
      nroFactura: ultimoGrupo ? { contains: escaparComodinesLike(ultimoGrupo) } : { not: null },
      ...(args.excluirOperacionId ? { id: { not: args.excluirOperacionId } } : {}),
    },
    select: { nroFactura: true },
  });
  return candidatas.some((c) => c.nroFactura !== null && normalizarNumeroDeComprobante(c.nroFactura) === clave);
}
