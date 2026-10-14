import "server-only";
import type { Prisma } from "@prisma/client";
import { versionVigente } from "@/core/opciones/public";

/**
 * GO-3b (ADR-032, frente B): el EMBUDO de lectura de la RECETA PROPIA de una combinación (lo fija `test/arquitectura/lectores-de-receta-de-combinacion.test.ts`, molde de `lectores-de-receta`). La
 * vigente es la versión de `numero` MAYOR, elegida con la regla pura `versionVigente` (`core/opciones`, la misma que las versiones de una opción); nunca a mano en otro archivo. Una versión SIN
 * ingredientes significa «sin excepción: vuelve a la regla general» (quien la usa la trata como ausente). SIEMPRE con el `tx` de quien llama. Un id de otra empresa no se ve (RLS).
 */

export interface RecetaDeCombinacionLeida {
  versionId: string;
  numero: number;
  creadoPorId: string;
  /** En su orden (`orden`), con la unidad de stock con que se guardó. */
  ingredientes: { insumoProductoId: string; cantidad: number; mermaPorcentaje: number; unidadId: string }[];
}

/** La receta propia VIGENTE de cada combinación pedida (las que no tienen ninguna versión no vuelven). Una consulta. */
export async function cargarRecetasVigentesDeCombinaciones(tx: Prisma.TransactionClient, combinacionIds: readonly string[]): Promise<Map<string, RecetaDeCombinacionLeida>> {
  const ids = [...new Set(combinacionIds)];
  if (ids.length === 0) return new Map();
  const versiones = await tx.recetaDeCombinacionVersion.findMany({
    where: { combinacionId: { in: ids } },
    select: {
      id: true,
      combinacionId: true,
      numero: true,
      creadoPorId: true,
      ingredientes: { orderBy: { orden: "asc" }, select: { insumoProductoId: true, cantidad: true, mermaPorcentaje: true, unidadId: true } },
    },
  });
  const porCombinacion = new Map<string, typeof versiones>();
  for (const v of versiones) porCombinacion.set(v.combinacionId, [...(porCombinacion.get(v.combinacionId) ?? []), v]);
  const resultado = new Map<string, RecetaDeCombinacionLeida>();
  for (const [combinacionId, lista] of porCombinacion) {
    const vigente = versionVigente(lista);
    if (!vigente) continue;
    resultado.set(combinacionId, {
      versionId: vigente.id,
      numero: vigente.numero,
      creadoPorId: vigente.creadoPorId,
      ingredientes: vigente.ingredientes.map((i) => ({ insumoProductoId: i.insumoProductoId, cantidad: Number(i.cantidad), mermaPorcentaje: Number(i.mermaPorcentaje), unidadId: i.unidadId })),
    });
  }
  return resultado;
}
