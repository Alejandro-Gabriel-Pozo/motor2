import type { Prisma } from "@prisma/client";
import { alcanceDeSucursal, cargarRecetaVigente } from "@/core/catalogo/public-servidor";

/**
 * Persistencia de las dos lecturas que hace `armarLineaMovimiento`/`calcularConsumosProduccion` DENTRO de la transacción (Task #41,
 * Fase M, M13a — docs/arquitectura-casos-de-uso-2026-09-27.md). Son EXACTAMENTE las lecturas de Prisma que antes hacían en línea esas
 * dos funciones (hoy `src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts`), copiadas tal cual. Sin reglas de
 * negocio.
 *
 * Contrato: el cliente es SIEMPRE `tx: Prisma.TransactionClient`, obligatorio — las dos corren DENTRO de la transacción SERIALIZABLE
 * del caso de uso.
 *
 * `cargarRecetaVigenteParaProducir` es un lector "efectivo" (test/arquitectura/lectores-de-receta.test.ts): trae, para cada
 * ingrediente, las calibraciones locales (`rendimientosLocales`) de LA SUCURSAL que produce — `rendimientoEfectivo` (en el caso de
 * uso) las combina con la cantidad/merma central para resolver el consumo real de la receta al Producir (C2). Los `Number(...)` de
 * `Prisma.Decimal` que antes hacía `calcularConsumosProduccion` con `cantidad`/`mermaPorcentaje` (de la receta y de cada calibración)
 * se hacen acá, al borde de la persistencia.
 */

/** `null` si no es una presentación real y activa de este producto: el caso de uso sigue con la default. */
export async function cargarPresentacionActiva(
  tx: Prisma.TransactionClient,
  args: { productoId: string; unidadCompraId: string }
): Promise<{ unidadCompraId: string; factorConversion: number; unidadCompra: { nombre: string; decimales: number } } | null> {
  const presentacion = await tx.presentacion.findFirst({
    where: { productoId: args.productoId, unidadCompraId: args.unidadCompraId, activa: true },
    include: { unidadCompra: true },
  });
  if (!presentacion) return null;
  return {
    unidadCompraId: presentacion.unidadCompraId,
    factorConversion: Number(presentacion.factorConversion),
    unidadCompra: { nombre: presentacion.unidadCompra.nombre, decimales: presentacion.unidadCompra.decimales },
  };
}

/** Un ingrediente de la receta vigente, con la cantidad/merma central y las calibraciones locales de la sucursal que produce. */
export interface IngredienteRecetaParaProducir {
  insumoProductoId: string;
  cantidad: number;
  mermaPorcentaje: number;
  rendimientosLocales: { sucursalId: string; cantidad: number | null; mermaPorcentaje: number | null }[];
}

/** `[]` si el producto no tiene receta, o la tiene sin ingredientes. */
export async function cargarRecetaVigenteParaProducir(
  tx: Prisma.TransactionClient,
  args: { productoId: string; sucursalId: string }
): Promise<IngredienteRecetaParaProducir[]> {
  const receta = await cargarRecetaVigente(tx, alcanceDeSucursal(args.sucursalId), args.productoId, {
    include: { ingredientes: { include: { rendimientosLocales: { where: { sucursalId: args.sucursalId } } } } },
  });
  if (!receta?.ingredientes.length) return [];

  return receta.ingredientes.map((ing) => ({
    insumoProductoId: ing.insumoProductoId,
    cantidad: Number(ing.cantidad),
    mermaPorcentaje: Number(ing.mermaPorcentaje),
    rendimientosLocales: ing.rendimientosLocales.map((r) => ({
      sucursalId: r.sucursalId,
      cantidad: r.cantidad !== null ? Number(r.cantidad) : null,
      mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null,
    })),
  }));
}
