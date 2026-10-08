import "server-only";
import type { MagnitudUnidad, Prisma } from "@prisma/client";

/**
 * Escrituras de las UNIDADES DE MEDIDA (`Unidad`; Hito 4 de la pureza, bloque 4.3, paso H4C-8 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las tres escrituras que antes hacía en línea
 * `src/server/actions/catalogo/unidades.ts`; las llaman los casos de uso `crear-unidad.ts`, `actualizar-activa-unidad.ts` y `actualizar-decimales-unidad.ts`.
 *
 * Los decimales de una unidad son una «columna de significado» (`escrituras-auditadas.test.ts`: fijan la precisión de toda cantidad que la use). Su CAMBIO lo
 * audita el caso de uso que llama a `fijarDecimalesDeUnidad`, en la misma transacción; el ALTA (`crearUnidadNueva`) no se audita por diseño (no hay valor anterior
 * ni cantidades que ya dependan de ella): es la excepción `persistencia/catalogo/unidades.ts|crearUnidadNueva` de ese test, que antes era `crearUnidad` de la acción.
 */

/** Crea la unidad (nombre ya validado, decimales ya resueltos). Devuelve el id y el nombre guardado. */
export async function crearUnidadNueva(
  db: Prisma.TransactionClient,
  args: { nombre: string; magnitud: MagnitudUnidad; decimales: number },
): Promise<{ id: string; nombre: string }> {
  const creada = await db.unidad.create({ data: { nombre: args.nombre, magnitud: args.magnitud, decimales: args.decimales } });
  return { id: creada.id, nombre: creada.nombre };
}

/** Activa o desactiva la unidad. Un id que no existe hace lanzar a Prisma (como antes). */
export async function fijarActivaDeUnidad(db: Prisma.TransactionClient, args: { id: string; activa: boolean }): Promise<void> {
  await db.unidad.update({ where: { id: args.id }, data: { activa: args.activa } });
}

/** Cambia los decimales de la unidad. La llama el caso de uso dentro de su transacción, junto con su fila de auditoría. */
export async function fijarDecimalesDeUnidad(db: Prisma.TransactionClient, args: { id: string; decimales: number }): Promise<void> {
  await db.unidad.update({ where: { id: args.id }, data: { decimales: args.decimales } });
}
