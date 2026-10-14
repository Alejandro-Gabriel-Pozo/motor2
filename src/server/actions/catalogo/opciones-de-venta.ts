"use server";

import {
  guardComandoAgregarVersionDeOpcion,
  guardComandoCrearGrupoDeOpciones,
  guardComandoCrearOpcionDeGrupo,
  guardComandoEditarGrupoDeOpciones,
  guardComandoEditarOpcionDeGrupo,
  guardComandoFijarAdmisionDeGrupo,
  guardComandoReordenarOpcionesDeGrupo,
} from "@/core/features/catalogo/opciones-de-venta.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermisoDeEmpresa } from "../con-permiso";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { agregarVersionDeOpcionCasoDeUso } from "./casos-de-uso/agregar-version-de-opcion";
import { crearGrupoDeOpcionesCasoDeUso } from "./casos-de-uso/crear-grupo-de-opciones";
import { crearOpcionDeGrupoCasoDeUso } from "./casos-de-uso/crear-opcion-de-grupo";
import { editarGrupoDeOpcionesCasoDeUso } from "./casos-de-uso/editar-grupo-de-opciones";
import { editarOpcionDeGrupoCasoDeUso } from "./casos-de-uso/editar-opcion-de-grupo";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "./casos-de-uso/fijar-admision-de-grupo-en-producto";
import { reordenarOpcionesDeGrupoCasoDeUso } from "./casos-de-uso/reordenar-opciones-de-grupo";

/**
 * Server Actions del CATÁLOGO DE OPCIONES DE VENTA (GO-2a; ADR-030). Cada una es un adaptador fino: permiso (la PRIMERA línea: `conPermisoDeEmpresa` con su clave) → formato y rango
 * (`guardComando…`, dentro del permiso) → caso de uso (reglas, transacción SERIALIZABLE, auditoría) → `aResultadoAccion` (a la pantalla solo llegan `ok` y `mensaje`; ni ids ni códigos).
 *
 * - `opciones_definir` (empresa, piso administrador): los grupos, sus opciones y las versiones de cada opción.
 * - `producto_opciones_admitidas` (empresa, piso administrador): lo que admite cada producto.
 *
 * Las usan las pantallas de GO-2d (`/catalogo/opciones`, la edición de las opciones de un producto). Los argumentos se tipan como `unknown` a propósito: llegan de una puerta HTTP
 * y los valida el guard. GO-2d: al salir bien invalidan la carta pública de la empresa (`revalidarCartasPublicas`): la carta muestra los tamaños, variantes y adicionales.
 */

export async function crearGrupoDeOpciones(entrada: { nombre: unknown; tipo: unknown; cantidadMinima: unknown; cantidadMaxima: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoCrearGrupoDeOpciones(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearGrupoDeOpcionesCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

export async function editarGrupoDeOpciones(entrada: {
  grupoId: unknown;
  versionEsperada: unknown;
  nombre: unknown;
  cantidadMinima: unknown;
  cantidadMaxima: unknown;
  activo: unknown;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoEditarGrupoDeOpciones(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await editarGrupoDeOpcionesCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

export async function crearOpcionDeGrupo(entrada: { grupoId: unknown; nombre: unknown; orden: unknown; esNinguna: unknown; version: unknown; ancla: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoCrearOpcionDeGrupo(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearOpcionDeGrupoCasoDeUso(ctx, comando.valor, azarDelProceso);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

export async function editarOpcionDeGrupo(entrada: { opcionId: unknown; versionEsperada: unknown; nombre: unknown; orden: unknown; activa: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoEditarOpcionDeGrupo(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await editarOpcionDeGrupoCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

export async function agregarVersionDeOpcion(entrada: { opcionId: unknown; numeroEsperado: unknown; version: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoAgregarVersionDeOpcion(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await agregarVersionDeOpcionCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

export async function fijarAdmisionDeGrupoEnProducto(entrada: {
  productoId: unknown;
  grupoId: unknown;
  versionEsperada: unknown;
  orden: unknown;
  cantidadMinima: unknown;
  cantidadMaxima: unknown;
  modoPrecio: unknown;
  activo: unknown;
  opciones: unknown;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const comando = guardComandoFijarAdmisionDeGrupo(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarAdmisionDeGrupoEnProductoCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

// GO-2d: el «mover tocando» de la pantalla del grupo fija el orden de TODAS sus opciones de una sola vez (un orden nunca queda a medias).
export async function reordenarOpcionesDeGrupo(entrada: { grupoId: unknown; opciones: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoReordenarOpcionesDeGrupo(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await reordenarOpcionesDeGrupoCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}
