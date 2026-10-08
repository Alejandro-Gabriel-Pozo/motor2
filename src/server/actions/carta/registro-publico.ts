"use server";

import {
  guardComandoAgregarSucursalAlPortal,
  guardComandoGuardarSucursalPublica,
  guardComandoMoverSucursalEnMapa,
  guardComandoQuitarSucursalDelPortal,
} from "@/core/features/carta/registro-publico.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { agregarSucursalAlPortalCasoDeUso } from "./casos-de-uso/agregar-sucursal-al-portal";
import { guardarSucursalPublicaCasoDeUso } from "./casos-de-uso/guardar-sucursal-publica";
import { moverSucursalEnMapaCasoDeUso } from "./casos-de-uso/mover-sucursal-en-mapa";
import { quitarSucursalDelPortalCasoDeUso } from "./casos-de-uso/quitar-sucursal-del-portal";
import { revalidarCartasPublicas } from "./revalidar";
/**
 * Registro público de las sucursales en el portal/carta (docs/plan-registro-tenants-2026-09-24.md, M6): lo que
 * arma el portal de la carta pública interna (ADR-006). Solo escriben en
 * `SucursalPublica` (lo fija test/arquitectura/carta-solo-lectura.test.ts): la sucursal en sí (nombre, activa) se sigue
 * administrando en Administración → Sucursales. Gate: `carta_portal` (empresa: se administra el portal de todas las sucursales).
 *
 * Las tres reciben el `Sucursal.id` (la fila es 1:1 con la sucursal). No dependen de la sucursal activa de quien llama: el mapa
 * del portal es entre sucursales.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) las cuatro acciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{agregar-sucursal-al-portal,guardar-sucursal-publica,quitar-sucursal-del-portal,mover-sucursal-en-mapa}.ts`; escrituras en
 * server/persistencia/carta/registro-publico.ts; el formato en core/features/carta/registro-publico.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`.
 * Las cuatro revalidan la carta pública solo si salió bien, como antes.
 */

/**
 * Agrega la sucursal al registro del portal (D3, opt-in): crea su fila SIN publicar, con el slug calculado UNA vez desde el
 * nombre (`slugTenant`) y desambiguado contra los que ya existen (`-2`, `-3`…). Si hace falta otra dirección, el slug se edita después a mano. Ante una carrera con otra alta que tomó el mismo slug (P2002), reintenta.
 * Permiso → id (`guardComandoAgregarSucursalAlPortal`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/agregar-sucursal-al-portal.ts`) → revalidar si salió bien → `aResultadoAccion`.
 */
export async function agregarSucursalAlPortal(sucursalId: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    const comando = guardComandoAgregarSucursalAlPortal(sucursalId);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await agregarSucursalAlPortalCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

export interface DatosSucursalPublica {
  slug: string;
  etiqueta?: string | null;
  subtituloPortal?: string | null;
  posX?: number | string | null;
  posY?: number | string | null;
  posW?: number | string | null;
  posH?: number | string | null;
  orden?: number | string | null;
  publicada: boolean;
}

/**
 * Guarda el registro público de una sucursal que ya está en el portal. Valida todo con los validadores de M2. Slug ya usado por otra sucursal → error con su nombre.
 * Permiso → id y formato de los datos (`guardComandoGuardarSucursalPublica`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/guardar-sucursal-publica.ts`) →
 * revalidar si salió bien → `aResultadoAccion`.
 */
export async function guardarSucursalPublica(sucursalId: string, datos: DatosSucursalPublica): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    const comando = guardComandoGuardarSucursalPublica(sucursalId, datos);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarSucursalPublicaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/**
 * Saca la sucursal del registro de motor2: borra su fila. Es la vuelta atrás del alta: la sucursal desaparece del portal.
 * Permiso → id (`guardComandoQuitarSucursalDelPortal`) → caso de uso (`casos-de-uso/quitar-sucursal-del-portal.ts`) → revalidar si salió bien → `aResultadoAccion`.
 */
export async function quitarSucursalDelPortal(sucursalId: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    const comando = guardComandoQuitarSucursalDelPortal(sucursalId);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await quitarSucursalDelPortalCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/**
 * Mueve la tarjeta de una sucursal sobre el mapa del portal (arrastrando en la vista previa de /carta/portal): guarda SOLO `posX` y
 * `posY` (% del mapa, 0 a 100, 2 decimales); el ancho y el alto quedan como estaban. Exige que la sucursal ya tenga posición
 * completa: arrastrar mueve, no ubica por primera vez (eso se hace con los números de su formulario, que además es la alternativa sin arrastre).
 * Permiso → id (`guardComandoMoverSucursalEnMapa`; la posición se valida DESPUÉS de leer la fila, en el caso de uso) → caso de uso
 * (`casos-de-uso/mover-sucursal-en-mapa.ts`) → revalidar si salió bien → `aResultadoAccion`.
 */
export async function moverSucursalEnMapa(sucursalId: string, x: number, y: number): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_portal", async (ctx) => {
    const comando = guardComandoMoverSucursalEnMapa({ sucursalId, x, y });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await moverSucursalEnMapaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
