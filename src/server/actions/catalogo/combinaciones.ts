"use server";

import {
  guardComandoFijarEjesDeProducto,
  guardComandoFijarPrecioLocalDeCombinacion,
  guardComandoGuardarCombinacion,
  guardComandoGuardarRecetaDeCombinacion,
} from "@/core/features/catalogo/combinaciones.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { fijarEjesDeCombinacionCasoDeUso } from "./casos-de-uso/fijar-ejes-de-combinacion";
import { fijarPrecioLocalDeCombinacionCasoDeUso } from "./casos-de-uso/fijar-precio-local-de-combinacion";
import { guardarCombinacionDeProductoCasoDeUso } from "./casos-de-uso/guardar-combinacion-de-producto";
import { guardarRecetaDeCombinacionCasoDeUso } from "./casos-de-uso/guardar-receta-de-combinacion";

/**
 * Server Actions del PRECIO POR COMBINACIÓN (GO-3b, ADR-032, frente A). Adaptadores finos: la guarda con su clave (la PRIMERA línea) → guard (dentro del envoltorio) → caso de uso →
 * `aResultadoAccion`.
 *
 * - `producto_opciones_admitidas` (empresa): los ejes de un producto y sus combinaciones (activa o no, con precio propio o sin él).
 * - `precio_local` (sucursal, con su capacidad): el precio de una combinación en la sucursal ACTIVA (lo primero del guard es el eco de la sucursal).
 * - `guardar_receta` (empresa, módulo Recetas): la receta propia de una combinación (frente B).
 *
 * Las tarifas compartidas (grupos de precio, `grupos_de_precio_definir`) se retiraron en la Fase 3 de la ola «precio y carta» (retiro de GO-3a).
 */

export async function fijarEjesDeCombinacion(entrada: { productoId: unknown; eje1GrupoId: unknown; eje2GrupoId: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const comando = guardComandoFijarEjesDeProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarEjesDeCombinacionCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function guardarCombinacionDeProducto(entrada: {
  productoId: unknown;
  opcionEje1Id: unknown;
  opcionEje2Id?: unknown;
  versionEsperada: unknown;
  activa: unknown;
  precio?: unknown;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const comando = guardComandoGuardarCombinacion(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarCombinacionDeProductoCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function fijarPrecioLocalDeCombinacion(entrada: { sucursalId: unknown; combinacionId: unknown; esperado: unknown; precio: unknown }): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    const comando = guardComandoFijarPrecioLocalDeCombinacion({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarPrecioLocalDeCombinacionCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

/** Una versión nueva de la receta propia de una combinación (frente B), con el número de la vigente que vio la pantalla. */
export async function guardarRecetaDeCombinacion(entrada: { combinacionId: unknown; numeroEsperado: unknown; ingredientes: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("guardar_receta", async (ctx) => {
    const comando = guardComandoGuardarRecetaDeCombinacion(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarRecetaDeCombinacionCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
