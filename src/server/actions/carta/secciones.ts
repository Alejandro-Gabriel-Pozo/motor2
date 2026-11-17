"use server";

import {
  guardComandoAgregarProductoAFamilia,
  guardComandoCrearFamiliaDeProducto,
  guardComandoEditarFamiliaDeProducto,
  guardComandoFijarActivaFamiliaDeProducto,
  guardComandoQuitarProductoDeFamilia,
} from "@/core/features/carta/familias.guard";
import { guardComandoGuardarSeccionCarta, guardComandoOrdenarSeccionesCarta } from "@/core/features/carta/secciones.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { actualizarActivaSeccionCartaCasoDeUso } from "./casos-de-uso/actualizar-activa-seccion-carta";
import { agregarProductoAFamiliaCasoDeUso } from "./casos-de-uso/agregar-producto-a-familia";
import { crearFamiliaDeProductoCasoDeUso } from "./casos-de-uso/crear-familia-de-producto";
import { editarFamiliaDeProductoCasoDeUso } from "./casos-de-uso/editar-familia-de-producto";
import { fijarActivaFamiliaDeProductoCasoDeUso } from "./casos-de-uso/fijar-activa-familia-de-producto";
import { guardarSeccionCartaCasoDeUso } from "./casos-de-uso/guardar-seccion-carta";
import { ordenarSeccionesCartaCasoDeUso } from "./casos-de-uso/ordenar-secciones-carta";
import { quitarProductoDeFamiliaCasoDeUso } from "./casos-de-uso/quitar-producto-de-familia";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Secciones de carta (docs/plan-carta-catalogo-2026-09-24.md, M9). De la EMPRESA, no de la sucursal (decisión D4; la carta propia de cada
 * sucursal, ADR-009 C3, decide qué contenido pone en cada sección, no las secciones). Solo escriben en
 * `SeccionCarta`. Cada producto suelto y cada ítem agrupado elige su sección directo (docs/plan-carta-seccion-directa-2026-09-25.md):
 * la Categoría de producto no ubica nada en la carta. Gate: `carta_secciones` (empresa; solo admin en la semilla).
 *
 * También viven acá las acciones de las FAMILIAS DE PRODUCTOS (etapa F1, `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`): son de la EMPRESA y con el mismo permiso que las secciones (`carta_secciones`; decisión D1: quien
 * edita la carta crea y edita familias, sin permiso nuevo). Van en este archivo, que ya está clasificado como migrado a casos de uso, en lugar de un archivo nuevo. La empresa sale del contexto del servidor, nunca del pedido; los
 * ids de las filas nuevas los genera el servidor (`azarDelProceso.uuid()`), así un reintento no crea dos. Ninguna revalida la carta pública: nada la lee todavía (las familias entran a la carta en la etapa F4).
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) las dos acciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{guardar-seccion-carta,actualizar-activa-seccion-carta}.ts`; escrituras en server/persistencia/carta/secciones.ts; el formato en
 * core/features/carta/secciones.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las dos revalidan la carta pública solo si salió bien, como antes.
 */

export interface DatosSeccionCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  nombre: string;
  titulo?: string | null;
  descripcion?: string | null;
  imagenUrl?: string | null;
  orden?: number | string | null;
}

/**
 * Alta (sin `id`) o edición (con `id`) de una sección de carta. Permiso (`conPermisoDeEmpresa("carta_secciones")`) → formato de los datos
 * (`guardComandoGuardarSeccionCarta`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/guardar-seccion-carta.ts`) → revalidar la carta pública si salió bien
 * → `aResultadoAccion` y el id y el nombre para el `ResultadoConId`.
 */
export async function guardarSeccionCarta(datos: DatosSeccionCarta): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("carta_secciones", async (ctx) => {
    const comando = guardComandoGuardarSeccionCarta(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await guardarSeccionCartaCasoDeUso(ctx, comando.valor);
    if (r.ok) revalidarCartasPublicas(ctx.empresaSlug);
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Nunca se borra una sección de carta: se apaga (deja de salir en la carta con todo lo suyo) y se puede volver a prender. Permiso → caso de uso
 * (`casos-de-uso/actualizar-activa-seccion-carta.ts`) → revalidar si salió bien → `aResultadoAccion`. Sin guard (`SIN_GUARD`).
 */
export async function actualizarActivaSeccionCarta(seccionCartaId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const resultado = await actualizarActivaSeccionCartaCasoDeUso(ctx, { seccionCartaId, activa });
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/**
 * CARTA-MANT F3 «Ordenar» (prototipo aprobado): el orden nuevo de TODAS las secciones de la empresa, de una vez. La misma clave que editar una sección (`carta_secciones`, de empresa: las secciones son
 * de la empresa y el orden rige en todas las sucursales). Permiso → formato (`guardComandoOrdenarSeccionesCarta`) → caso de uso (`casos-de-uso/ordenar-secciones-carta.ts`, SERIALIZABLE, contra el
 * orden visto, con auditoría) → revalidar la carta pública si cambió algo → `aResultadoAccion`.
 */
export async function ordenarSeccionesCarta(entrada: { secciones: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const comando = guardComandoOrdenarSeccionesCarta(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await ordenarSeccionesCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.cambiadas > 0) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/** «Crear una familia» (CU-F1): solo el nombre; los dos interruptores nacen apagados. Permiso → formato (`guardComandoCrearFamiliaDeProducto`) → caso de uso (SERIALIZABLE, con auditoría) → `aResultadoAccion`. */
export async function crearFamiliaDeProducto(entrada: { nombre: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const comando = guardComandoCrearFamiliaDeProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await crearFamiliaDeProductoCasoDeUso(ctx, { ...comando.valor, id: azarDelProceso.uuid() }));
  });
}

/** «Editar una familia» (CU-F2): el nombre y los dos interruptores, por estado deseado y contra la versión que vio la pantalla. */
export async function editarFamiliaDeProducto(entrada: { familiaId: unknown; versionEsperada: unknown; nombre: unknown; agruparEnCarta: unknown; agruparEnPos: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const comando = guardComandoEditarFamiliaDeProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await editarFamiliaDeProductoCasoDeUso(ctx, comando.valor));
  });
}

/** «Desactivar o reactivar una familia» (CU-F5): nunca se borra; sus miembros siguen siéndolo. Por estado deseado y contra la versión vista. */
export async function fijarActivaFamiliaDeProducto(entrada: { familiaId: unknown; versionEsperada: unknown; activa: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const comando = guardComandoFijarActivaFamiliaDeProducto(entrada);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await fijarActivaFamiliaDeProductoCasoDeUso(ctx, comando.valor));
  });
}

/** «Agregar un producto a una familia» (CU-F3): solo un producto de venta, en una sola familia a la vez y fuera de los ítems agrupados. El id de la fila del miembro lo genera el servidor. */
export async function agregarProductoAFamilia(entrada: { familiaId: unknown; productoId: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const comando = guardComandoAgregarProductoAFamilia(entrada);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await agregarProductoAFamiliaCasoDeUso(ctx, { ...comando.valor, miembroId: azarDelProceso.uuid() }));
  });
}

/** «Quitar un producto de una familia» (CU-F4): no borra, escribe quién y cuándo. Contra la versión de la familia que vio la pantalla. */
export async function quitarProductoDeFamilia(entrada: { familiaId: unknown; productoId: unknown; versionEsperada: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_secciones", async (ctx) => {
    const comando = guardComandoQuitarProductoDeFamilia(entrada);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await quitarProductoDeFamiliaCasoDeUso(ctx, comando.valor));
  });
}
