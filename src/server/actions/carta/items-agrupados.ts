"use server";

import { guardComandoActualizarOrdenOpcionItemAgrupadoCarta, guardComandoGuardarItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { actualizarActivoItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/actualizar-activo-item-agrupado-carta";
import { agregarOpcionItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/agregar-opcion-item-agrupado-carta";
import { actualizarOrdenOpcionItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/actualizar-orden-opcion-item-agrupado-carta";
import { guardarItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/guardar-item-agrupado-carta";
import { quitarOpcionItemAgrupadoCartaCasoDeUso } from "./casos-de-uso/quitar-opcion-item-agrupado-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Ítems AGRUPADOS de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M5): un renglón visible ("Gaseosa 500 CC") que
 * agrupa varios PV reales (Coca-Cola, Sprite, Fanta 500cc). PROPIOS de cada sucursal (ADR-009, C3): se crean y se editan siempre en la
 * sucursal activa; la sección donde se ubican sí es de la empresa. Solo escriben en `ItemAgrupadoCarta`
 * y `OpcionItemAgrupadoCarta`: el producto (nombre, precio, categoría, disponibilidad) y su `ContenidoCartaProducto` no se tocan.
 * Nunca se borra un ítem agrupado: se apaga. Quitar una opción borra solo la fila de referencia. Gate: `carta_items_agrupados`.
 *
 * UBICACIÓN (docs/plan-carta-seccion-directa-2026-09-25.md): el ítem agrupado elige su sección de carta DIRECTO, sin Categoría
 * de producto de por medio, y no tiene imagen propia (la carta solo dibuja la de la sección).
 *
 * PRECIO (D5, decisión del dueño): el ítem agrupado no tiene precio propio y solo se agrupan productos del MISMO precio. Por eso
 * `agregarOpcionItemAgrupadoCarta` BLOQUEA una opción cuyo precio (con `precioDeCarta`, en la sucursal activa de quien administra)
 * no coincide con el de las opciones ya cargadas. Si el precio de una opción cambia DESPUÉS en Catálogo o en Precio Local, la carta
 * muestra el mayor y la pantalla avisa (red de seguridad de `armarMenuCarta`), porque eso no se puede bloquear desde acá.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) las cinco acciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{guardar-item-agrupado-carta,actualizar-activo-item-agrupado-carta,agregar-opcion-item-agrupado-carta,actualizar-orden-opcion-item-agrupado-carta,quitar-opcion-item-agrupado-carta}.ts`;
 * escrituras en server/persistencia/carta/items-agrupados.ts; el formato en core/features/carta/items-agrupados.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`.
 * Todas revalidan la carta pública solo si salió bien, como antes; el alta lo hace por el tercer parámetro del caso de uso (una vez por el ítem y otra por cada producto que entra).
 */

export interface DatosItemAgrupadoCarta {
  /** Sin id = alta; con id = edición. */
  id?: string;
  nombre: string;
  /** La sección de carta donde se ubica (obligatoria). */
  seccionCartaId: string;
  descripcion?: string | null;
  /** Lista, o texto separado por comas (separado por comas). */
  tags?: readonly string[] | string | null;
  especial?: boolean;
  orden?: number | string | null;
  /**
   * Carpeta de género del POS (docs/plan-genero-carta-2026-09-26.md), OPCIONAL: vacío/null = sin género (sale suelto). Las
   * opciones del ítem agrupado heredan este género: nunca tienen uno propio.
   */
  generoCartaId?: string | null;
  /**
   * SOLO en el alta (DA7, docs/plan-carta-seccion-directa-2026-09-25.md): productos a agregar como opciones apenas se crea el ítem,
   * en este orden y con la MISMA validación que `agregarOpcionItemAgrupadoCarta` (PV, que no esté en otro grupo, mismo precio D5).
   * Los que no entran no frenan el alta: el mensaje final dice cuáles y por qué. Al editar se ignora (para sumar opciones a un
   * ítem existente está "Agregar producto").
   */
  productoIds?: readonly string[] | null;
}

/**
 * Alta (sin `id`) o edición (con `id`) de un ítem agrupado. Permiso (`conPermiso("carta_items_agrupados")`: S-10/D1, fila O.59, la clave es de contexto SUCURSAL) → formato de los datos
 * (`guardComandoGuardarItemAgrupadoCarta`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/guardar-item-agrupado-carta.ts`, que revalida la carta pública por
 * `avisos.cartaCambio`) → `aResultadoAccion` y el id y el nombre para el `ResultadoConId`.
 */
export async function guardarItemAgrupadoCarta(datos: DatosItemAgrupadoCarta): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("carta_items_agrupados", async (ctx) => {
    const comando = guardComandoGuardarItemAgrupadoCarta(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await guardarItemAgrupadoCartaCasoDeUso(ctx, comando.valor, { cartaCambio: revalidarCartasPublicas });
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/** Nunca se borra un ítem agrupado: se apaga (deja de salir en la carta, y sus opciones tampoco salen sueltas, D3). */
export async function actualizarActivoItemAgrupadoCarta(itemAgrupadoCartaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta_items_agrupados", async (ctx) => {
    const resultado = await actualizarActivoItemAgrupadoCartaCasoDeUso(ctx, { itemAgrupadoCartaId, activo });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/**
 * Agrega un PV como opción de un ítem agrupado. BLOQUEA (D5) si su precio en la sucursal activa no coincide con el de TODAS las
 * opciones ya cargadas (calculado igual que la carta, `precioDeCarta`). El primer producto de un ítem sin opciones entra siempre.
 * La categoría del producto no importa: la opción sale (y sus ventas se cuentan) en la sección del ítem agrupado. Permiso → caso de uso
 * (`casos-de-uso/agregar-opcion-item-agrupado-carta.ts`) → revalidar si salió bien → `aResultadoAccion`. Sin guard (`SIN_GUARD`).
 */
export async function agregarOpcionItemAgrupadoCarta(itemAgrupadoCartaId: string, productoId: string, orden: number | string | null = null): Promise<ResultadoAccion> {
  return conPermiso("carta_items_agrupados", async (ctx) => {
    const resultado = await agregarOpcionItemAgrupadoCartaCasoDeUso(ctx, { itemAgrupadoCartaId, productoId, orden });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

export async function actualizarOrdenOpcionItemAgrupadoCarta(opcionId: string, orden: number | string | null): Promise<ResultadoAccion> {
  return conPermiso("carta_items_agrupados", async (ctx) => {
    const comando = guardComandoActualizarOrdenOpcionItemAgrupadoCarta({ opcionId, orden });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await actualizarOrdenOpcionItemAgrupadoCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/** Saca un producto de su ítem agrupado: se borra solo la referencia. El producto y su ContenidoCartaProducto no se tocan (D3). */
export async function quitarOpcionItemAgrupadoCarta(opcionId: string): Promise<ResultadoAccion> {
  return conPermiso("carta_items_agrupados", async (ctx) => {
    const resultado = await quitarOpcionItemAgrupadoCartaCasoDeUso(ctx, { opcionId });
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
