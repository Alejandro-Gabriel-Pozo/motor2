import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los COMBOS y del MENÚ DEL DÍA (GO-3b, ADR-032; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Las
 * llaman los casos de uso de `src/server/actions/carta/casos-de-uso/`, que deciden la transacción y auditan (la persistencia no audita: `escrituras-auditadas.test.ts` exige la cadena). Nada se
 * borra: una entrada o un plato del día se desactiva (la app tiene UPDATE solo de `activa`, `orden`, `actualizadoEn` y, en el plato del día, `actualizadoPorId`).
 */

/** Una entrada nueva de un lugar LISTA con su configuración fija (sus opciones, que solo se agregan). Devuelve el id. */
export async function crearEntradaDeCupo(
  db: Prisma.TransactionClient,
  args: { cupoId: string; productoId: string; claveConfiguracion: string; orden: number; opciones: readonly { opcionId: string; cantidad: number }[]; ahora: Date },
): Promise<{ id: string }> {
  const creada = await db.entradaDeCupo.create({
    data: { cupoId: args.cupoId, productoId: args.productoId, claveConfiguracion: args.claveConfiguracion, orden: args.orden, creadoEn: args.ahora, actualizadoEn: args.ahora },
    select: { id: true },
  });
  if (args.opciones.length) {
    await db.opcionDeEntradaDeCupo.createMany({ data: args.opciones.map((o) => ({ entradaId: creada.id, opcionId: o.opcionId, cantidad: o.cantidad, creadoEn: args.ahora })) });
  }
  return { id: creada.id };
}

/** Prende o apaga una entrada de un lugar LISTA. */
export async function fijarActivaDeEntradaDeCupo(db: Prisma.TransactionClient, args: { id: string; activa: boolean; ahora: Date }): Promise<void> {
  await db.entradaDeCupo.update({ where: { id: args.id }, data: { activa: args.activa, actualizadoEn: args.ahora } });
}

/**
 * La vigencia de una promo con su control OPTIMISTA: escribe solo si la versión sigue siendo la que vio la pantalla, y la incrementa. Devuelve cuántas filas cambió (0 = alguien la cambió
 * entre medio: `VERSION_DESACTUALIZADA`).
 */
export async function cambiarVigenciaDePromo(
  db: Prisma.TransactionClient,
  args: { id: string; versionEsperada: number; vigenteDesde: Date | null; vigenteHasta: Date | null; diasDeSemana: number | null },
): Promise<number> {
  const { count } = await db.promoCarta.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { vigenteDesde: args.vigenteDesde, vigenteHasta: args.vigenteHasta, diasDeSemana: args.diasDeSemana, version: { increment: 1 } },
  });
  return count;
}
