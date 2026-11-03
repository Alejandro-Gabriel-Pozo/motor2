import "server-only";
import type { Prisma } from "@prisma/client";
import { insumosQuePuedeSumarAlgunaOpcion } from "@/core/pos/public";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import { cargarOrigenDeStockParaVender, type OrigenDeStockParaVender } from "@/server/lecturas/movimientos/receta-para-vender";

/**
 * El ORIGEN DE STOCK de los productos para el CATÁLOGO (el espacio del producto y el filtro «le falta: receta»; ventas con opciones, 2026-10-29): lo mismo que lee la venta
 * (`cargarOrigenDeStockParaVender`: nombre, si se produce, ingredientes de la receta VIGENTE en la sucursal) y, SOLO de los productos que no se producen y tienen cero ingredientes, lo que sus
 * opciones ofrecidas podrían sumar (`insumosQuePuedeSumarAlgunaOpcion`, con `cargarOpcionesParaVender`, el embudo de lectura de las opciones). Un producto sin ninguna opción ofrecida no lleva
 * `opciones`: la regla de siempre. SIEMPRE con la base de quien llama.
 */
export interface OrigenDeStockDelCatalogo extends OrigenDeStockParaVender {
  /** Presente solo si el producto no tiene ingredientes ni se produce y ofrece alguna opción del precio: `insumos` es lo que alguna podría sumar. */
  opciones?: { insumos: number; nombres: readonly string[]; ofrecidas: true };
}

export async function cargarOrigenDeStockDelCatalogo(tx: Prisma.TransactionClient, args: { sucursalId: string; productoIds: readonly string[] }): Promise<Map<string, OrigenDeStockDelCatalogo>> {
  const origen = await cargarOrigenDeStockParaVender(tx, args);
  const sinReceta = [...origen].filter(([, o]) => !o.seProduce && o.ingredientesDeLaRecetaVigente === 0).map(([id]) => id);
  if (sinReceta.length === 0) return origen;
  const opciones = await cargarOpcionesParaVender(tx, { sucursalId: args.sucursalId, productoIds: sinReceta });
  const resultado = new Map<string, OrigenDeStockDelCatalogo>(origen);
  for (const id of sinReceta) {
    const grupos = opciones.get(id)?.grupos ?? [];
    const ofreceOpciones = grupos.some((g) => g.activo && g.admitido && g.tipo !== "ADICIONAL" && g.opciones.some((o) => o.activa && o.admitida));
    if (ofreceOpciones) resultado.set(id, { ...origen.get(id)!, opciones: { insumos: insumosQuePuedeSumarAlgunaOpcion(grupos), nombres: [], ofrecidas: true } });
  }
  return resultado;
}
