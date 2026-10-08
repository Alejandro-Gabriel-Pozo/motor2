"use server";

import type { FilaComparativaPrecios } from "@/core/catalogo/public";
import { cargarComparativaDePrecios, cargarProductosDeProveedorParaElCarrito, type ProductoDeProveedor } from "@/server/lecturas/catalogo/ofertas-de-proveedor";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";

/**
 * Productos ya comprados a este proveedor, más recientes primero — para precargar el carrito de una Compra sin buscar de nuevo lo que ya se le compra siempre a este proveedor
 * (mismo dato que `obtenerProductosDeProveedor`, Catalogo.js:3901, del proyecto viejo). Del Kardex VIGENTE, con el precio de ESTA sucursal o, si nunca le compró ese producto, el
 * de la empresa (rotulado): la regla está en `cargarProductosDeProveedorParaElCarrito` (`server/lecturas/catalogo/ofertas-de-proveedor.ts`), adonde se mudó la composición en el
 * Hito 4 (paso A2, sin cambiar nada) para poder contar sus consultas. Esta acción solo exige el permiso y pasa la base y la sucursal del contexto.
 */
export async function listarProductosDeProveedor(proveedorId: string): Promise<ProductoDeProveedor[]> {
  const ctx = await requerirVer("proceso_compra");
  return cargarProductosDeProveedorParaElCarrito(ctx.db, proveedorId, ctx.sucursalId);
}

/**
 * Comparativa de precios por insumo (equivalente de generarComparativaPreciosPorFamilia_, Catalogo.js:3528-3562): una oferta con precio 0 NUNCA gana el «más barato». Del Kardex
 * vigente y de la empresa entera (decisión del dueño, 2026-10-07). Desde el Hito 4 (paso A5, O.8a) la lectura es `cargarComparativaDePrecios`
 * (`server/lecturas/catalogo/ofertas-de-proveedor.ts`) y el armado, la función pura `armarComparativaDePrecios` (`core/catalogo`); esta acción solo exige el permiso.
 */
export async function obtenerComparativaPreciosPorInsumo(): Promise<FilaComparativaPrecios[]> {
  const ctx = await requerirVerDeEmpresa("comparar_precios");
  return cargarComparativaDePrecios(ctx.db);
}
