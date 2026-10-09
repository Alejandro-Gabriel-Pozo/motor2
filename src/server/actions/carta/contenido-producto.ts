"use server";

import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import type { ResultadoAccion } from "../tipos";
import { actualizarVisibleEnCartaCasoDeUso } from "./casos-de-uso/actualizar-visible-en-carta";
import { guardarContenidoCartaProductoCasoDeUso } from "./casos-de-uso/guardar-contenido-carta-producto";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Contenido de cara al cliente de un PV en la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M9): si se muestra, en qué
 * sección de carta, su descripción, tags, ★ especial y orden. La sección se elige DIRECTO, sin Categoría de producto de por medio,
 * y no hay imagen por producto: la carta solo dibuja la de la sección (docs/plan-carta-seccion-directa-2026-09-25.md). Solo escribe
 * en `ContenidoCartaProducto`; el producto (nombre, precio, categoría, disponibilidad) se sigue editando donde siempre. Sin fila =
 * no se muestra (D3): guardar el contenido de un PV es lo que lo hace aparecer. La carta es PROPIA de cada sucursal (ADR-009, C3): escribe siempre en
 * la sucursal activa (`ctx.sucursalId`), nunca en otra. Gate: `carta_contenido_producto`, de contexto SUCURSAL desde S-10/D1 (fila O.59): se evalúa en la sucursal donde se escribe.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) las dos acciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{guardar-contenido-carta-producto,actualizar-visible-en-carta}.ts`; escrituras en server/persistencia/carta/contenido-producto.ts): el archivo
 * entero está en `ACCIONES_CON_CASO_DE_USO`. Las dos son `SIN_GUARD` (el producto se lee antes de validar nada) y revalidan la carta pública solo si salió bien.
 */

export interface DatosContenidoCarta {
  visibleEnCarta: boolean;
  /** Obligatoria si `visibleEnCarta` (DA2); vacío/null = sin sección (solo para un contenido oculto). */
  seccionCartaId?: string | null;
  descripcion?: string | null;
  /** Lista, o texto separado por comas (separado por comas). */
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: number | string | null;
  /** Carpeta de género del POS (docs/plan-genero-carta-2026-09-26.md), OPCIONAL: vacío/null = sin género (sale suelto). */
  generoCartaId?: string | null;
}

/** Permiso → caso de uso (`casos-de-uso/guardar-contenido-carta-producto.ts`: el producto, la validación, la sección, el género y el `upsert`) → revalidar si salió bien → `aResultadoAccion`. */
export async function guardarContenidoCartaProducto(productoId: string, datos: DatosContenidoCarta): Promise<ResultadoAccion> {
  return conPermiso("carta_contenido_producto", async (ctx) => {
    const resultado = await guardarContenidoCartaProductoCasoDeUso(ctx, { productoId, datos });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/**
 * Atajo para mostrar/ocultar sin tocar el resto del contenido (crea la fila si no existía, con el resto vacío). Mostrar exige que
 * el contenido ya tenga sección de carta (DA2): si no, hay que elegirla con `guardarContenidoCartaProducto`. Permiso → caso de uso
 * (`casos-de-uso/actualizar-visible-en-carta.ts`) → revalidar si salió bien → `aResultadoAccion`.
 */
export async function actualizarVisibleEnCarta(productoId: string, visibleEnCarta: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta_contenido_producto", async (ctx) => {
    const resultado = await actualizarVisibleEnCartaCasoDeUso(ctx, { productoId, visibleEnCarta });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
