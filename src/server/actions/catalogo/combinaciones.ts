"use server";

import {
  guardComandoCrearGrupoDePrecio,
  guardComandoEditarGrupoDePrecio,
  guardComandoFijarEjesDeProducto,
  guardComandoFijarPrecioLocalDeCombinacion,
  guardComandoGuardarCombinacion,
} from "@/core/features/catalogo/combinaciones.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { crearGrupoDePrecioCasoDeUso } from "./casos-de-uso/crear-grupo-de-precio";
import { editarGrupoDePrecioCasoDeUso } from "./casos-de-uso/editar-grupo-de-precio";
import { fijarEjesDeCombinacionCasoDeUso } from "./casos-de-uso/fijar-ejes-de-combinacion";
import { fijarPrecioLocalDeCombinacionCasoDeUso } from "./casos-de-uso/fijar-precio-local-de-combinacion";
import { guardarCombinacionDeProductoCasoDeUso } from "./casos-de-uso/guardar-combinacion-de-producto";

/**
 * Server Actions del PRECIO POR COMBINACIÓN (GO-3b, ADR-032, frente A). Adaptadores finos: la guarda con su clave (la PRIMERA línea) → guard (dentro del envoltorio) → caso de uso →
 * `aResultadoAccion`.
 *
 * - `producto_opciones_admitidas` (empresa): los ejes de un producto y sus combinaciones (activa o no, precio propio o tarifa).
 * - `grupos_de_precio_definir` (empresa, piso administrador): las tarifas compartidas.
 * - `precio_local` (sucursal, con su capacidad): el precio de una combinación o de una tarifa en la sucursal ACTIVA (lo primero del guard es el eco de la sucursal).
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
  grupoDePrecioId?: unknown;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const comando = guardComandoGuardarCombinacion(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarCombinacionDeProductoCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function crearGrupoDePrecio(entrada: { nombre: unknown; precio: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("grupos_de_precio_definir", async (ctx) => {
    const comando = guardComandoCrearGrupoDePrecio(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearGrupoDePrecioCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function editarGrupoDePrecio(entrada: { grupoDePrecioId: unknown; versionEsperada: unknown; nombre: unknown; precio: unknown; activo: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("grupos_de_precio_definir", async (ctx) => {
    const comando = guardComandoEditarGrupoDePrecio(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await editarGrupoDePrecioCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function fijarPrecioLocalDeCombinacion(entrada: { sucursalId: unknown; combinacionId?: unknown; grupoDePrecioId?: unknown; esperado: unknown; precio: unknown }): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    const comando = guardComandoFijarPrecioLocalDeCombinacion({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarPrecioLocalDeCombinacionCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
