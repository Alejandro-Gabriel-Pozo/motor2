import type { MagnitudUnidad, Prisma } from "@prisma/client";
import { alcanceDeSucursal, leerBaseDeCantidad, type BaseDeCantidad } from "@/core/catalogo/public";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";

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

/** Hay más de una presentación activa de este producto con esa unidad: la línea de compra no sabe a cuál se refiere (hasta que apunte a la presentación, etapa d). */
export const PRESENTACION_AMBIGUA = "AMBIGUA" as const;

/**
 * `null` si no es una presentación real y activa de este producto: el caso de uso sigue con la default. `PRESENTACION_AMBIGUA` si hay MÁS DE UNA activa con esa unidad (la línea solo trae la unidad):
 * fallo cerrado, el que llama rechaza la línea; nunca se elige una al azar ni se cae a la default (cambiaría en silencio cuánto stock entra y a qué costo).
 */
export async function cargarPresentacionActiva(
  tx: Prisma.TransactionClient,
  args: { productoId: string; unidadCompraId: string }
): Promise<{ unidadCompraId: string; factorConversion: number; unidadCompra: { nombre: string; decimales: number; magnitud: MagnitudUnidad } } | typeof PRESENTACION_AMBIGUA | null> {
  const presentaciones = await tx.presentacion.findMany({
    where: { productoId: args.productoId, unidadCompraId: args.unidadCompraId, activa: true },
    include: { unidadCompra: true },
    take: 2,
  });
  if (presentaciones.length > 1) return PRESENTACION_AMBIGUA;
  const presentacion = presentaciones[0];
  if (!presentacion) return null;
  return {
    unidadCompraId: presentacion.unidadCompraId,
    factorConversion: Number(presentacion.factorConversion),
    unidadCompra: { nombre: presentacion.unidadCompra.nombre, decimales: presentacion.unidadCompra.decimales, magnitud: presentacion.unidadCompra.magnitud },
  };
}

/**
 * La unidad que se tecleó en una línea de compra, solo si existe en la empresa (RLS); `null` si no. Sin reglas: quien llama decide si esa unidad se admite
 * (presentación, unidad por defecto, unidad de stock o conversión exacta del catálogo de unidades fijas).
 */
export async function cargarUnidadDeCompraTecleada(
  tx: Prisma.TransactionClient,
  args: { unidadId: string }
): Promise<{ id: string; nombre: string; decimales: number; magnitud: MagnitudUnidad; codigoFijo: string | null } | null> {
  const unidad = await tx.unidad.findUnique({ where: { id: args.unidadId }, select: { id: true, nombre: true, decimales: true, magnitud: true, codigoFijo: true } });
  return unidad ?? null;
}

/** Un ingrediente de la receta vigente, con la cantidad/merma central y las calibraciones locales de la sucursal que produce. */
export interface IngredienteRecetaParaProducir {
  insumoProductoId: string;
  cantidad: number;
  mermaPorcentaje: number;
  /** La base de la VERSIÓN de la receta (M3a): NETA o BRUTA. */
  baseDeCantidad: BaseDeCantidad;
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

  // M3a: la base es de la VERSIÓN; una marca ilegible CIERRA (lanza), nunca se asume una base.
  const baseDeCantidad = leerBaseDeCantidad(receta.baseDeCantidad);
  return receta.ingredientes.map((ing) => ({
    insumoProductoId: ing.insumoProductoId,
    cantidad: Number(ing.cantidad),
    mermaPorcentaje: Number(ing.mermaPorcentaje),
    baseDeCantidad,
    rendimientosLocales: ing.rendimientosLocales.map((r) => ({
      sucursalId: r.sucursalId,
      cantidad: r.cantidad !== null ? Number(r.cantidad) : null,
      mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null,
    })),
  }));
}
