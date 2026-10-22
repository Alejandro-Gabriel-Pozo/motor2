"use server";

import {
  guardComandoAgregarVersionDeOpcion,
  guardComandoArchivarOpciones,
  guardComandoCrearGrupoDeOpciones,
  guardComandoCrearGrupoEnElProducto,
  guardComandoCrearOpcionDeGrupo,
  guardComandoCrearOpcionEnElProducto,
  guardComandoEditarGrupoDeOpciones,
  guardComandoEditarOpcionDeGrupo,
  guardComandoFijarAdmisionDeGrupo,
  guardComandoReordenarOpcionesDeGrupo,
  guardComandoVincularGrupoEnProducto,
} from "@/core/features/catalogo/opciones-de-venta.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermisoDeEmpresa, exigirTambienPermisoDeEmpresa } from "../con-permiso";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { agregarVersionDeOpcionCasoDeUso } from "./casos-de-uso/agregar-version-de-opcion";
import { archivarOpcionesCasoDeUso } from "./casos-de-uso/archivar-opciones";
import { crearGrupoDeOpcionesCasoDeUso } from "./casos-de-uso/crear-grupo-de-opciones";
import { crearGrupoEnElProductoCasoDeUso } from "./casos-de-uso/crear-grupo-en-el-producto";
import { crearOpcionDeGrupoCasoDeUso } from "./casos-de-uso/crear-opcion-de-grupo";
import { crearOpcionEnElProductoCasoDeUso } from "./casos-de-uso/crear-opcion-en-el-producto";
import { editarGrupoDeOpcionesCasoDeUso } from "./casos-de-uso/editar-grupo-de-opciones";
import { editarOpcionDeGrupoCasoDeUso } from "./casos-de-uso/editar-opcion-de-grupo";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "./casos-de-uso/fijar-admision-de-grupo-en-producto";
import { reordenarOpcionesDeGrupoCasoDeUso } from "./casos-de-uso/reordenar-opciones-de-grupo";
import { vincularGrupoEnProductoCasoDeUso } from "./casos-de-uso/vincular-grupo-en-producto";

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

export async function crearGrupoDeOpciones(entrada: { nombre: unknown; tipo: unknown; cantidadMinima: unknown; cantidadMaxima: unknown; prefijoEnCarta?: unknown }): Promise<ResultadoAccion> {
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
  /** Fase 4 (ADR-035): «se lee en la carta como»; no viene = queda como estaba. */
  prefijoEnCarta?: unknown;
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

// OPCIONES-LIMPIEZA (decisión del dueño, 2026-10-14): ARCHIVAR o RESTAURAR grupos y opciones, de a uno («Archivar» con «Deshacer») o en lote («Limpiar»), todo o nada. Misma clave que
// editar el grupo o la opción (`opciones_definir`, piso administrador): archivar es la misma columna (`activo`/`activa`) que el «Apagar» que esa clave ya permitía, ahora con su propia
// pantalla de archivados para restaurar; no da ningún poder nuevo.
export async function archivarOpciones(entrada: { grupoIds: unknown; opcionIds: unknown; archivar: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("opciones_definir", async (ctx) => {
    const comando = guardComandoArchivarOpciones(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await archivarOpcionesCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // La carta pública muestra las opciones: archivar una la saca (y restaurarla la vuelve a poner). Solo la caché de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

// OPCIONES-LIMPIEZA: «Quitar de este producto» un grupo (y su «Deshacer», volver a vincularlo). Misma clave que fijar lo que admite el producto (`producto_opciones_admitidas`): es la
// misma columna (`ProductoAdmiteGrupo.activo`) que el formulario del grupo ya cambiaba; volver a vincular pasa por las mismas reglas de la admisión.
export async function vincularGrupoEnProducto(entrada: { productoId: unknown; grupoId: unknown; vinculado: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const comando = guardComandoVincularGrupoEnProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await vincularGrupoEnProductoCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // La carta pública muestra las opciones de cada producto: quitar un grupo lo saca de ese producto.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

// Fase 6 («el espacio del producto», 6.14c; ADR-030, «El comando compuesto»): CREAR UN GRUPO sin salir del producto, todo o nada: el grupo de la biblioteca, sus opciones y lo que el producto admite de ellas, en UNA
// transacción. Pide las DOS claves que hoy se piden en dos pantallas (crear el grupo, `opciones_definir`; agregarlo al producto, `producto_opciones_admitidas`): ninguna clave nueva y nadie puede nada que antes no pudiera.
// La primera la pide el envoltorio y la segunda va como PRIMERA línea de adentro (`exigirTambienPermisoDeEmpresa`), antes de formatear nada: la ficha del caso de uso la declara (`permiso=a+b`) y
// `ficha-de-caso-de-uso.test.ts` la lee del código. Nunca modifica un grupo de la biblioteca: uno idéntico se adopta, uno distinto se rechaza.
export async function crearGrupoEnElProducto(entrada: { productoId: unknown; nombre: unknown; respuesta: unknown; prefijoEnCarta?: unknown; opciones: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const tambien = await exigirTambienPermisoDeEmpresa(ctx, "opciones_definir");
    if (!tambien.ok) return error(tambien.mensaje);
    const comando = guardComandoCrearGrupoEnElProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearGrupoEnElProductoCasoDeUso(ctx, comando.valor, azarDelProceso);
    if (resultado.ok) {
      // La carta pública muestra las opciones de cada producto (y sus precios): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

// «+ Opción» / «+ Extra»: AGREGAR UNA OPCIÓN a un grupo que el producto ya usa, sin salir del producto, todo o nada: la opción en el grupo de la biblioteca (y, en un extra, su producto de respaldo) y lo que ESTE producto
// admite de ella, en UNA transacción. Las mismas DOS claves que «+ Nuevo grupo» y por la misma razón (hoy son dos pantallas: crear la opción, `opciones_definir`; admitirla en el producto, `producto_opciones_admitidas`): ninguna
// clave nueva y nadie puede nada que antes no pudiera. La primera la pide el envoltorio y la segunda va como PRIMERA línea de adentro (`exigirTambienPermisoDeEmpresa`), antes de formatear nada: la ficha del caso de uso la
// declara (`permiso=a+b`) y `ficha-de-caso-de-uso.test.ts` la lee del código. Qué lleva la opción (un precio final, una suma o nada; el respaldo solo en un adicional) lo decide el caso de uso con el tipo del grupo que lee.
export async function crearOpcionEnElProducto(entrada: { productoId: unknown; grupoId: unknown; versionEsperada: unknown; nombre: unknown; importe?: unknown; unidadStockId?: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_opciones_admitidas", async (ctx) => {
    const tambien = await exigirTambienPermisoDeEmpresa(ctx, "opciones_definir");
    if (!tambien.ok) return error(tambien.mensaje);
    const comando = guardComandoCrearOpcionEnElProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await crearOpcionEnElProductoCasoDeUso(ctx, comando.valor, azarDelProceso);
    if (resultado.ok) {
      // La carta pública muestra las opciones de cada producto (y sus precios): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}
