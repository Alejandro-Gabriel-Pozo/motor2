import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los COMBOS (GO-3b, ADR-032; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Las
 * llaman los casos de uso de `src/server/actions/carta/casos-de-uso/`, que deciden la transacción y auditan (la persistencia no audita: `escrituras-auditadas.test.ts` exige la cadena). Nada se
 * borra: una entrada se desactiva (la app tiene UPDATE solo de `activa`, `orden` y `actualizadoEn`).
 */

/** Una entrada nueva de un lugar LISTA con su configuración fija o sus opciones permitidas (según `modoDeOpciones`; sus opciones solo se agregan). Devuelve el id. */
export async function crearEntradaDeCupo(
  db: Prisma.TransactionClient,
  args: { cupoId: string; productoId: string; claveConfiguracion: string; modoDeOpciones: "FIJAS" | "A_ELEGIR"; orden: number; opciones: readonly { opcionId: string; cantidad: number }[]; ahora: Date },
): Promise<{ id: string }> {
  const creada = await db.entradaDeCupo.create({
    data: { cupoId: args.cupoId, productoId: args.productoId, claveConfiguracion: args.claveConfiguracion, modoDeOpciones: args.modoDeOpciones, orden: args.orden, creadoEn: args.ahora, actualizadoEn: args.ahora },
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
