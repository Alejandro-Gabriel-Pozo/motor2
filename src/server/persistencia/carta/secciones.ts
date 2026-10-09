import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de las SECCIONES de la carta (`SeccionCarta`; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1; mismo contrato que el resto de
 * `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las tres escrituras que antes hacía en línea
 * `src/server/actions/carta/secciones.ts`; las llaman solo los casos de uso `guardar-seccion-carta.ts` y `actualizar-activa-seccion-carta.ts` de
 * `src/server/actions/carta/casos-de-uso/`, con la base del contexto y sin transacción, como antes (una sección no es plata: sin auditoría).
 */

/** Los campos editables de una sección (siempre todos, alta y edición). */
interface DatosDeSeccionCarta {
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
}

/** Da de alta una sección de la empresa. Devuelve su id y el nombre que quedó guardado. */
export async function crearSeccionDeCarta(db: Prisma.TransactionClient, args: DatosDeSeccionCarta): Promise<{ id: string; nombre: string }> {
  const s = await db.seccionCarta.create({
    data: { nombre: args.nombre, titulo: args.titulo, descripcion: args.descripcion, imagenUrl: args.imagenUrl, orden: args.orden },
  });
  return { id: s.id, nombre: s.nombre };
}

/** Cambia los campos de una sección existente. Devuelve su id y el nombre que quedó guardado. */
export async function cambiarDatosDeSeccionCarta(db: Prisma.TransactionClient, args: DatosDeSeccionCarta & { id: string }): Promise<{ id: string; nombre: string }> {
  const s = await db.seccionCarta.update({
    where: { id: args.id },
    data: { nombre: args.nombre, titulo: args.titulo, descripcion: args.descripcion, imagenUrl: args.imagenUrl, orden: args.orden },
  });
  return { id: s.id, nombre: s.nombre };
}

/** Apaga o prende una sección (nunca se borra: apagada deja de salir en la carta con todo lo suyo). */
export async function fijarActivaDeSeccionCarta(db: Prisma.TransactionClient, args: { id: string; activa: boolean }): Promise<void> {
  await db.seccionCarta.update({ where: { id: args.id }, data: { activa: args.activa } });
}
