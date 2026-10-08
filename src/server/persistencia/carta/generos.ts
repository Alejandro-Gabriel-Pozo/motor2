import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los GÉNEROS de la carta (`GeneroCarta`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de `server/persistencia/`: el
 * cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las tres escrituras que antes hacía en línea
 * `src/server/actions/carta/generos.ts`; las llaman solo los casos de uso `guardar-genero-carta.ts` y `actualizar-activo-genero-carta.ts` de
 * `src/server/actions/carta/casos-de-uso/`, con la base del contexto y sin transacción, como antes (un género es una carpeta visual: sin auditoría).
 */

/** Da de alta un género PROPIO de la sucursal. Devuelve su id y el nombre que quedó guardado. */
export async function crearGeneroDeCarta(db: Prisma.TransactionClient, args: { sucursalId: string; nombre: string; orden: number }): Promise<{ id: string; nombre: string }> {
  const g = await db.generoCarta.create({ data: { sucursalId: args.sucursalId, nombre: args.nombre, orden: args.orden } });
  return { id: g.id, nombre: g.nombre };
}

/** Cambia el nombre y el orden de un género existente. Devuelve su id y el nombre que quedó guardado. */
export async function cambiarDatosDeGeneroCarta(db: Prisma.TransactionClient, args: { id: string; nombre: string; orden: number }): Promise<{ id: string; nombre: string }> {
  const g = await db.generoCarta.update({ where: { id: args.id }, data: { nombre: args.nombre, orden: args.orden } });
  return { id: g.id, nombre: g.nombre };
}

/** Apaga o prende un género (nunca se borra: apagado deja de mostrarse como carpeta y lo que tenía ese género queda suelto). */
export async function fijarActivoDeGeneroCarta(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.generoCarta.update({ where: { id: args.id }, data: { activo: args.activo } });
}
