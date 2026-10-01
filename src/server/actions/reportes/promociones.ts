"use server";

import { texto } from "@/core/texto";
import { construirIndiceRecetas } from "@/core/reportes/comun";
import { whereDisponibleEn } from "@/core/catalogo/public-servidor";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

/** Port de obtenerPromocionesHabilitadas (Catalogo.js:2211-2213) — lectura simple; pide el «Ver» de la pantalla de Promociones (ver `requerirVer`). */
export async function obtenerPromocionesHabilitadas(sucursalId: string): Promise<boolean> {
  const ctx = await requerirVerEnSucursal(sucursalId, "promociones_config");
  const sucursal = await ctx.db.sucursal.findUnique({ where: { id: sucursalId } });
  return sucursal?.promocionesHabilitadas ?? false;
}

/** Port de actualizarPromocionesHabilitado (Catalogo.js:2216-2238) — prende/apaga la feature completa para esta sucursal. */
export async function actualizarPromocionesHabilitado(activar: boolean): Promise<ResultadoAccion> {
  return conPermiso("promociones_activar", async (ctx) => {
    await ctx.db.sucursal.update({ where: { id: ctx.sucursalId }, data: { promocionesHabilitadas: activar } });
    return ok(`Promociones y Combos ${activar ? "activado" : "desactivado"}.`);
  });
}

/** Port de marcarProductoComoPromocion (Catalogo.js:2253-2278). */
export async function marcarProductoComoPromocion(productoId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("promociones_marcar_combo", async (ctx) => {
    const producto = await ctx.db.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("Elegí un producto.");

    await ctx.db.promocionProducto.upsert({
      where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
      create: { sucursalId: ctx.sucursalId, productoId, activa },
      update: { activa },
    });
    return ok(`"${producto.nombre}" ${activa ? "marcado" : "desmarcado"} como Promoción/Combo.`);
  });
}

export interface CandidatoPromocion {
  productoId: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

/** Port de buscarProductoParaPromocion (Catalogo.js:2281-2292) — PV con receta (candidatos a Promoción/Combo). */
export async function buscarProductoParaPromocion(sucursalId: string, termino: string): Promise<CandidatoPromocion[]> {
  const ctx = await requerirVerEnSucursal(sucursalId, "promociones_config");
  const q = texto(termino).toLowerCase();
  const { recetaPorProducto } = await construirIndiceRecetas(ctx.db);
  const [productos, marcados] = await Promise.all([
    ctx.db.producto.findMany({ where: { tipo: "PV", ...whereDisponibleEn(sucursalId) } }),
    ctx.db.promocionProducto.findMany({ where: { sucursalId } }),
  ]);
  const marcadoPorProducto = new Map(marcados.map((m) => [m.productoId, m.activa]));

  return productos
    .filter((p) => (recetaPorProducto.get(p.id) ?? []).length > 0)
    .filter((p) => !q || p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
    .slice(0, 20)
    .map((p) => ({ productoId: p.id, codigo: p.codigo, nombre: p.nombre, activa: marcadoPorProducto.get(p.id) === true }));
}
