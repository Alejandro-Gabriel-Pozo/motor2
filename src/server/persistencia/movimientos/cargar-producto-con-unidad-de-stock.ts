import "server-only";
import type { Prisma, TipoProducto, Unidad } from "@prisma/client";

/**
 * Carga de un producto con su unidad de stock (Task #41, Fase M, M13d — docs/arquitectura-casos-de-uso-2026-09-27.md). Es el MISMO
 * `tx.producto.findUnique({ where: { id }, include: { unidadStock: true } })` que hoy hacen, cada uno por su lado,
 * `reclasificarStock` (M13d) y `registrarConteoFisico`/`resolverConteoPendiente` (`conteo-fisico.ts`, M13e1/e2 — todavía sin migrar,
 * siguen con su propia llamada en línea hasta esa fase). Solo los campos que esos casos de uso efectivamente leen: `id`/`nombre` (para
 * los mensajes), `tipo`/`seProduce` (Conteo Físico: `tieneStockReal`) y `unidadStock` completa (decimales/nombre, para `validarCantidad`
 * y el redondeo).
 *
 * `tx: Prisma.TransactionClient` obligatorio, como todo `server/persistencia/`: sin reglas de negocio acá — si el producto no existe,
 * quien llama decide el mensaje.
 */
export interface ProductoConUnidadDeStock {
  id: string;
  nombre: string;
  tipo: TipoProducto;
  seProduce: boolean;
  unidadStock: Unidad;
}

export async function cargarProductoConUnidadDeStock(tx: Prisma.TransactionClient, productoId: string): Promise<ProductoConUnidadDeStock | null> {
  return tx.producto.findUnique({
    where: { id: productoId },
    select: { id: true, nombre: true, tipo: true, seProduce: true, unidadStock: true },
  });
}
