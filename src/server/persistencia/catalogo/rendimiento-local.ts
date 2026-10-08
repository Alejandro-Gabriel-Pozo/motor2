import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del RENDIMIENTO LOCAL de una línea de receta en una sucursal (`RendimientoLocalIngrediente`; Hito 4 de la pureza, bloque 4.2, paso H4C-5 —
 * `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de
 * negocio). Son EXACTAMENTE las dos escrituras que antes hacía en línea `src/server/actions/catalogo/rendimiento-local.ts`; las llaman los casos de uso
 * `fijar-rendimiento-local.ts` y `volver-al-rendimiento-central.ts`, dentro de su transacción SERIALIZABLE y junto con sus dos filas de auditoría (que escriben
 * ellos: la persistencia no audita, `escrituras-auditadas.test.ts` exige la cadena).
 */

/** Crea o cambia la calibración (cantidad y merma, cualquiera de las dos puede ser `null` = la central) de la línea en la sucursal. */
export async function fijarRendimientoLocalDeLinea(
  db: Prisma.TransactionClient,
  args: { recetaIngredienteId: string; sucursalId: string; cantidad: number | null; mermaPorcentaje: number | null },
): Promise<void> {
  await db.rendimientoLocalIngrediente.upsert({
    where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: args.recetaIngredienteId, sucursalId: args.sucursalId } },
    create: { recetaIngredienteId: args.recetaIngredienteId, sucursalId: args.sucursalId, cantidad: args.cantidad, mermaPorcentaje: args.mermaPorcentaje },
    update: { cantidad: args.cantidad, mermaPorcentaje: args.mermaPorcentaje },
  });
}

/** «Volver al valor central»: pone los dos campos en `null` (NO borra la fila: mismo criterio append-only del resto del proyecto). */
export async function volverRendimientoLocalAlCentral(db: Prisma.TransactionClient, args: { recetaIngredienteId: string; sucursalId: string }): Promise<void> {
  await db.rendimientoLocalIngrediente.update({
    where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: args.recetaIngredienteId, sucursalId: args.sucursalId } },
    data: { cantidad: null, mermaPorcentaje: null },
  });
}
