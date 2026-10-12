"use server";

import type { FilaComparativaPrecios } from "@/core/catalogo/public";
import { cargarComparativaDePrecios, cargarProductosDeProveedorParaElCarrito, type ProductoDeProveedor } from "@/server/lecturas/catalogo/ofertas-de-proveedor";
import { lecturaEnSucursalesVisibles } from "@/server/acceso/alcance";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";

/**
 * Productos ya comprados a este proveedor, más recientes primero — para precargar el carrito de una Compra sin buscar de nuevo lo que ya se le compra siempre a este proveedor
 * (mismo dato que `obtenerProductosDeProveedor`, Catalogo.js:3901, del proyecto viejo). Del Kardex VIGENTE, con el precio de ESTA sucursal o, si nunca le compró ese producto, el
 * de la empresa (rotulado): la regla está en `cargarProductosDeProveedorParaElCarrito` (`server/lecturas/catalogo/ofertas-de-proveedor.ts`), adonde se mudó la composición en el
 * Hito 4 (paso A2, sin cambiar nada) para poder contar sus consultas. Esta acción exige el permiso y pasa la base y la sucursal del contexto.
 * ADR-028 (D1): el precio «de la empresa» se arma con las compras de las sucursales que el usuario puede VER para `proceso_compra` (la clave de esta pantalla), además de la activa:
 * `lecturaEnSucursalesVisibles` ensancha la LECTURA y la consulta usa esa base (con la de la sucursal activa, la RLS por sucursal dejaría el precio de otra sucursal en cero filas).
 */
export async function listarProductosDeProveedor(proveedorId: string): Promise<ProductoDeProveedor[]> {
  const ctx = await requerirVer("proceso_compra");
  const lectura = await lecturaEnSucursalesVisibles(ctx, "proceso_compra");
  return cargarProductosDeProveedorParaElCarrito(lectura.db, proveedorId, ctx.sucursalId);
}

/**
 * Comparativa de precios por insumo (equivalente de generarComparativaPreciosPorFamilia_, Catalogo.js:3528-3562): una oferta con precio 0 NUNCA gana el «más barato». Del Kardex
 * vigente y de la empresa entera (decisión del dueño, 2026-10-07). Desde el Hito 4 (paso A5, O.8a) la lectura es `cargarComparativaDePrecios`
 * (`server/lecturas/catalogo/ofertas-de-proveedor.ts`) y el armado, la función pura `armarComparativaDePrecios` (`core/catalogo`); esta acción exige el permiso.
 * ADR-028 (D1): «de la empresa» es «de las sucursales que ves». `comparar_precios` es una clave de EMPRESA y `lecturaEnSucursalesVisibles` pide una de sucursal: la lectura se ensancha a las
 * sucursales donde el usuario ve `proceso_compra` (quien ve las compras de una sucursal ve sus precios), además de la activa; nunca a toda la empresa.
 */
export async function obtenerComparativaPreciosPorInsumo(): Promise<FilaComparativaPrecios[]> {
  const ctx = await requerirVerDeEmpresa("comparar_precios");
  const lectura = await lecturaEnSucursalesVisibles(ctx, "proceso_compra");
  return cargarComparativaDePrecios(lectura.db);
}
