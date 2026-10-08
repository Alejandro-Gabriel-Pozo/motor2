import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los CLIENTES con % de descuento (`Cliente`; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-15 —
 * `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente de la base es el PRIMER parámetro, `data` literal, sin reglas
 * de negocio). Son EXACTAMENTE las tres escrituras que antes hacía en línea `src/server/actions/clientes/cliente.ts`; las llaman los casos de uso
 * `alta-cliente.ts`, `actualizar-cliente.ts` y `actualizar-activo-cliente.ts`, DENTRO de su transacción y junto con su auditoría (el % mueve plata: se congela en
 * cada cuenta al asignarlo; `escrituras-auditadas` exige la cadena: quien llama a las escrituras del % audita).
 */

/** Crea el cliente con su nombre y su %. Devuelve el id y el nombre guardados. */
export async function crearClienteNuevo(db: Prisma.TransactionClient, args: { nombre: string; descuentoPorcentaje: number }): Promise<{ id: string; nombre: string }> {
  const creado = await db.cliente.create({ data: { nombre: args.nombre, descuentoPorcentaje: args.descuentoPorcentaje } });
  return { id: creado.id, nombre: creado.nombre };
}

/** Reescribe el nombre y el % del cliente. El % nuevo NO toca ninguna `Cuenta` ya asignada (D7: el % quedó congelado en la cuenta). */
export async function guardarDatosDeCliente(db: Prisma.TransactionClient, args: { id: string; nombre: string; descuentoPorcentaje: number }): Promise<void> {
  await db.cliente.update({ where: { id: args.id }, data: { nombre: args.nombre, descuentoPorcentaje: args.descuentoPorcentaje } });
}

/** Activa o desactiva el cliente (nunca se borra: una cuenta u operación cerrada lo referencia para siempre). */
export async function fijarActivoDeCliente(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.cliente.update({ where: { id: args.id }, data: { activo: args.activo } });
}
