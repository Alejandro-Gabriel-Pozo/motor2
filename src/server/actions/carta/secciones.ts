"use server";

import { guardComandoGuardarSeccionCarta } from "@/core/features/carta/secciones.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { actualizarActivaSeccionCartaCasoDeUso } from "./casos-de-uso/actualizar-activa-seccion-carta";
import { guardarSeccionCartaCasoDeUso } from "./casos-de-uso/guardar-seccion-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Secciones de carta (docs/plan-carta-catalogo-2026-09-24.md, M9). De la EMPRESA, no de la sucursal (decisión D4; la carta propia de cada
 * sucursal, ADR-009 C3, decide qué contenido pone en cada sección, no las secciones). Solo escriben en
 * `SeccionCarta`. Cada producto suelto y cada ítem agrupado elige su sección directo (docs/plan-carta-seccion-directa-2026-09-25.md):
 * la Categoría de producto no ubica nada en la carta. Gate: `carta_secciones` (empresa; solo admin en la semilla).
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
    if (r.ok) revalidarCartasPublicas();
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
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
