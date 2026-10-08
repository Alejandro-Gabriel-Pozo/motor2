"use server";

import type { MagnitudUnidad } from "@prisma/client";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoDeEmpresa } from "@/server/acceso/gate";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public";
import { guardComandoActualizarDecimalesUnidad, guardComandoCrearUnidad } from "@/core/features/catalogo/unidades.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVerAlguna, requerirVerDeEmpresa } from "../con-sesion";
import { actualizarActivaUnidadCasoDeUso } from "./casos-de-uso/actualizar-activa-unidad";
import { actualizarDecimalesUnidadCasoDeUso } from "./casos-de-uso/actualizar-decimales-unidad";
import { crearUnidadCasoDeUso } from "./casos-de-uso/crear-unidad";

/**
 * Desde el Hito 4 de la pureza (bloque 4.3, paso H4C-8) las tres mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{crear-unidad,actualizar-activa-unidad,actualizar-decimales-unidad}.ts`; escrituras en server/persistencia/catalogo/unidades.ts): el archivo
 * entero está en `ACCIONES_CON_CASO_DE_USO`. Las lecturas de abajo (H8 y `detectarInsumosConUnidadMezclada`, con su gate inline) siguen acá.
 */

/** H8: todas (activas e inactivas), para la pantalla de Unidades. */
export async function listarUnidadesParaPanel() {
  const ctx = await requerirVerDeEmpresa("unidades");
  return ctx.db.unidad.findMany({ orderBy: { nombre: "asc" } });
}

/** H8: la compra (alta rápida de producto), el editor de recetas o el formulario de producto (alta o edición). */
export async function listarUnidadesActivas() {
  const ctx = await requerirVerAlguna(["proceso_compra", "guardar_receta", "alta_producto", "producto_ver_catalogo"]);
  return ctx.db.unidad.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } });
}

/**
 * Desde el Hito 4 (H4C-8): permiso (`conPermisoDeEmpresa("unidades")`) → formato del nombre y de los decimales (`guardComandoCrearUnidad`,
 * core/features/catalogo/unidades.guard.ts, DENTRO del envoltorio) → caso de uso (`casos-de-uso/crear-unidad.ts`: que el nombre esté libre y el alta) → refrescar
 * la vista si salió bien → `aResultadoAccion`, y si salió bien el id y el nombre de la unidad (`okConId`).
 */
export async function crearUnidad(datos: { nombre: string; magnitud: MagnitudUnidad; decimales?: number }): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("unidades", async (ctx) => {
    const comando = guardComandoCrearUnidad(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearUnidadCasoDeUso(ctx, comando.valor);
    // Se llama desde un closure "use server" de la página de Unidades, sin redirigir: sin esto la tabla no cambia (ver refrescar.ts).
    if (r.ok) refrescarVistaSiHaceFalta();
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/** Desde el Hito 4 (H4C-8): permiso → caso de uso (`casos-de-uso/actualizar-activa-unidad.ts`) → refrescar la vista → `aResultadoAccion`. Sin guard (`SIN_GUARD`). */
export async function actualizarActivaUnidad(unidadId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("unidades", async (ctx) => {
    const resultado = await actualizarActivaUnidadCasoDeUso(ctx, { unidadId, activa });
    refrescarVistaSiHaceFalta(); // ver crearUnidad
    return aResultadoAccion(resultado);
  });
}

/**
 * Transición peligrosa (b) de R3 (Task #25, docs/plan-venta-fraccionada-2026-09-26.md — ver el docstring de `pasoVenta` en
 * prisma/schema.prisma): bajar los decimales de una Unidad no puede dejar a un producto "Se produce" (stock real) con un
 * `pasoVenta` que ya no entra en esos decimales — se rechaza, nombrando el primero que rompería (mismo criterio que
 * `dependenciasParaDesactivar`, "avisa qué es").
 *
 * Desde el Hito 4 (H4C-8): permiso → rango de los decimales (`guardComandoActualizarDecimalesUnidad`, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/actualizar-decimales-unidad.ts`: los productos «Se produce», la unidad, y el cambio con su auditoría en UNA transacción) → refrescar la vista si
 * salió bien → `aResultadoAccion`.
 */
export async function actualizarDecimalesUnidad(unidadId: string, decimales: number): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("unidades", async (ctx) => {
    const comando = guardComandoActualizarDecimalesUnidad({ unidadId, decimales });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await actualizarDecimalesUnidadCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta(); // ver crearUnidad
    return aResultadoAccion(resultado);
  });
}

export interface InsumoUnidadMezclada {
  insumo: string;
  unidades: string[];
  cantidadProductos: number;
}

/**
 * Equivalente de detectarInsumosConUnidadMezclada (Catalogo.js:4130+):
 * gateada aunque sea una lectura (mismo criterio que hoy) — por eso no usa
 * `conPermiso` (pensado para mutaciones que devuelven ResultadoAccion),
 * sino el gate inline, devolviendo los datos en éxito.
 */
export async function detectarInsumosConUnidadMezclada(): Promise<
  { ok: true; datos: InsumoUnidadMezclada[] } | { ok: false; mensaje: string }
> {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return { ok: false, mensaje: "No autenticado, o tu usuario no tiene ninguna sucursal asignada." };

  const gate = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "insumos_mezclados", ctx.db);
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const insumos = await ctx.db.insumo.findMany({
    include: { productos: { where: whereDisponibleEnAlguna(), include: { unidadStock: true } } },
  });

  const datos = insumos
    .map((insumo) => ({
      insumo: insumo.nombre,
      unidades: Array.from(new Set(insumo.productos.map((p) => p.unidadStock.nombre))),
      cantidadProductos: insumo.productos.length,
    }))
    .filter((r) => r.unidades.length > 1);

  return { ok: true, datos };
}
