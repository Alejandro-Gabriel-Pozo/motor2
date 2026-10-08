"use server";

import { guardComandoGuardarGeneroCarta } from "@/core/features/carta/generos.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { actualizarActivoGeneroCartaCasoDeUso } from "./casos-de-uso/actualizar-activo-genero-carta";
import { guardarGeneroCartaCasoDeUso } from "./casos-de-uso/guardar-genero-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Géneros de carta (docs/plan-genero-carta-2026-09-26.md): carpetas VISUALES del POS que agrupan, dentro de una sección de
 * carta, tanto productos sueltos como ítems agrupados que comparten género ("Cerveza"). No
 * implican precio ni sustituibilidad (eso lo sigue manejando `ItemAgrupadoCarta`); no son `Grupo` (Insumo/stock) ni
 * `CategoriaProducto` (que no ubica nada en la carta). Solo escriben en `GeneroCarta`. Son PROPIOS de cada sucursal (ADR-009, C3): se crean y
 * se editan siempre en la sucursal activa. Gate: `carta_generos`.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) las dos acciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{guardar-genero-carta,actualizar-activo-genero-carta}.ts`; escrituras en server/persistencia/carta/generos.ts; el formato en
 * core/features/carta/generos.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las dos revalidan la carta pública solo si salió bien, como antes.
 */

export interface DatosGeneroCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  nombre: string;
  orden?: number | string | null;
}

/**
 * Alta (sin `id`) o edición (con `id`) de un género de la sucursal activa. Permiso (`conPermisoDeEmpresa("carta_generos")`) → formato de los datos
 * (`guardComandoGuardarGeneroCarta`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/guardar-genero-carta.ts`) → revalidar la carta pública si salió bien →
 * `aResultadoAccion` y el id y el nombre para el `ResultadoConId`.
 */
export async function guardarGeneroCarta(datos: DatosGeneroCarta): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("carta_generos", async (ctx) => {
    const comando = guardComandoGuardarGeneroCarta(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await guardarGeneroCartaCasoDeUso(ctx, comando.valor);
    if (r.ok) revalidarCartasPublicas();
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Nunca se borra un género: se apaga (deja de mostrarse como carpeta; lo que tenía ese género queda suelto, sin error, D). Permiso → caso de uso
 * (`casos-de-uso/actualizar-activo-genero-carta.ts`) → revalidar si salió bien → `aResultadoAccion`. Sin guard (`SIN_GUARD`).
 */
export async function actualizarActivoGeneroCarta(generoCartaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_generos", async (ctx) => {
    const resultado = await actualizarActivoGeneroCartaCasoDeUso(ctx, { generoCartaId, activo });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
