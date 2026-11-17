import "server-only";
import type { Db } from "@/lib/db-tipos";
import type { NivelDeControl } from "@/core/compras/public";
import {
  cargarNivelDelControlDeExceso as leerNivelDelControl,
  listarOrdenesParaMostrar as leerOrdenesParaMostrar,
  listarProveedoresParaOrden as leerProveedoresParaOrden,
  type OrdenParaMostrar,
} from "@/server/lecturas/movimientos/ordenes-de-compra";

/**
 * Compras, orden de compra (etapa OC): lo que pide la PÁGINA de órdenes (las páginas leen por `server/consultas`, regla `paginas-solo-consultas`), en UNA sola consulta. Las lecturas y sus formas viven en `server/lecturas/movimientos/ordenes-de-compra.ts`
 * porque las comparten con la Server Action del selector de «Cargar compra» y con los casos de uso (ADR-026); acá se piden con la base del contexto de la página, que ya exigió `orden_de_compra_ver`.
 */
export type { OrdenParaMostrar } from "@/server/lecturas/movimientos/ordenes-de-compra";

export interface PantallaDeOrdenes {
  ordenes: OrdenParaMostrar[];
  /** Los proveedores activos para armar una orden nueva; vacío si quien mira no gestiona las órdenes. */
  proveedores: { id: string; nombre: string }[];
  /** El nivel del control de exceso; `null` si quien mira no configura el control o nunca se configuró (la regla pura lo trata como PERMITIR). */
  nivelDelControl: NivelDeControl | null;
}

/**
 * Las órdenes que ve quien consulta (la RLS por sucursal esconde las destinadas a otra sucursal). Solo quien gestiona las órdenes recibe el precio por unidad de cada línea (`conPrecios`, dinero, piso administrador) y la lista de proveedores
 * (`conProveedores`); solo quien configura el control recibe su nivel (`conNivel`). Sin ninguno de los tres, la consulta devuelve solo lo que puede ver cualquiera que vea las órdenes.
 */
export async function cargarPantallaDeOrdenes(db: Db, conPrecios: boolean, conProveedores: boolean, conNivel: boolean): Promise<PantallaDeOrdenes> {
  const [ordenes, proveedores, nivelDelControl] = await Promise.all([
    leerOrdenesParaMostrar(db, conPrecios),
    conProveedores ? leerProveedoresParaOrden(db) : Promise.resolve([]),
    conNivel ? leerNivelDelControl(db) : Promise.resolve(null),
  ]);
  return { ordenes, proveedores, nivelDelControl };
}
