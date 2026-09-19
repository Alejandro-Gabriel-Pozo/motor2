import { prisma } from "@/lib/db";

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
 */
export async function upsertProveedorPorProducto(datos: {
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

  await prisma.$executeRaw`
    INSERT INTO "ProveedorPorProducto"
      (id, "productoId", "proveedorId", "unidadCompraId", "precioUnitario", "precioPorUnidadStock", "ultimaCompra", "referenciaProveedor")
    VALUES
      (${id}, ${datos.productoId}, ${datos.proveedorId}, ${datos.unidadCompraId},
       ${datos.precioUnitario}, ${datos.precioPorUnidadStock}, ${fecha}, ${referencia})
    ON CONFLICT ("productoId", "proveedorId", "unidadCompraId")
    DO UPDATE SET
      "precioUnitario" = CASE WHEN excluded."precioUnitario" > 0
        THEN excluded."precioUnitario" ELSE "ProveedorPorProducto"."precioUnitario" END,
      "precioPorUnidadStock" = CASE WHEN excluded."precioPorUnidadStock" > 0
        THEN excluded."precioPorUnidadStock" ELSE "ProveedorPorProducto"."precioPorUnidadStock" END,
      "ultimaCompra" = excluded."ultimaCompra",
      "referenciaProveedor" = CASE WHEN excluded."referenciaProveedor" IS NOT NULL
        THEN excluded."referenciaProveedor" ELSE "ProveedorPorProducto"."referenciaProveedor" END
  `;
}
