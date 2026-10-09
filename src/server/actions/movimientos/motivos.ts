"use server";

import { guardComandoCrearDestinoConsumo, guardComandoCrearMotivoMerma } from "@/core/features/movimientos/motivos.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";
import { actualizarActivoDestinoConsumoCasoDeUso } from "./casos-de-uso/actualizar-activo-destino-consumo";
import { actualizarActivoMotivoMermaCasoDeUso } from "./casos-de-uso/actualizar-activo-motivo-merma";
import { crearDestinoConsumoCasoDeUso } from "./casos-de-uso/crear-destino-consumo";
import { crearMotivoMermaCasoDeUso } from "./casos-de-uso/crear-motivo-merma";

/**
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-17) las cuatro mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{crear-motivo-merma,crear-destino-consumo,actualizar-activo-motivo-merma,actualizar-activo-destino-consumo}.ts`; escrituras en
 * server/persistencia/movimientos/motivos.ts; el formato de las altas en core/features/movimientos/motivos.guard.ts): el archivo entero está en
 * `ACCIONES_CON_CASO_DE_USO`. Las lecturas (H8) siguen acá con sus guardas. La acción refresca la vista en los mismos caminos que antes (solo si salió bien).
 */

/**
 * Lecturas de los catálogos Motivo de Merma / Destino de Consumo (plan "motivos de Consumo/Merma como catálogo
 * administrable", 2026-09-23, P5/P6) — a diferencia de Secciones, estos dos catálogos son GLOBALES (no por sucursal,
 * mismo criterio que Insumo/Grupo/CategoriaProducto). Las *Activos pueblan el <select> del panel de Merma / de Consumo
 * y exigen el «Ver» de ESE proceso (`proceso_merma` / `proceso_consumo`), la clave de la única pantalla que las consume
 * (H8, decisión del dueño: ninguna lectura queda con solo sesión). Las *ParaPanel exigen la clave de SU catálogo
 * ('motivos_merma' / 'motivos_destino_consumo') — para la pantalla de administración (P6), que también necesita ver los desactivados.
 */
export async function listarMotivosMermaActivos() {
  const ctx = await requerirVer("proceso_merma");
  return ctx.db.motivoMerma.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}

export async function listarDestinosConsumoActivos() {
  const ctx = await requerirVer("proceso_consumo");
  return ctx.db.destinoConsumo.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}

export async function listarMotivosMermaParaPanel() {
  const ctx = await requerirVerDeEmpresa("motivos_merma");
  return ctx.db.motivoMerma.findMany({ orderBy: { nombre: "asc" } });
}

export async function listarDestinosConsumoParaPanel() {
  const ctx = await requerirVerDeEmpresa("motivos_destino_consumo");
  return ctx.db.destinoConsumo.findMany({ orderBy: { nombre: "asc" } });
}

/** Alta de un Motivo de Merma. Dedup case-insensible: RECHAZA (no reusa) un nombre ya existente — mismo criterio que crearSeccion, a diferencia de crearCategoriaProducto (que sí reusa porque también la llama un quick-create inline; acá nadie más la llama). */
export async function crearMotivoMerma(nombre: string, descripcion?: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("motivos_merma", async (ctx) => {
    const comando = guardComandoCrearMotivoMerma({ nombre, descripcion });
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearMotivoMermaCasoDeUso(ctx, comando.valor);
    if (r.ok) refrescarVistaSiHaceFalta(); // ver crearSeccion — solo lo llama la pantalla de administración, sin quick-create inline
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/** Alta de un Destino de Consumo. Igual que crearMotivoMerma. */
export async function crearDestinoConsumo(nombre: string, descripcion?: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("motivos_destino_consumo", async (ctx) => {
    const comando = guardComandoCrearDestinoConsumo({ nombre, descripcion });
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearDestinoConsumoCasoDeUso(ctx, comando.valor);
    if (r.ok) refrescarVistaSiHaceFalta();
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Activa/desactiva un Motivo de Merma. Nunca se borra (FK ON DELETE RESTRICT desde Operacion.motivoId) — solo deja de ofrecerse en cargas nuevas. Sin guard
 * (`SIN_GUARD`: solo recibe un id y un booleano).
 */
export async function actualizarActivoMotivoMerma(motivoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("motivos_merma", async (ctx) => {
    const resultado = await actualizarActivoMotivoMermaCasoDeUso(ctx, { id: motivoId, activo });
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

/** Activa/desactiva un Destino de Consumo. Igual que actualizarActivoMotivoMerma. */
export async function actualizarActivoDestinoConsumo(destinoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("motivos_destino_consumo", async (ctx) => {
    const resultado = await actualizarActivoDestinoConsumoCasoDeUso(ctx, { id: destinoId, activo });
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
