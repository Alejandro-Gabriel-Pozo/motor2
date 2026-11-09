import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * El nombre, TAL COMO ESTÁ GUARDADO, del OTRO proveedor de la empresa (el RLS acota a la empresa activa) que ya se llama así, o `null`. El criterio es el del alta
 * (`altaProveedorCasoDeUso`): SIN distinguir mayúsculas de minúsculas (`mode: "insensitive"`); las tildes SÍ distinguen («Luz» y «Luz S.A.» son nombres distintos, «Cafe» y «Café» también).
 * `excluirId` es el proveedor que se está editando: cambiar solo las mayúsculas de su propio nombre («EDENOR» → «Edenor») no choca consigo mismo. La usa la edición antes de escribir
 * y, si el índice único `(empresaId, nombre)` frena una carrera, otra vez para nombrar al otro.
 */
export async function proveedorConNombre(db: Db, nombre: string, excluirId: string): Promise<string | null> {
  return (await db.proveedor.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, id: { not: excluirId } }, select: { nombre: true } }))?.nombre ?? null;
}
