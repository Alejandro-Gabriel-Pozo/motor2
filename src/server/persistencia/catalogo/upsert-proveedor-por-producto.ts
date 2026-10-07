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
 * Usa `$executeRaw` con `INSERT ... ON CONFLICT DO UPDATE` (no
 * `prisma.upsert()`) a propósito: el UPDATE necesita una condición
 * (`CASE WHEN`, Catalogo.js:3241-3247 — un precio 0 nunca pisa un precio
 * bueno ya cargado) que el upsert de Prisma no soporta sin una lectura
 * previa, lo que reintroduciría la ventana de carrera cross-hostería que
 * esto reemplaza. El UNIQUE(productoId, proveedorId, unidadCompraId) hace
 * que dos ejecuciones concurrentes sobre la misma clave nunca produzcan
 * dos filas — ver Catalogo.js:3278-3294 para el bug real que esto cierra.
 *
 * Desde Pureza Fase 4 (decisión del dueño, 2026-10-06) corre DENTRO de la transacción de la compra (`tx`). Una compra con FECHA ATRASADA no pisa el último precio ni retrocede
 * `ultimaCompra`: el precio solo se actualiza si la fecha nueva es >= la guardada (ERPNext hace lo mismo: `last_purchase_rate` ignora un documento más viejo) y `ultimaCompra` toma
 * la más reciente; con la misma fecha gana la carga posterior. (Eso protege lo que SÍ se lee de esta tabla —la unidad y la referencia más recientes—; el precio ya no lo lee nadie.)
 *
 * OJO: desde la parte 2 del vínculo (2026-10-07) las pantallas NO leen el precio ni la fecha de esta tabla: la comparativa, la ficha del proveedor, la precarga del carrito y los reportes «tiene
 * proveedor» se derivan del Kardex vigente (`server/lecturas/catalogo/ofertas-de-proveedor.ts`), que sí se entera de una compra anulada o de un proveedor corregido. De esta tabla solo se lee
 * la unidad de compra y la referencia del proveedor, que el Kardex no guarda.
 */
export async function upsertProveedorPorProducto(db: Db, datos: {
  productoId: string;
  proveedorId: string;
  unidadCompraId: string;
  precioUnitario: number;
  precioPorUnidadStock: number;
  fechaCompra?: Date;
  /** Cómo llama el proveedor a este producto — igual criterio que el precio: un valor vacío nunca pisa uno ya cargado. */
  referenciaProveedor?: string;
}): Promise<void> {
  const id = crypto.randomUUID();
  const fecha = datos.fechaCompra ?? new Date();
  const referencia = datos.referenciaProveedor?.trim() || null;

  await db.$executeRaw`
    INSERT INTO "ProveedorPorProducto"
      (id, "productoId", "proveedorId", "unidadCompraId", "precioUnitario", "precioPorUnidadStock", "ultimaCompra", "referenciaProveedor")
    VALUES
      (${id}, ${datos.productoId}, ${datos.proveedorId}, ${datos.unidadCompraId},
       ${datos.precioUnitario}, ${datos.precioPorUnidadStock}, ${fecha}, ${referencia})
    ON CONFLICT ("productoId", "proveedorId", "unidadCompraId")
    DO UPDATE SET
      "precioUnitario" = CASE WHEN excluded."precioUnitario" > 0 AND excluded."ultimaCompra" >= "ProveedorPorProducto"."ultimaCompra"
        THEN excluded."precioUnitario" ELSE "ProveedorPorProducto"."precioUnitario" END,
      "precioPorUnidadStock" = CASE WHEN excluded."precioPorUnidadStock" > 0 AND excluded."ultimaCompra" >= "ProveedorPorProducto"."ultimaCompra"
        THEN excluded."precioPorUnidadStock" ELSE "ProveedorPorProducto"."precioPorUnidadStock" END,
      "ultimaCompra" = GREATEST("ProveedorPorProducto"."ultimaCompra", excluded."ultimaCompra"),
      "referenciaProveedor" = CASE WHEN excluded."referenciaProveedor" IS NOT NULL
        THEN excluded."referenciaProveedor" ELSE "ProveedorPorProducto"."referenciaProveedor" END
  `;
}
