import "server-only";
import type { Db } from "@/lib/db-tipos";
import {
  cargarNivelDelControlDeExceso as leerNivelDelControl,
  listarOrdenesParaMostrar as leerOrdenesParaMostrar,
  listarProveedoresParaOrden as leerProveedoresParaOrden,
} from "@/server/lecturas/movimientos/ordenes-de-compra";

/**
 * Compras, orden de compra (etapa OC): lo que piden las PÁGINAS de órdenes (las páginas leen por `server/consultas`, regla `paginas-solo-consultas`). Las lecturas y sus formas viven en `server/lecturas/movimientos/ordenes-de-compra.ts`
 * porque las comparten con la Server Action del selector de «Cargar compra» y con los casos de uso (ADR-026); acá se piden con la base del contexto de la página, que ya exigió `orden_de_compra_ver`.
 */
export type { OrdenParaMostrar } from "@/server/lecturas/movimientos/ordenes-de-compra";

/** Las órdenes que ve quien consulta (la RLS por sucursal esconde las destinadas a otra sucursal); el precio por unidad solo viaja con `conPrecios` (quien gestiona las órdenes). */
export async function listarOrdenesParaMostrar(db: Db, conPrecios: boolean) {
  return leerOrdenesParaMostrar(db, conPrecios);
}

/** Los proveedores activos (id y nombre) para armar una orden nueva. */
export async function listarProveedoresParaOrden(db: Db) {
  return leerProveedoresParaOrden(db);
}

/** El nivel del control de exceso de la empresa; sin fila = `null` (la regla pura lo trata como PERMITIR). */
export async function cargarNivelDelControlDeExceso(db: Db) {
  return leerNivelDelControl(db);
}
