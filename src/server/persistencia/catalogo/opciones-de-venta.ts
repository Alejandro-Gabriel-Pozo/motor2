import "server-only";
import type { Prisma } from "@prisma/client";
import type { TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Escrituras del CATÁLOGO DE OPCIONES DE VENTA (GO-2a; ADR-030). Mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro (siempre el `tx` de la
 * transacción SERIALIZABLE del caso de uso), `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso, con el mismo `tx`).
 *
 * - Nunca DELETE (la app tampoco tiene el GRANT): la baja es desactivar. Versiones y consumos SOLO se agregan.
 * - Las ediciones son OPTIMISTAS en la base (defensa doble con la relectura del caso de uso): `updateMany({ where: { id, version: esperada } })` sube la `version` en 1 y devuelve
 *   cuántas filas tocó; 0 = otra persona la cambió en el medio (`VERSION_DESACTUALIZADA`). Solo se escriben las columnas con GRANT de UPDATE (nunca el tipo, el grupo, el ancla ni «ninguna»).
 * - `actualizadoEn` y `creadoEn` llevan la hora del pedido (`ahora`, el reloj inyectado del contexto), no la de la base.
 */

type Tx = Prisma.TransactionClient;

// ───────────────────────────── Grupos ─────────────────────────────

export async function crearGrupoDeOpciones(
  tx: Tx,
  args: { nombre: string; tipo: TipoDeGrupoDeOpciones; cantidadMinima: number; cantidadMaxima: number; ahora: Date }
): Promise<{ id: string }> {
  return tx.grupoDeOpciones.create({
    data: { nombre: args.nombre, tipo: args.tipo, cantidadMinima: args.cantidadMinima, cantidadMaxima: args.cantidadMaxima, creadoEn: args.ahora, actualizadoEn: args.ahora },
    select: { id: true },
  });
}

/** Devuelve cuántas filas tocó: 0 si la versión ya no es la esperada. */
export async function actualizarGrupoDeOpciones(
  tx: Tx,
  args: { id: string; versionEsperada: number; nombre: string; cantidadMinima: number; cantidadMaxima: number; activo: boolean; ahora: Date }
): Promise<number> {
  const { count } = await tx.grupoDeOpciones.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { nombre: args.nombre, cantidadMinima: args.cantidadMinima, cantidadMaxima: args.cantidadMaxima, activo: args.activo, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}
