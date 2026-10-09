import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los catálogos MOTIVO DE MERMA y DESTINO DE CONSUMO (`MotivoMerma`, `DestinoConsumo`; Hito 4 de la pureza, bloque C de la pieza
 * carta/catálogo/stock, paso H4C-17 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro,
 * `data` literal, sin reglas de negocio). Son EXACTAMENTE las cuatro escrituras que antes hacía en línea `src/server/actions/movimientos/motivos.ts`; las llaman
 * sus casos de uso, con la base del contexto y sin transacción (como antes). Nunca se borra uno: lo referencia `Operacion` (FK ON DELETE RESTRICT).
 */

/** Crea el motivo de merma. Devuelve el id y el nombre guardados. */
export async function crearMotivoMermaNuevo(db: Prisma.TransactionClient, args: { nombre: string; descripcion: string | null }): Promise<{ id: string; nombre: string }> {
  const creado = await db.motivoMerma.create({ data: { nombre: args.nombre, descripcion: args.descripcion } });
  return { id: creado.id, nombre: creado.nombre };
}

/** Crea el destino de consumo. Devuelve el id y el nombre guardados. */
export async function crearDestinoConsumoNuevo(db: Prisma.TransactionClient, args: { nombre: string; descripcion: string | null }): Promise<{ id: string; nombre: string }> {
  const creado = await db.destinoConsumo.create({ data: { nombre: args.nombre, descripcion: args.descripcion } });
  return { id: creado.id, nombre: creado.nombre };
}

/** Activa o desactiva el motivo de merma (deja de ofrecerse en cargas nuevas). */
export async function fijarActivoDeMotivoMerma(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.motivoMerma.update({ where: { id: args.id }, data: { activo: args.activo } });
}

/** Activa o desactiva el destino de consumo (deja de ofrecerse en cargas nuevas). */
export async function fijarActivoDeDestinoConsumo(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.destinoConsumo.update({ where: { id: args.id }, data: { activo: args.activo } });
}
