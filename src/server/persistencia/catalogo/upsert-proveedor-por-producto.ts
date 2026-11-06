import type { Db } from "@/lib/db-tipos";

// Este archivo NO lleva `"use server"` a propósito: `upsertProveedorPorProducto` no tiene gate propio (lo gatea quien lo
// llama), y todo lo que exporta un archivo `"use server"` es un endpoint que se puede invocar directo. Vivía en
// `proveedor-por-producto.ts`, que sí lo lleva: una escritura sin ninguna guarda expuesta como server action.

/**
 * Pieza reusable SIN gate propio — el enganche real "al confirmar una
 * Compra" (actualizarProveedoresDesdeCompra_, Catalogo.js:3617-3657) es de
 * la porción Movimientos, que gatea con 'proceso_compra' antes de llamar
 * a esto. Acá solo se construye la operación de catálogo en sí.
 *
 * Usa `$executeRaw` con `INSERT ... ON CONFLICT DO UPDATE` (no `prisma.upsert()`) a propósito: es UNA sola sentencia atómica, sin lectura previa, así que dos ejecuciones concurrentes
 * sobre la misma clave nunca producen dos filas (UNIQUE(productoId, proveedorId, unidadCompraId); ver Catalogo.js:3278-3294 para el bug real que esto cierra).
 *
 * Desde Pureza Fase 4 (decisión del dueño, 2026-10-06) corre DENTRO de la transacción de la compra (`tx`). `ultimaCompra` toma la fecha más reciente (una compra con FECHA ATRASADA no la
 * retrocede) y la referencia del proveedor se guarda si viene (un valor vacío nunca pisa uno ya cargado).
 *
 * PODA (decisión del dueño, 2026-11-06): ya NO escribe el precio (`precioUnitario`, `precioPorUnidadStock`): desde la parte 2 del vínculo (2026-10-07) las pantallas NO lo leen —la comparativa,
 * la ficha del proveedor, la precarga del carrito y los reportes «tiene proveedor» se derivan del Kardex vigente (`server/lecturas/catalogo/ofertas-de-proveedor.ts`), que sí se entera de una compra
 * anulada o de un proveedor corregido—, y el precio de cada compra queda en el Kardex. De esta tabla se lee la unidad de compra, la referencia del proveedor y `ultimaCompra` (ordena la fila más
 * reciente del par). Las columnas de precio siguen en la tabla con su valor por defecto (0) y lo viejo queda como está: borrarlas es destructivo y va aparte.
 */
export async function upsertProveedorPorProducto(db: Db, datos: {
  productoId: string;
  proveedorId: string;
  unidadCompraId: string;
  fechaCompra?: Date;
  /** Cómo llama el proveedor a este producto — un valor vacío nunca pisa uno ya cargado. */
  referenciaProveedor?: string;
}): Promise<void> {
  // Ni el reloj ni el azar se leen acá (Pureza, auditoría de las Fases 0 y 1): el id lo genera la base (`gen_random_uuid()`) y, si el llamador no trae la fecha de la compra, vale la hora de la
  // base (`now()`, el mismo default de la columna). El único llamador de producción siempre pasa `fechaCompra`.
  const fecha = datos.fechaCompra ?? null;
  const referencia = datos.referenciaProveedor?.trim() || null;

  await db.$executeRaw`
    INSERT INTO "ProveedorPorProducto"
      (id, "productoId", "proveedorId", "unidadCompraId", "ultimaCompra", "referenciaProveedor")
    VALUES
      (gen_random_uuid()::text, ${datos.productoId}, ${datos.proveedorId}, ${datos.unidadCompraId},
       COALESCE(${fecha}::timestamp, timezone('utc', now())), ${referencia})
    ON CONFLICT ("productoId", "proveedorId", "unidadCompraId")
    DO UPDATE SET
      "ultimaCompra" = GREATEST("ProveedorPorProducto"."ultimaCompra", excluded."ultimaCompra"),
      "referenciaProveedor" = CASE WHEN excluded."referenciaProveedor" IS NOT NULL
        THEN excluded."referenciaProveedor" ELSE "ProveedorPorProducto"."referenciaProveedor" END
  `;
}
