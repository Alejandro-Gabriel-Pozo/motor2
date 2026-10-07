"use server";

import { texto, validarTextoCatalogo, validarLargoTexto } from "@/core/texto";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";

/** Igual que LARGO_MAXIMO_TEXTO_CATALOGO (texto.ts) pero para `descripcion`: no usa RE_TEXTO_CATALOGO (su charset prohíbe «» y :, y la nota de negocio de BUGFIX A-3 usa ambos) — solo se acota el largo. Mismo tope que ya fija motivos-semilla.test.ts. */
const LARGO_MAXIMO_DESCRIPCION = 300;

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
    const n = texto(nombre);
    if (!n) return error("El nombre del motivo no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del motivo");
    if (invalido) return error(invalido);
    const d = texto(descripcion);
    const errorDescripcion = validarLargoTexto(d, "La descripción", LARGO_MAXIMO_DESCRIPCION);
    if (errorDescripcion) return error(errorDescripcion);

    const existente = await ctx.db.motivoMerma.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return error(`Ya existe un motivo "${existente.nombre}" (no distingue mayúsculas/espacios).`);

    const creado = await ctx.db.motivoMerma.create({ data: { nombre: n, descripcion: d || null } });
    refrescarVistaSiHaceFalta(); // ver crearSeccion — solo lo llama la pantalla de administración, sin quick-create inline
    return okConId(`Motivo "${creado.nombre}" creado.`, creado.id, creado.nombre);
  });
}

/** Alta de un Destino de Consumo. Igual que crearMotivoMerma. */
export async function crearDestinoConsumo(nombre: string, descripcion?: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("motivos_destino_consumo", async (ctx) => {
    const n = texto(nombre);
    if (!n) return error("El nombre del destino no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre del destino");
    if (invalido) return error(invalido);
    const d = texto(descripcion);
    const errorDescripcion = validarLargoTexto(d, "La descripción", LARGO_MAXIMO_DESCRIPCION);
    if (errorDescripcion) return error(errorDescripcion);

    const existente = await ctx.db.destinoConsumo.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return error(`Ya existe un destino "${existente.nombre}" (no distingue mayúsculas/espacios).`);

    const creado = await ctx.db.destinoConsumo.create({ data: { nombre: n, descripcion: d || null } });
    refrescarVistaSiHaceFalta();
    return okConId(`Destino "${creado.nombre}" creado.`, creado.id, creado.nombre);
  });
}

/** Activa/desactiva un Motivo de Merma. Nunca se borra (FK ON DELETE RESTRICT desde Operacion.motivoId) — solo deja de ofrecerse en cargas nuevas. */
export async function actualizarActivoMotivoMerma(motivoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("motivos_merma", async (ctx) => {
    const motivo = await ctx.db.motivoMerma.findUnique({ where: { id: motivoId } });
    if (!motivo) return error("No se encontró el motivo.");

    await ctx.db.motivoMerma.update({ where: { id: motivoId }, data: { activo } });
    refrescarVistaSiHaceFalta();
    return ok(`Motivo "${motivo.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}

/** Activa/desactiva un Destino de Consumo. Igual que actualizarActivoMotivoMerma. */
export async function actualizarActivoDestinoConsumo(destinoId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("motivos_destino_consumo", async (ctx) => {
    const destino = await ctx.db.destinoConsumo.findUnique({ where: { id: destinoId } });
    if (!destino) return error("No se encontró el destino.");

    await ctx.db.destinoConsumo.update({ where: { id: destinoId }, data: { activo } });
    refrescarVistaSiHaceFalta();
    return ok(`Destino "${destino.nombre}" ${activo ? "activado" : "desactivado"}.`);
  });
}
